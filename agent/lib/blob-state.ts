import { del, list, put } from "@vercel/blob";
import type { Lock, QueueEntry, StateAdapter } from "chat";
import { nanoid } from "nanoid";

/**
 * Chat SDK StateAdapter on Vercel Blob — no extra service, one store for the
 * whole bot (bets, notes, and now chat state under wc26-state/).
 *
 * Design constraint: Vercel Blob reads are CDN-cached and the backend no
 * longer supports cache bypass, so overwriting a path can serve stale data
 * for minutes — fatal for locks and dedupe. This adapter therefore NEVER
 * overwrites: every write is a new immutable pathname (immutable blobs are
 * never stale), reads resolve the newest generation via the list() API, and
 * lock/dedupe metadata is encoded in pathnames so checks don't fetch content.
 *
 * Consistency envelope: list-then-put is not atomic, so concurrent writers
 * can both pass an existence check (double lock, double dedupe) in a window
 * of one round-trip. Locks mitigate with a post-acquire re-list where the
 * lexicographically-first pathname wins. At mention-level traffic this is
 * fine; at real volume use a Redis state adapter instead — the channel
 * accepts any StateAdapter.
 */

const ROOT = "wc26-state";

function safe(key: string): string {
  return encodeURIComponent(key).replaceAll("%", "~");
}

/** Zero-padded ms timestamp so pathnames sort chronologically. */
function stamp(at: number): string {
  return String(at).padStart(15, "0");
}

interface Generation {
  pathname: string;
  url: string;
}

async function generations(prefix: string): Promise<Generation[]> {
  const { blobs } = await list({ prefix });
  return blobs
    .map((blob) => ({ pathname: blob.pathname, url: blob.url }))
    .sort((a, b) => a.pathname.localeCompare(b.pathname));
}

