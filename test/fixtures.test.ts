import assert from "node:assert/strict";
import test from "node:test";
import { parseEspnScoreboard } from "../agent/lib/fixtures.js";

test("fixture scores exclude separately reported shootout kicks", () => {
  const [fixture] = parseEspnScoreboard({
    events: [
      {
        competitions: [
          {
            competitors: [
              {
                homeAway: "home",
                id: "481",
                score: "1",
                shootoutScore: 3,
                team: { displayName: "Germany", id: "481" },
              },
              {
                homeAway: "away",
                id: "210",
                score: "1",
                shootoutScore: 4,
                team: { displayName: "Paraguay", id: "210" },
              },
            ],
            date: "2026-06-29T20:30:00Z",
            status: {
              type: {
                completed: true,
                description: "Final Score - After Penalties",
                state: "post",
              },
            },
          },
        ],
        date: "2026-06-29T20:30:00Z",
        id: "760489",
        season: { slug: "round-of-32" },
      },
    ],
  });

  assert.deepEqual(fixture?.status, { awayGoals: 1, homeGoals: 1, kind: "final" });
});
