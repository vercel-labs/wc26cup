import assert from "node:assert/strict";
import test from "node:test";
import { FactDraftSchema, rarityPercentage } from "../agent/lib/facts.js";

test("rarity percentages are derived from count and denominator", () => {
  assert.equal(rarityPercentage({ eligibleMatchCount: 964, occurrenceCount: 8 }), 0.83);
});

test("every claim part needs short, addressable source support", () => {
  const unsupported = FactDraftSchema.safeParse({
    claims: [{ key: "goal:haaland:79", statement: "Erling Haaland equalized in the 79th minute." }],
    evidence: [
      {
        excerpt: "Haaland scored twice.",
        publisher: "Example",
        retrievedAt: "2026-07-09T18:00:00Z",
        supports: ["another-claim"],
        title: "Match report",
        url: "https://example.com/report",
      },
    ],
    fixtureId: "760500",
    rarity: { kind: "none" },
    teams: ["Norway", "Brazil"],
    topic: "Haaland's late brace",
  });

  assert.equal(unsupported.success, false);
});

test("rarity records reject precomputed percentages", () => {
  const parsed = FactDraftSchema.safeParse({
    claims: [{ key: "comeback", statement: "The team recovered from a two-goal deficit." }],
    evidence: [
      {
        excerpt: "They recovered from two goals down.",
        publisher: "Example",
        retrievedAt: "2026-07-09T18:00:00Z",
        supports: ["comeback", "event", "occurrences", "population"],
        title: "Match report",
        url: "https://example.com/report",
      },
    ],
    fixtureId: "760500",
    rarity: {
      eligibleMatchCount: 964,
      eligibleMatchCountClaimKey: "population",
      eligibilityRule: "Completed men's World Cup matches through the cutoff date.",
      eventDefinition: "A team winning after trailing by two goals.",
      eventDefinitionClaimKey: "event",
      kind: "frequency",
      occurrenceCount: 8,
      occurrenceCountClaimKey: "occurrences",
      percentage: 0.83,
      throughDate: "2026-07-09",
    },
    teams: ["Argentina", "Egypt"],
    topic: "Two-goal comeback",
  });

  assert.equal(parsed.success, false);
});
