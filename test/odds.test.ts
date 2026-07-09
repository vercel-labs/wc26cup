import assert from "node:assert/strict";
import test from "node:test";
import { comparableQuotes, type ComparableQuote } from "../agent/lib/odds.js";

test("provider prices compare only when their settlement contract matches", () => {
  const advance: ComparableQuote = {
    contractKind: "advance",
    fetchedAt: "2026-07-09T18:00:00Z",
    homePct: 77.5,
    provider: "polymarket",
  };
  const regulation: ComparableQuote = {
    contractKind: "regulation_time",
    fetchedAt: "2026-07-09T18:00:00Z",
    homePct: 62,
    provider: "kalshi",
  };

  assert.equal(comparableQuotes(advance, regulation), null);
  assert.deepEqual(comparableQuotes(advance, { ...advance, homePct: 78, provider: "kalshi" }), {
    kalshi: { ...advance, homePct: 78, provider: "kalshi" },
    polymarket: advance,
  });
});
