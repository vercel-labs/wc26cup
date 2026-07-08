import type { Message, StateAdapter } from "chat";

/**
 * Mention gating for the X channel, ported from vercel-labs/worldcup
 * (src/lib/gating.ts). Public X mentions are unmetered inbound; these two
 * gates keep reply volume bounded.
 */

const WINDOW = 60 * 60 * 1000;

function limit(): number {
  return Number(process.env.WC_RATE_LIMIT ?? 5);
}

function premiumOnly(): boolean {
  return process.env.WC_PREMIUM_ONLY === "true";
}

type RawUser = { verified?: boolean; verified_type?: string };

function author(message: Message): RawUser | undefined {
  const raw = message.raw as { author?: RawUser } | undefined;
  return raw?.author;
}

/**
 * Whether a mention's author may get a reply. True for everyone unless
 * WC_PREMIUM_ONLY=true, which restricts replies to verified X accounts
 * (read from the raw payload's verified/verified_type).
 */
export function premium(message: Message): boolean {
  if (!premiumOnly()) return true;
  const user = author(message);
  return Boolean(user?.verified || (user?.verified_type && user.verified_type !== "none"));
}

/**
 * Per-user sliding-window rate limit backed by the shared state adapter, so
 * the count holds across serverless instances: at most WC_RATE_LIMIT replies
 * per user per hour.
 */
export async function allowed(state: StateAdapter, userId: string): Promise<boolean> {
  const max = limit();
  const key = `wc:rate:${userId}`;
  const now = Date.now();
  const hits = (await state.getList<number>(key)) ?? [];
  const recent = hits.filter((at) => now - at < WINDOW);
  if (recent.length >= max) return false;
  await state.appendToList(key, now, { maxLength: max, ttlMs: WINDOW });
  return true;
}
