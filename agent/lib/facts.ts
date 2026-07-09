import { createHash } from "node:crypto";
import { z } from "zod";
import { listAllBlobs, putJsonIfAbsent, readBlobJson } from "./blob.js";
import { FixtureIdSchema } from "./fixtures.js";

const FACT_PREFIX = "wc26-facts/v2/";

const ClaimSchema = z.object({
  key: z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9:._-]*$/),
  statement: z.string().min(10).max(300),
}).strict();

function wordCount(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

const EvidenceSchema = z.object({
  excerpt: z.string().min(1).max(280).refine((value) => wordCount(value) <= 25, "Excerpt must be 25 words or fewer."),
  publisher: z.string().min(1).max(100),
  retrievedAt: z.string().datetime({ offset: true }),
  supports: z.array(z.string().min(1)).min(1),
  title: z.string().min(1).max(200),
  url: z.string().url(),
}).strict();

const RaritySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({
    eligibleMatchCount: z.number().int().positive(),
    eligibleMatchCountClaimKey: z.string().min(1),
    eligibilityRule: z.string().min(5).max(300),
    eventDefinition: z.string().min(5).max(300),
    eventDefinitionClaimKey: z.string().min(1),
    kind: z.literal("frequency"),
    occurrenceCount: z.number().int().nonnegative(),
    occurrenceCountClaimKey: z.string().min(1),
    throughDate: z.string().date(),
  }).strict(),
]);

const FactDraftBaseSchema = z.object({
  claims: z.array(ClaimSchema).min(1).max(6),
  evidence: z.array(EvidenceSchema).min(1).max(10),
  fixtureId: FixtureIdSchema.nullable(),
  rarity: RaritySchema,
  teams: z.array(z.string().min(2).max(80)).min(1).max(4),
  topic: z.string().min(3).max(100),
}).strict();

export const FactDraftSchema = FactDraftBaseSchema.superRefine((fact, context) => {
  const claimKeys = new Set(fact.claims.map((claim) => claim.key));
  if (claimKeys.size !== fact.claims.length) {
    context.addIssue({ code: "custom", message: "Claim keys must be unique.", path: ["claims"] });
  }

  if (fact.rarity.kind === "frequency") {
    claimKeys.add(fact.rarity.eventDefinitionClaimKey);
    claimKeys.add(fact.rarity.occurrenceCountClaimKey);
    claimKeys.add(fact.rarity.eligibleMatchCountClaimKey);
    if (fact.rarity.occurrenceCount > fact.rarity.eligibleMatchCount) {
      context.addIssue({
        code: "custom",
        message: "Occurrence count cannot exceed the eligible match count.",
        path: ["rarity", "occurrenceCount"],
      });
    }
  }

  const supported = new Set(fact.evidence.flatMap((evidence) => evidence.supports));
  for (const key of claimKeys) {
    if (!supported.has(key)) {
      context.addIssue({ code: "custom", message: `Claim ${key} has no supporting evidence.`, path: ["evidence"] });
    }
  }
  for (const key of supported) {
    if (!claimKeys.has(key)) {
      context.addIssue({ code: "custom", message: `Evidence references unknown claim ${key}.`, path: ["evidence"] });
    }
  }
});

export type FactDraft = z.infer<typeof FactDraftSchema>;

const FactOriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("broad"), runId: z.string().min(1) }).strict(),
  z.object({ attemptPath: z.string().min(1), kind: z.literal("pre_match"), refreshKey: z.string().min(1) }).strict(),
]);

export const FactRecordSchema = z.object({
  curatedAt: z.string().datetime({ offset: true }),
  factKey: z.string().min(16),
  fact: FactDraftSchema,
  origin: FactOriginSchema,
  revision: z.string().min(16),
  schemaVersion: z.literal(2),
});

export type FactOrigin = z.infer<typeof FactOriginSchema>;
export type FactRecord = z.infer<typeof FactRecordSchema>;

export function rarityPercentage(input: { readonly eligibleMatchCount: number; readonly occurrenceCount: number }): number {
  if (!Number.isInteger(input.eligibleMatchCount) || input.eligibleMatchCount <= 0) {
    throw new Error("eligibleMatchCount must be a positive integer.");
  }
  if (!Number.isInteger(input.occurrenceCount) || input.occurrenceCount < 0 || input.occurrenceCount > input.eligibleMatchCount) {
    throw new Error("occurrenceCount must be an integer within the eligible population.");
  }
  return Math.round((input.occurrenceCount / input.eligibleMatchCount) * 10_000) / 100;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function factIdentity(fact: FactDraft): string {
  const subject = fact.fixtureId ?? fact.topic.trim().toLowerCase();
  return digest(`${subject}\0${fact.claims.map((claim) => claim.key).sort().join("\0")}`).slice(0, 24);
}

function canonicalFact(fact: FactDraft): string {
  return JSON.stringify({
    ...fact,
    claims: [...fact.claims].sort((left, right) => left.key.localeCompare(right.key)),
    evidence: [...fact.evidence].sort((left, right) => left.url.localeCompare(right.url)),
    teams: [...fact.teams].sort(),
  });
}

export async function saveFacts(input: {
  readonly drafts: readonly FactDraft[];
  readonly now?: Date;
  readonly origin: FactOrigin;
}): Promise<readonly FactRecord[]> {
  const curatedAt = (input.now ?? new Date()).toISOString();
  const records = input.drafts.map((draft) => {
    const fact = FactDraftSchema.parse(draft);
    return FactRecordSchema.parse({
      curatedAt,
      fact,
      factKey: factIdentity(fact),
      origin: input.origin,
      revision: digest(canonicalFact(fact)).slice(0, 24),
      schemaVersion: 2,
    });
  });

  for (const record of records) {
    await putJsonIfAbsent(`${FACT_PREFIX}${record.factKey}/${record.curatedAt}-${record.revision}.json`, record);
  }
  return records;
}

export async function listFacts(): Promise<readonly FactRecord[]> {
  const blobs = await listAllBlobs(FACT_PREFIX);
  const records: FactRecord[] = [];
  for (const blob of blobs) {
    const parsed = FactRecordSchema.safeParse(await readBlobJson(blob.url));
    if (parsed.success) records.push(parsed.data);
  }

  const latest = new Map<string, FactRecord>();
  for (const record of records) {
    const previous = latest.get(record.factKey);
    if (!previous || previous.curatedAt < record.curatedAt) latest.set(record.factKey, record);
  }
  return [...latest.values()].sort((left, right) => right.curatedAt.localeCompare(left.curatedAt));
}

export function factText(record: FactRecord): string {
  const narrative = record.fact.claims.map((claim) => claim.statement).join(" ");
  if (record.fact.rarity.kind === "none") return narrative;
  const percent = rarityPercentage(record.fact.rarity);
  return `${narrative} ${record.fact.rarity.occurrenceCount} of ${record.fact.rarity.eligibleMatchCount} eligible matches (${percent}%).`;
}
