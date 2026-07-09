import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { list } from "@vercel/blob";
import { z } from "zod";
import { putJsonIfAbsent, readBlobJson } from "../agent/lib/blob.js";
import { FactDraftSchema, saveFacts } from "../agent/lib/facts.js";
import { LegacyBetSchema } from "../agent/lib/bets.js";

const LegacyNoteSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  date: z.string().date(),
  id: z.string().min(1),
  note: z.string().min(1),
  source: z.string().min(1),
  teams: z.array(z.string().min(1)).min(1),
});

const SeedSchema = z.array(FactDraftSchema);

async function legacyRecords<T>(prefix: string, schema: z.ZodType<T>): Promise<readonly { pathname: string; value: T }[]> {
  const { blobs } = await list({ prefix });
  const records: { pathname: string; value: T }[] = [];
  for (const blob of blobs) {
    if (blob.pathname.startsWith("wc26-bets/v2/")) continue;
    const parsed = schema.safeParse(await readBlobJson(blob.url));
    if (parsed.success) records.push({ pathname: blob.pathname, value: parsed.data });
  }
  return records;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const notes = await legacyRecords("wc26-notes/", LegacyNoteSchema);
  const bets = await legacyRecords("wc26-bets/", LegacyBetSchema);
  const rawSeeds: unknown = JSON.parse(await readFile(resolve("scripts/curated-facts.v2.json"), "utf8"));
  const seeds = SeedSchema.parse(rawSeeds);

  const report = {
    apply,
    legacyBetsNeedingStableFixtureMapping: bets.length,
    legacyNotesToQuarantine: notes.length,
    verifiedSeeds: seeds.length,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!apply) return;

  for (const note of notes) {
    await putJsonIfAbsent(`wc26-facts-quarantine/v1/${note.value.id}.json`, {
      legacy: note.value,
      reason: "insufficient_provenance",
      sourcePathname: note.pathname,
    });
  }
  const saved = await saveFacts({
    drafts: seeds,
    origin: { kind: "broad", runId: `migration:${new Date().toISOString()}` },
  });
  console.log(JSON.stringify({ savedFacts: saved.map((record) => record.factKey) }, null, 2));
}

await main();
