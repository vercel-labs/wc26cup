import { defineSchedule, type ScheduleHandlerArgs } from "eve/schedules";
import slack from "../channels/slack.js";
import x from "../channels/x.js";
import {
  listBets,
  listPredictions,
  markPredictionNotified,
  saveBet,
  settleExactScore,
  writePredictionTerminal,
  type BetRecord,
  type PredictionView,
} from "../lib/bets.js";
import { fetchFixtureById, fetchFixturesForRange, type Fixture } from "../lib/fixtures.js";

function compactDate(date: string, shiftDays: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + shiftDays);
  return shifted.toISOString().slice(0, 10).replaceAll("-", "");
}

function sameTeam(left: string, right: string): boolean {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return a.includes(b) || b.includes(a);
}

async function settleLegacyBet(bet: BetRecord): Promise<BetRecord | null> {
  const fixtures = await fetchFixturesForRange(compactDate(bet.fixtureDate, -1), compactDate(bet.fixtureDate, 1));
  const fixture = fixtures.find(
    (candidate) =>
      [candidate.home.name, candidate.away.name].some((team) => sameTeam(team, bet.team)) &&
      [candidate.home.name, candidate.away.name].some((team) => sameTeam(team, bet.opponent)),
  );
  if (!fixture || fixture.status.kind !== "final") return null;
  const backedIsHome = sameTeam(fixture.home.name, bet.team);
  const backedGoals = backedIsHome ? fixture.status.homeGoals : fixture.status.awayGoals;
  const opposingGoals = backedIsHome ? fixture.status.awayGoals : fixture.status.homeGoals;
  if (backedGoals === opposingGoals) return null;
  return { ...bet, status: backedGoals > opposingGoals ? "won" : "lost" };
}

async function settlePendingPredictions(now: Date): Promise<void> {
  const pending = (await listPredictions()).filter((prediction) => prediction.terminal === null);
  for (const prediction of pending) {
    let fixture: Fixture;
    try {
      fixture = await fetchFixtureById(prediction.placed.fixture.id);
    } catch (error) {
      console.error(`[bets] failed to fetch fixture ${prediction.placed.fixture.id}`, error);
      continue;
    }

    if (fixture.status.kind === "cancelled") {
      await writePredictionTerminal(prediction.placed.id, {
        at: now.toISOString(),
        kind: "void",
        reason: "fixture_cancelled",
        schemaVersion: 2,
      });
      continue;
    }
    if (fixture.status.kind !== "final") continue;
    const actual = { awayGoals: fixture.status.awayGoals, homeGoals: fixture.status.homeGoals };
    await writePredictionTerminal(prediction.placed.id, {
      actual,
      at: now.toISOString(),
      kind: "settled",
      result: settleExactScore({ actual, prediction: prediction.placed.prediction }),
      schemaVersion: 2,
    });
  }
}

function resultMessage(prediction: PredictionView): string {
  const terminal = prediction.terminal;
  if (!terminal || terminal.kind !== "settled") throw new Error("Prediction is not settled.");
  const fixture = prediction.placed.fixture;
  return [
    `${fixture.home.name} ${terminal.actual.homeGoals}–${terminal.actual.awayGoals} ${fixture.away.name}.`,
    `The prediction was ${fixture.home.name} ${prediction.placed.prediction.homeGoals}–${prediction.placed.prediction.awayGoals} ${fixture.away.name}.`,
    terminal.result === "hit" ? "Exact hit." : "Miss.",
  ].join(" ");
}

async function sendPendingNotifications(input: {
  readonly appAuth: ScheduleHandlerArgs["appAuth"];
  readonly receive: ScheduleHandlerArgs["receive"];
}): Promise<void> {
  const settled = (await listPredictions()).filter(
    (prediction) => prediction.terminal?.kind === "settled" && !prediction.notified,
  );
  for (const prediction of settled) {
    const followUp = prediction.placed.followUp;
    if (followUp.kind === "pull_only") continue;
    const message = resultMessage(prediction);
    if (followUp.kind === "slack") {
      await input.receive(slack, {
        auth: input.appAuth,
        message: `Follow up on a fictitious exact-score prediction. Mention <@${followUp.userId}>. ${message} Keep it warm and brief; no money was involved.`,
        target: { channelId: followUp.channelId },
      });
    } else {
      await input.receive(x, {
        auth: input.appAuth,
        message: `Reply in this public X thread with the fictitious score-prediction result. ${message} Stay under 280 characters and do not imply money was involved.`,
        target: { adapterName: "x", threadId: followUp.threadId },
      });
    }
    await markPredictionNotified(prediction.placed.id);
  }
}

export async function settleBets(input: {
  readonly appAuth: ScheduleHandlerArgs["appAuth"];
  readonly now?: Date;
  readonly receive: ScheduleHandlerArgs["receive"];
}): Promise<void> {
  const now = input.now ?? new Date();
  await settlePendingPredictions(now);
  await sendPendingNotifications(input);

  const legacyPending = (await listBets()).filter((bet) => bet.status === "pending");
  for (const bet of legacyPending) {
    try {
      const settled = await settleLegacyBet(bet);
      if (settled) await saveBet(settled);
    } catch (error) {
      console.error(`[bets] failed to settle legacy bet ${bet.id}`, error);
    }
  }
}

export default defineSchedule({
  cron: "*/5 * * * *",
  run({ receive, waitUntil, appAuth }) {
    waitUntil(settleBets({ appAuth, receive }));
  },
});
