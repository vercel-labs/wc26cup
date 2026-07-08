import { defineTool } from "eve/tools";
import { z } from "zod";
import { listPendingBets, saveBet } from "../lib/bets.js";
import { sameFixture } from "../lib/fixtures.js";
import { betIdentity } from "../lib/identity.js";

export default defineTool({
  description:
    "Call off the current user's own pending fictitious bet on a match. Only the user who placed a bet can call it off, and only when they explicitly ask to — never cancel a bet on your own initiative. Identify the match by the two teams and the UTC fixture date of the recorded bet.",
  inputSchema: z.object({
    team: z.string().min(2).describe("Team the user backed"),
    opponent: z.string().min(2).describe("The opposing team"),
    fixtureDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("UTC kickoff date of the bet's fixture, YYYY-MM-DD"),
  }),
  async execute({ team, opponent, fixtureDate }, ctx) {
    const identity = betIdentity(ctx.session.auth.current);
    if (!identity) {
      return { error: "This session has no authenticated principal — I can't tell whose bet to call off." };
    }

    const bet = (await listPendingBets()).find(
      (candidate) =>
        candidate.principalId === identity.principalId &&
        sameFixture(candidate, { team, opponent, fixtureDate }),
    );
    if (!bet) {
      return { error: `${identity.mention} has no pending bet on ${team} vs ${opponent} on ${fixtureDate} (UTC).` };
    }

    await saveBet({ ...bet, status: "void" });
    return { cancelled: bet, mention: identity.mention };
  },
});
