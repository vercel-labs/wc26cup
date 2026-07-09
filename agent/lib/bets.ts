import { createHash } from "node:crypto";
import { list, put } from "@vercel/blob";
import { z } from "zod";
import { listAllBlobs, putJsonIfAbsent, readBlobJson } from "./blob.js";
import { FixtureSchema, type Fixture } from "./fixtures.js";

const LEGACY_PREFIX = "wc26-bets/";
const V2_PREFIX = "wc26-bets/v2/";

export const LegacyBetSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  displayName: z.string().nullable(),
  fixtureDate: z.string().date(),
  id: z.string().min(1),
  opponent: z.string().min(1),
  principalId: z.string().min(1),
  round: z.string().min(1),
  slack: z.object({ channelId: z.string().min(1), userId: z.string().min(1) }).nullable(),
  status: z.enum(["pending", "won", "lost", "void"]),
  team: z.string().min(1),
  venue: z.string().nullable(),
});

export type BetRecord = z.infer<typeof LegacyBetSchema>;

export const ExactScoreSchema = z.object({
  awayGoals: z.number().int().min(0).max(30),
  homeGoals: z.number().int().min(0).max(30),
});

export type ExactScore = z.infer<typeof ExactScoreSchema>;

const PredictionOwnerSchema = z.discriminatedUnion("kind", [
  z.object({ displayName: z.string().nullable(), kind: z.literal("principal"), principalId: z.string().min(1) }),
  z.object({ kind: z.literal("web_session"), sessionId: z.string().min(1) }),
]);

const FollowUpSchema = z.discriminatedUnion("kind", [
  z.object({ channelId: z.string().min(1), kind: z.literal("slack"), userId: z.string().min(1) }),
  z.object({ kind: z.literal("x"), threadId: z.string().min(1), userId: z.string().min(1) }),
  z.object({ kind: z.literal("pull_only"), surface: z.literal("web") }),
]);

const FixtureSnapshotSchema = FixtureSchema.pick({
  away: true,
  home: true,
  id: true,
  kickoffUtc: true,
  round: true,
  venue: true,
});

export const PredictionPlacedSchema = z.object({
  basis: z.literal("final_before_shootout"),
  createdAt: z.string().datetime({ offset: true }),
  fixture: FixtureSnapshotSchema,
  followUp: FollowUpSchema,
  id: z.string().min(16),
  owner: PredictionOwnerSchema,
  prediction: ExactScoreSchema,
  schemaVersion: z.literal(2),
});

export type PredictionOwner = z.infer<typeof PredictionOwnerSchema>;
export type PredictionFollowUp = z.infer<typeof FollowUpSchema>;
export type PredictionPlaced = z.infer<typeof PredictionPlacedSchema>;

export const PredictionTerminalSchema = z.discriminatedUnion("kind", [
  z.object({
    actual: ExactScoreSchema,
    at: z.string().datetime({ offset: true }),
    kind: z.literal("settled"),
    result: z.enum(["hit", "miss"]),
    schemaVersion: z.literal(2),
  }),
  z.object({
    at: z.string().datetime({ offset: true }),
    kind: z.literal("void"),
    reason: z.enum(["fixture_cancelled", "user_cancelled"]),
    schemaVersion: z.literal(2),
  }),
]);

export type PredictionTerminal = z.infer<typeof PredictionTerminalSchema>;

export interface PredictionView {
  readonly notified: boolean;
  readonly placed: PredictionPlaced;
  readonly terminal: PredictionTerminal | null;
}

function legacyPath(id: string): string {
  return `${LEGACY_PREFIX}${id}.json`;
}

export async function saveBet(bet: BetRecord): Promise<void> {
  const parsed = LegacyBetSchema.parse(bet);
  await put(legacyPath(parsed.id), JSON.stringify(parsed, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json",
  });
}

export async function listBets(): Promise<BetRecord[]> {
  const { blobs } = await list({ prefix: LEGACY_PREFIX });
  const records: BetRecord[] = [];
  for (const blob of blobs) {
    if (blob.pathname.startsWith(V2_PREFIX)) continue;
    const parsed = LegacyBetSchema.safeParse(await readBlobJson(blob.url));
    if (parsed.success) records.push(parsed.data);
  }
  return records;
}

