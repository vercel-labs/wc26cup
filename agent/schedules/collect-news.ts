import { defineSchedule } from "eve/schedules";
import internalTask from "../channels/internal-task.js";
import { materializeDueRows } from "../lib/fixture-refresh.js";
import { fetchTournamentFixtures } from "../lib/fixtures.js";

function curationPrompt(runId: string): string {
  return `Refresh the shared World Cup 2026 fact memory. This is a silent scheduled task.

1. Read get_wc_facts for dedupe context.
2. Read get_wc_schedule for current fixtures and recent results.
3. Search current, credible sources for at most four genuinely curious facts: dramatic endings, unusual records, player performances, injuries, or storylines worth bringing up with a friend.
4. Treat a user's description or a search snippet only as a lead. Open the source. Keep each stored claim atomic and map every claim key to a direct URL plus a supporting excerpt of at most 25 words.
5. A rarity needs an explicit event definition, occurrence count, eligible-match denominator, population rule, and through-date. Never calculate or save the percentage yourself.
6. Call save_wc_facts exactly once with origin { kind: "broad", runId: ${JSON.stringify(runId)} }. Pass all accepted facts in that batch, or an empty result with a short reason. Facts stay deadpan; conversational phrasing happens later.

If sources do not support an exact claim, do not save it.`;
}

export default defineSchedule({
  cron: "13 */4 * * *",
  run({ receive, waitUntil, appAuth }) {
    waitUntil(
      (async () => {
        const now = new Date();
        try {
          const fixtures = await fetchTournamentFixtures({ now });
          await materializeDueRows(fixtures, now);
        } catch (error) {
          console.error("[fixture-refresh] four-hour fixture materialization failed", error);
        }

        const runId = now.toISOString();
        await receive(internalTask, {
          auth: appAuth,
          message: curationPrompt(runId),
          target: { kind: "broad", runId },
        });
      })(),
    );
  },
});
