import type { Message, StateAdapter } from "chat";

const WINDOW = 60 * 60 * 1000;

function limit(): number {
  return Number(process.env.WC_RATE_LIMIT ?? 5);
}

function premiumOnly(): boolean {
  return process.env.WC_PREMIUM_ONLY === "true";
}

function handles(): string[] | null {
  const raw = process.env.WC_ALLOWED_USERS;
  if (!raw) return null;
  const names = raw
    .split(",")
    .map((name) => name.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);
  return names.length > 0 ? names : null;
}

export function allowlisted(message: Message): boolean {
  const names = handles();
  if (!names) return true;
  const handle = message.author.userName?.replace(/^@/, "").toLowerCase();
  return Boolean(handle && names.includes(handle));
}

type RawUser = { verified?: boolean; verified_type?: string };

function author(message: Message): RawUser | undefined {
  const raw = message.raw as { author?: RawUser } | undefined;
  return raw?.author;
}

export function premium(message: Message): boolean {
  if (!premiumOnly()) return true;
  const user = author(message);
  return Boolean(user?.verified || (user?.verified_type && user.verified_type !== "none"));
}

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