export async function listPendingBets(): Promise<BetRecord[]> {
  return (await listBets()).filter((bet) => bet.status === "pending");
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function ownerKey(owner: PredictionOwner): string {
  return owner.kind === "principal" ? `principal:${owner.principalId}` : `session:${owner.sessionId}`;
}

export function predictionId(owner: PredictionOwner, fixtureId: string): string {
  return digest(`${ownerKey(owner)}\0${fixtureId}\0exact-score`).slice(0, 24);
}

function placedPath(id: string): string {
  return `${V2_PREFIX}${id}/placed.json`;
}

function terminalPath(id: string): string {
  return `${V2_PREFIX}${id}/terminal.json`;
}

function notifiedPath(id: string): string {
  return `${V2_PREFIX}${id}/notified.json`;
}

export async function recordExactScore(input: {
  readonly fixture: Fixture;
  readonly followUp: PredictionFollowUp;
  readonly now?: Date;
  readonly owner: PredictionOwner;
  readonly prediction: ExactScore;
}): Promise<{ readonly created: boolean; readonly prediction: PredictionPlaced }> {
  const id = predictionId(input.owner, input.fixture.id);
  const prediction = PredictionPlacedSchema.parse({
    basis: "final_before_shootout",
    createdAt: (input.now ?? new Date()).toISOString(),
    fixture: input.fixture,
    followUp: input.followUp,
    id,
    owner: input.owner,
    prediction: input.prediction,
    schemaVersion: 2,
  });
  const pathname = placedPath(id);
  const created = await putJsonIfAbsent(pathname, prediction);
  if (created) return { created, prediction };

  const existingBlob = (await listAllBlobs(pathname)).find((blob) => blob.pathname === pathname);
  if (!existingBlob) throw new Error(`Prediction ${id} exists but could not be read.`);
  const existing = PredictionPlacedSchema.parse(await readBlobJson(existingBlob.url));
  return { created, prediction: existing };
}

export function settleExactScore(input: {
  readonly actual: ExactScore;
  readonly prediction: ExactScore;
}): "hit" | "miss" {
  return input.actual.homeGoals === input.prediction.homeGoals && input.actual.awayGoals === input.prediction.awayGoals
    ? "hit"
    : "miss";
}

export async function writePredictionTerminal(id: string, terminal: PredictionTerminal): Promise<boolean> {
  return await putJsonIfAbsent(terminalPath(id), PredictionTerminalSchema.parse(terminal));
}

export async function markPredictionNotified(id: string, now: Date = new Date()): Promise<boolean> {
  return await putJsonIfAbsent(notifiedPath(id), { at: now.toISOString(), schemaVersion: 2 });
}

export async function listPredictions(): Promise<readonly PredictionView[]> {
  const blobs = await listAllBlobs(V2_PREFIX);
  const placedBlobs = blobs.filter((blob) => blob.pathname.endsWith("/placed.json"));
  const terminalById = new Map<string, PredictionTerminal>();
  const notifiedIds = new Set<string>();

  for (const blob of blobs) {
    const parts = blob.pathname.split("/");
    const id = parts.at(-2);
    if (!id) continue;
    if (blob.pathname.endsWith("/terminal.json")) {
      const parsed = PredictionTerminalSchema.safeParse(await readBlobJson(blob.url));
      if (parsed.success) terminalById.set(id, parsed.data);
    } else if (blob.pathname.endsWith("/notified.json")) {
      notifiedIds.add(id);
    }
  }

  const views: PredictionView[] = [];
  for (const blob of placedBlobs) {
    const parsed = PredictionPlacedSchema.safeParse(await readBlobJson(blob.url));
    if (!parsed.success) continue;
    views.push({
      notified: notifiedIds.has(parsed.data.id),
      placed: parsed.data,
      terminal: terminalById.get(parsed.data.id) ?? null,
    });
  }
  return views.sort((left, right) => right.placed.createdAt.localeCompare(left.placed.createdAt));
}

export async function listPendingPredictions(): Promise<readonly PredictionView[]> {
  return (await listPredictions()).filter((prediction) => prediction.terminal === null);
}
