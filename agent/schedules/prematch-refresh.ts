import { defineSchedule, type ScheduleHandlerArgs } from "eve/schedules";
import internalTask from "../channels/internal-task.js";
import {
  claimDueJob,
  isFixtureDue,
  listDueJobs,
  markSuperseded,
  materializeDueRows,
  type DueJob,
} from "../lib/fixture-refresh.js";
import { fetchFixtureById } from "../lib/fixtures.js";

function preMatchPrompt(job: DueJob, attemptPath: string): string {
  const fixture = job.row.fixture;
  return `Refresh the shared fact memory for ${fixture.home.name} vs ${fixture.away.name}, ${fixture.round}, about 30 minutes before kickoff. This is a silent scheduled task.

1. Search fresh sources for lineup news, injuries, tactical context, records, and genuinely curious facts tied to this fixture.
2. Open each source. A snippet or user phrase is only a search lead.
3. Map every atomic claim key to direct supporting evidence with an excerpt of at most 25 words.
4. Call save_wc_facts exactly once. Use origin ${JSON.stringify({ attemptPath, kind: "pre_match", refreshKey: job.row.refreshKey })}. Include at most four facts, or an empty result with a reason.
5. Do not fetch or save prediction-market prices. Those must stay live at conversation time.`;
}

export async function dispatchPrematchRefreshes(input: {
  readonly appAuth: ScheduleHandlerArgs["appAuth"];
  readonly now?: Date;
  readonly receive: ScheduleHandlerArgs["receive"];
}): Promise<void> {
  const now = input.now ?? new Date();
  const jobs = await listDueJobs(now);

  for (const job of jobs) {
    const attemptPath = await claimDueJob(job, now);
    if (!attemptPath) continue;

    let current;
    try {
      current = await fetchFixtureById(job.row.fixture.id);
    } catch (error) {
      console.error(`[fixture-refresh] failed to revalidate ${job.row.fixture.id}`, error);
      continue;
    }

    if (current.revision !== job.row.fixture.revision) {
      await materializeDueRows([current], now);
      await markSuperseded(job.row.refreshKey, {
        at: now.toISOString(),
        reason: "fixture_revision_changed_at_dispatch",
        replacementRefreshKey: `${current.id}-${current.revision}`,
      });
      continue;
    }

    // A postponement without a replacement kickoff is not terminal. Leave the
    // due row active so a later five-minute attempt can observe its new time.
    if (current.status.kind === "postponed") continue;

    if (!isFixtureDue(current, now)) {
      await markSuperseded(job.row.refreshKey, {
        at: now.toISOString(),
        reason: `fixture_${current.status.kind}`,
      });
      continue;
    }

    await input.receive(internalTask, {
      auth: input.appAuth,
      message: preMatchPrompt(job, attemptPath),
      target: { attemptPath, kind: "pre_match", refreshKey: job.row.refreshKey },
    });
  }
}

export default defineSchedule({
  cron: "* * * * *",
  run({ receive, waitUntil, appAuth }) {
    waitUntil(dispatchPrematchRefreshes({ appAuth, receive }));
  },
});
