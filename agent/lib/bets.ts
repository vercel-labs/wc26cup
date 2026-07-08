import { list, put } from "@vercel/blob";

/**
 * Fictitious-bet ledger, one JSON blob per bet under wc26-bets/.
 * One-blob-per-bet keeps writes independent: recording never races
 * settlement, and settlement flips each bet's status in isolation.
 */

export interface BetRecord {
  id: string;
  /** Stable principal from the session auth context — works for any authenticator (Slack, Vercel OIDC, …). */
  principalId: string;
  displayName: string | null;
  /** Announcement target, present only when the bet was placed from Slack. Other surfaces settle silently in the ledger. */
  slack: { userId: string; channelId: string } | null;
  /** The team the user is backing, and who they must beat. */
  team: string;
  opponent: string;
  round: string;
  /** UTC date of kickoff, YYYY-MM-DD — the settlement sweep queries ESPN by this date. */
  fixtureDate: string;
  venue: string | null;
  createdAt: string;
  status: "pending" | "won" | "lost" | "void";
}

const PREFIX = "wc26-bets/";

function betPath(id: string): string {
  return `${PREFIX}${id}.json`;
}

export async function saveBet(bet: BetRecord): Promise<void> {
  await put(betPath(bet.id), JSON.stringify(bet, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function listBets(): Promise<BetRecord[]> {
  const { blobs } = await list({ prefix: PREFIX });
  const records = await Promise.all(
    blobs.map(async (blob) => {
      const res = await fetch(blob.url);
      if (!res.ok) return null;
      return (await res.json()) as BetRecord;
    }),
  );
  return records.filter((record): record is BetRecord => record !== null);
}

export async function listPendingBets(): Promise<BetRecord[]> {
  return (await listBets()).filter((bet) => bet.status === "pending");
}
