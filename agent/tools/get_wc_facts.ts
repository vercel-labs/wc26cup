import { defineTool } from "eve/tools";
import { z } from "zod";
import { factText, listFacts, rarityPercentage } from "../lib/facts.js";
import { FixtureIdSchema } from "../lib/fixtures.js";

const InputSchema = z.discriminatedUnion("view", [
  z.object({ limit: z.number().int().min(1).max(50).default(15), view: z.literal("recent") }),
  z.object({ limit: z.number().int().min(1).max(50).default(15), team: z.string().min(2), view: z.literal("team") }),
  z.object({
    fixtureId: FixtureIdSchema.describe("Numeric ESPN fixture ID"),
    limit: z.number().int().min(1).max(50).default(15),
    view: z.literal("fixture"),
  }),
]);

const FlatInputSchema = z.object({
  view: z.enum(["recent", "team", "fixture"]),
  limit: z.number().int().min(1).max(50).optional(),
  team: z.string().min(2).optional(),
  fixtureId: FixtureIdSchema.optional().describe("Numeric ESPN fixture ID"),
});

export default defineTool({
  description:
    "Read the shared, verified World Cup 2026 fact memory. Choose exactly one view: recent, team name, or numeric ESPN fixture ID. Use one relevant fact as conversational color. Each result includes exact evidence URLs; rarity percentages are derived from stored count and denominator. Rephrase tone only: never add match state, lineup role, sequence, cause, or a superlative absent from the returned text and evidence.",
  inputSchema: FlatInputSchema,
  async execute(rawInput) {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid get_wc_facts input." };
    }
    const input = parsed.data;
    let facts = await listFacts();
    if (input.view === "fixture") facts = facts.filter((record) => record.fact.fixtureId === input.fixtureId);
    if (input.view === "team") {
      const needle = input.team.toLowerCase();
      facts = facts.filter((record) => record.fact.teams.some((name) => name.toLowerCase().includes(needle)));
    }
    return {
      facts: facts.slice(0, input.limit).map((record) => {
        const rarity = record.fact.rarity.kind === "none"
          ? record.fact.rarity
          : { ...record.fact.rarity, percentage: rarityPercentage(record.fact.rarity) };
        return {
          curatedAt: record.curatedAt,
          evidence: record.fact.evidence.map(({ excerpt, publisher, title, url }) => ({ excerpt, publisher, title, url })),
          factKey: record.factKey,
          fixtureId: record.fact.fixtureId,
          rarity,
          text: factText(record),
          topic: record.fact.topic,
        };
      }),
    };
  },
});