async function readJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function write(pathname: string, value: unknown): Promise<void> {
  await put(pathname, JSON.stringify(value), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

async function drop(pathnames: string[]): Promise<void> {
  if (pathnames.length > 0) await del(pathnames);
}

interface CacheRecord<T> {
  value: T;
  expiresAt: number | null;
}

/** Newest generation under a cache key, dropping it if expired. */
async function latestCache<T>(prefix: string): Promise<{ record: CacheRecord<T>; stale: string[] } | null> {
  const gens = await generations(prefix);
  if (gens.length === 0) return null;
  const newest = gens[gens.length - 1];
  const record = await readJson<CacheRecord<T>>(newest.url);
  const stale = gens.slice(0, -1).map((g) => g.pathname);
  if (!record || (record.expiresAt !== null && record.expiresAt <= Date.now())) {
    await drop([...stale, newest.pathname]);
    return null;
  }
  return { record, stale };
}

/** Lock pathnames carry expiry + token: lock/<threadId>/<expiresAt>-<token> */
function parseLock(pathname: string): { expiresAt: number; token: string } | null {
  const name = pathname.split("/").at(-1);
  const match = name?.match(/^(\d+)-(.+)\.json$/);
  return match ? { expiresAt: Number(match[1]), token: match[2] } : null;
}

export function createBlobState(): StateAdapter {
  const lockPrefix = (threadId: string) => `${ROOT}/lock/${safe(threadId)}/`;
  const cachePrefix = (key: string) => `${ROOT}/cache/${safe(key)}/`;
  const listPrefix = (key: string) => `${ROOT}/list/${safe(key)}/`;
  const queuePrefix = (threadId: string) => `${ROOT}/queue/${safe(threadId)}/`;
  const subPath = (threadId: string) => `${ROOT}/subs/${safe(threadId)}.json`;

  return {
    async connect() {},
    async disconnect() {},

    async get<T>(key: string): Promise<T | null> {
      const hit = await latestCache<T>(cachePrefix(key));
      return hit ? hit.record.value : null;
    },

    async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
      const prefix = cachePrefix(key);
      const before = await generations(prefix);
      await write(`${prefix}${stamp(Date.now())}-${nanoid(6)}.json`, {
        value,
        expiresAt: ttlMs ? Date.now() + ttlMs : null,
      });
      await drop(before.map((g) => g.pathname));
    },

    async setIfNotExists(key: string, value: unknown, ttlMs?: number): Promise<boolean> {
      const hit = await latestCache(cachePrefix(key));
      if (hit) return false;
      await write(`${cachePrefix(key)}${stamp(Date.now())}-${nanoid(6)}.json`, {
        value,
        expiresAt: ttlMs ? Date.now() + ttlMs : null,
      });
      return true;
    },

    async delete(key: string): Promise<void> {
      const gens = await generations(cachePrefix(key));
      await drop(gens.map((g) => g.pathname));
    },

    async getList<T>(key: string): Promise<T[]> {
      const now = Date.now();
      const gens = await generations(listPrefix(key));
      const entries = await Promise.all(
        gens.map((g) => readJson<{ value: T; expiresAt: number | null }>(g.url)),
      );
      return entries
        .filter((e): e is { value: T; expiresAt: number | null } => e !== null)
        .filter((e) => e.expiresAt === null || e.expiresAt > now)
        .map((e) => e.value);
    },

    async appendToList(key: string, value: unknown, options?: { maxLength?: number; ttlMs?: number }): Promise<void> {
      const prefix = listPrefix(key);
      await write(`${prefix}${stamp(Date.now())}-${nanoid(6)}.json`, {
        value,
        expiresAt: options?.ttlMs ? Date.now() + options.ttlMs : null,
      });
      if (options?.maxLength) {
        const gens = await generations(prefix);
        const excess = gens.length - options.maxLength;
        if (excess > 0) await drop(gens.slice(0, excess).map((g) => g.pathname));
      }
    },

    async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
      const prefix = lockPrefix(threadId);
      const now = Date.now();
      const existing = await generations(prefix);
      const live = existing.filter((g) => (parseLock(g.pathname)?.expiresAt ?? 0) > now);
      if (live.length > 0) return null;
      await drop(existing.map((g) => g.pathname)); // expired leftovers

      const token = nanoid(12);
      const expiresAt = now + ttlMs;
      const mine = `${prefix}${expiresAt}-${token}.json`;
      await write(mine, { threadId });

      // Two writers can both pass the empty check; re-list and let the
      // lexicographically-first live pathname win.
      const after = (await generations(prefix)).filter((g) => (parseLock(g.pathname)?.expiresAt ?? 0) > now);
      if (after.length > 0 && after[0].pathname !== mine) {
        await drop([mine]);
        return null;
      }
      return { threadId, token, expiresAt };
    },

    async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
      const prefix = lockPrefix(lock.threadId);
      const gens = await generations(prefix);
      const mine = gens.find((g) => parseLock(g.pathname)?.token === lock.token);
      if (!mine || (parseLock(mine.pathname)?.expiresAt ?? 0) <= Date.now()) return false;
      const expiresAt = Date.now() + ttlMs;
      await write(`${prefix}${expiresAt}-${lock.token}.json`, { threadId: lock.threadId });
      await drop([mine.pathname]);
      return true;
    },

    async releaseLock(lock: Lock): Promise<void> {
      const gens = await generations(lockPrefix(lock.threadId));
      const mine = gens.filter((g) => parseLock(g.pathname)?.token === lock.token);
      await drop(mine.map((g) => g.pathname));
    },

    async forceReleaseLock(threadId: string): Promise<void> {
      const gens = await generations(lockPrefix(threadId));
      await drop(gens.map((g) => g.pathname));
    },

    async enqueue(threadId: string, entry: QueueEntry, maxSize: number): Promise<number> {
      const prefix = queuePrefix(threadId);
      await write(`${prefix}${stamp(entry.enqueuedAt)}-${nanoid(6)}.json`, entry);
      const gens = await generations(prefix);
      if (maxSize > 0 && gens.length > maxSize) {
        await drop(gens.slice(0, gens.length - maxSize).map((g) => g.pathname));
        return maxSize;
      }
      return gens.length;
    },

    async dequeue(threadId: string): Promise<QueueEntry | null> {
      const now = Date.now();
      const gens = await generations(queuePrefix(threadId));
      for (const gen of gens) {
        const entry = await readJson<QueueEntry>(gen.url);
        await drop([gen.pathname]);
        if (entry && entry.expiresAt > now) return entry; // stale entries discarded
      }
      return null;
    },

    async queueDepth(threadId: string): Promise<number> {
      return (await generations(queuePrefix(threadId))).length;
    },

    async subscribe(threadId: string): Promise<void> {
      await write(subPath(threadId), { at: Date.now() });
    },

    async unsubscribe(threadId: string): Promise<void> {
      const gens = await generations(subPath(threadId));
      await drop(gens.map((g) => g.pathname));
    },

    async isSubscribed(threadId: string): Promise<boolean> {
      return (await generations(subPath(threadId))).length > 0;
    },
  };
}
