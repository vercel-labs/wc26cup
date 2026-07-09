import assert from "node:assert/strict";
import test from "node:test";
import { settleExactScore } from "../agent/lib/bets.js";

test("exact scores use the final score before a shootout", () => {
  assert.deepEqual(
    settleExactScore({
      actual: { awayGoals: 1, homeGoals: 2 },
      prediction: { awayGoals: 1, homeGoals: 2 },
    }),
    "hit",
  );
  assert.deepEqual(
    settleExactScore({
      actual: { awayGoals: 1, homeGoals: 2 },
      prediction: { awayGoals: 0, homeGoals: 2 },
    }),
    "miss",
  );
});
