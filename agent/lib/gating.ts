import { createHash } from "node:crypto";
import {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  head,
  put,
} from "@vercel/blob";
import type { Message } from "chat";
import type { XVerificationClient } from "./x-verification.js";

const INTERACTION_LIMIT = 40;
const INTERACTION_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_PREFIX = "wc26-x-rate/v1";
// Avoid one X lookup per mention while limiting stale verification to five minutes.
const VERIFICATION_CACHE_TTL_MS = 5 * 60 * 1000;

type GateLogger = Pick<Console, "error">;

export interface VerificationCache {
  read(key: string): Promise<unknown | null>;
  write(key: string, value: boolean, ttlMs: number): Promise<void>;
}

export interface QuotaSlotStore {
  tryClaim(input: {
    readonly claimedAt: number;
    readonly expiresBefore: number;
    readonly pathname: string;
  }): Promise<boolean>;
}

function accountKey(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 32);
}

function handles(): string[] | null {
  const raw = process.env.WC_ALLOWED_USERS;
  if (!raw) return null;
  const names = raw
    .split(",")
    .map((name) => name.trim().replace(/^@/u, "").toLowerCase())
    .filter(Boolean);
  return names.length > 0 ? names : null;
}

export function allowlisted(message: Message): boolean {
  const names = handles();
  if (!names) return true;
  const handle = message.author.userName?.replace(/^@/u, "").toLowerCase();
  return Boolean(handle && names.includes(handle));
}

export function shouldRejectXMessage({
  authorUserId,
  botUserId,
  isMe,
  threadId,
}: {
  readonly authorUserId: string;
  readonly botUserId: string | undefined;
  readonly isMe: boolean;
  readonly threadId: string;
}): boolean {
  return (
    !botUserId ||
    threadId.startsWith("x:dm:") ||
    isMe ||
    authorUserId === botUserId
  );
}

export function createVerifiedAccountGate({
  cache,
  client,
  logger = console,
}: {
  readonly cache: VerificationCache;
  readonly client: XVerificationClient;
  readonly logger?: GateLogger;
}): (userId: string) => Promise<boolean> {
  return async (userId) => {
    const cacheKey = `wc:x:verified:${accountKey(userId)}`;
    try {
      const cached = await cache.read(cacheKey);
      if (typeof cached === "boolean") {
        return cached;
      }
    } catch (error: unknown) {
      logger.error("[x] verification cache read failed", error);
    }

    let isVerified: boolean;
    try {
      isVerified = await client.isVerified(userId);
    } catch (error: unknown) {
      logger.error("[x] verification lookup failed; denying mention", error);
      return false;
    }

    try {
      await cache.write(cacheKey, isVerified, VERIFICATION_CACHE_TTL_MS);
    } catch (error: unknown) {
      logger.error("[x] verification cache write failed", error);
    }
    return isVerified;
  };
}

async function putClaim(
  pathname: string,
  claimedAt: number,
  options: { readonly ifMatch?: string; readonly overwrite: boolean },
): Promise<void> {
  await put(pathname, JSON.stringify({ claimedAt }), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: options.overwrite,
    contentType: "application/json",
    ...(options.ifMatch ? { ifMatch: options.ifMatch } : {}),
  });
}

export function createBlobQuotaSlotStore(): QuotaSlotStore {
  return {
    async tryClaim({ claimedAt, expiresBefore, pathname }) {
      let existing;
      try {
        existing = await head(pathname);
      } catch (error: unknown) {
        if (!(error instanceof BlobNotFoundError)) {
          throw error;
        }
        try {
          await putClaim(pathname, claimedAt, { overwrite: false });
          return true;
        } catch (claimError: unknown) {
          try {
            await head(pathname);
            return false;
          } catch {
            throw claimError;
          }
        }
      }

      if (existing.uploadedAt.getTime() > expiresBefore) {
        return false;
      }
      try {
        await putClaim(pathname, claimedAt, {
          ifMatch: existing.etag,
          overwrite: true,
        });
        return true;
      } catch (error: unknown) {
        if (error instanceof BlobPreconditionFailedError) {
          return false;
        }
        throw error;
      }
    },
  };
}

export function createXInteractionLimit({
  clock = Date.now,
  logger = console,
  store,
}: {
  readonly clock?: () => number;
  readonly logger?: GateLogger;
  readonly store: QuotaSlotStore;
}): (userId: string) => Promise<boolean> {
  return async (userId) => {
    const claimedAt = clock();
    const expiresBefore = claimedAt - INTERACTION_WINDOW_MS;
    const prefix = `${RATE_PREFIX}/${accountKey(userId)}`;
    try {
      for (let index = 0; index < INTERACTION_LIMIT; index += 1) {
        const slot = String(index).padStart(2, "0");
        if (
          await store.tryClaim({
            claimedAt,
            expiresBefore,
            pathname: `${prefix}/slot-${slot}.json`,
          })
        ) {
          return true;
        }
      }
      return false;
    } catch (error: unknown) {
      logger.error("[x] interaction quota failed; denying mention", error);
      return false;
    }
  };
}
