import { defineSchedule } from "eve/schedules";
import { type BetRecord, listPendingBets, saveBet } from "../lib/bets.js";
import slack from "../channels/slack.js";

interface EspnCompetitor {
  winner?: boolean;
  score?: string;
  team?: { displayName?: string };
}

interface EspnEvent {
  competitions?: {
    status?: { type?: { state?: string } };
    competitors?: EspnCompetitor[];
  }[];
}

function sameTeam(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  return left.includes(right) || right.includes(left);
}

/** YYYYMMDD for `date` shifted by `days`, computed in UTC. */
function shiftedUtcDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10).replaceAll("-", "");
}

/**
 * Final-whistle outcome for a bet, or null while the match is not finished.
 *
 * Timezones: bet.fixtureDate is the UTC date of kickoff, but ESPN's `dates=`
 * filter buckets events by US Eastern date, so a late UTC kickoff can land in
 * the previous day's bucket. Querying fixtureDate ± 1 day and matching by team
 * pair makes the bucketing irrelevant.
 *
 * Settlement is outcome-only (win/lose, penalties count via ESPN's `winner`
 * flag). The sweep never voids a bet — calling a bet off is the user's move,
 * through cancel_bet.
 */
async function settleAgainstEspn(bet: BetRecord): Promise<{ status: "won" | "lost"; score: string } | null> {
  const res = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${shiftedUtcDate(bet.fixtureDate, -1)}-${shiftedUtcDate(bet.fixtureDate, 1)}`,
    { headers: { accept: "application/json" } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { events?: EspnEvent[] };

  for (const event of data.events ?? []) {
    const competition = event.competitions?.[0];
    const competitors = competition?.competitors ?? [];
    const backed = competitors.find((c) => sameTeam(c.team?.displayName, bet.team));
    const opponent = competitors.find((c) => sameTeam(c.team?.displayName, bet.opponent));
    if (!backed || !opponent) continue;
    if (competition?.status?.type?.state !== "post") return null;

    const score = `${backed.team?.displayName} ${backed.score ?? "?"}–${opponent.score ?? "?"} ${opponent.team?.displayName}`;
    if (backed.winner === true) return { status: "won", score };
    if (opponent.winner === true) return { status: "lost", score };
    return null; // finished but no winner flagged — leave pending, never auto-void
  }
  return null;
}

export default defineSchedule({
  // Every 5 minutes. Vercel evaluates cron in UTC, which a */5 step makes
  // irrelevant — the point is that a bet settles within ~5 minutes of the
  // final whistle, whatever wall clock the match ends on.
  cron: "*/5 * * * *",
  async run({ receive, waitUntil, appAuth }) {
    waitUntil(
      (async () => {
        const pending = await listPendingBets();
        for (const bet of pending) {
          const outcome = await settleAgainstEspn(bet);
          if (!outcome) continue;

          await saveBet({ ...bet, status: outcome.status });

          await receive(slack, {
            message:
              `Settle a fictitious bet (no money involved). <@${bet.userId}> bet that ` +
              `${bet.team} would beat ${bet.opponent} (${bet.round}, ${bet.fixtureDate} UTC). ` +
              `Final: ${outcome.score}. They ${outcome.status.toUpperCase()}. ` +
              `Announce the result in the channel in your usual voice, mentioning them as <@${bet.userId}> — ` +
              `congratulate a win (and hint at the promised gift), console a loss with one gentle tease.`,
            target: { channelId: bet.channelId },
            auth: appAuth,
          });
        }
      })(),
    );
  },
});
