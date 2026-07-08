import { nanoid } from "nanoid";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { listPendingBets, saveBet } from "../lib/bets.js";
import { sameFixture } from "../lib/fixtures.js";
import { betIdentity } from "../lib/identity.js";

export default defineTool({
  description:
    "Record a FICTITIOUS win/lose bet with the current user — no money, no stakes, bragging rights only. Call it only after the user has explicitly agreed to the bet and picked the fixture. The bet is that `team` beats `opponent` in the given match; a scheduled sweep settles it from the final score (and announces it in the channel when the bet was placed from Slack). Returns the recorded bet — confirm it back in one line, using the returned `mention`.",
  inputSchema: z.object({
    team: z.string().min(2).describe("Team the user is backing, e.g. 'England'"),
    opponent: z.string().min(2).describe("Team they must beat, e.g. 'Spain'"),
    round: z.string().min(2).describe("Round label from get_wc_schedule, e.g. 'Quarterfinal'"),
    fixtureDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("UTC kickoff date from get_wc_schedule, YYYY-MM-DD"),
    venue: z.string().optional().describe("Venue name from get_wc_schedule"),
  }),
  async execute({ team, opponent, round, fixtureDate, venue }, ctx) {
    const identity = betIdentity(ctx.session.auth.current);
    if (!identity) {
      return {
        error:
          "This session has no authenticated principal, so I can't know who I'm betting against. Any signed-in surface works (Slack, web chat with auth).",
      };
    }

    const existing = (await listPendingBets()).find(
      (bet) => bet.principalId === identity.principalId && sameFixture(bet, { team, opponent, fixtureDate }),
    );
    if (existing) {
      return {
        error:
          `${identity.mention} already has a bet on this match: ${existing.team} beat ${existing.opponent} ` +
          `(${existing.round}, ${existing.fixtureDate} UTC). One bet per user per match — ` +
          `they can call it off first if they want to change it.`,
      };
    }

    const bet = {
      id: nanoid(10),
      principalId: identity.principalId,
      displayName: identity.displayName,
      slack: identity.slack,
      team,
      opponent,
      round,
      fixtureDate,
      venue: venue ?? null,
      createdAt: new Date().toISOString(),
      status: "pending" as const,
    };
    await saveBet(bet);
    return {
      recorded: bet,
      mention: identity.mention,
      settlement: identity.slack
        ? "Announced automatically in this channel within ~5 minutes of full time."
        : "Settles in the ledger within ~5 minutes of full time — no announcement surface here, so tell the user to ask you about it after the match.",
    };
  },
});
