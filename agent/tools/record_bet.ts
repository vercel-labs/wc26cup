import { nanoid } from "nanoid";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { listPendingBets, saveBet } from "../lib/bets.js";
import { sameFixture } from "../lib/fixtures.js";

interface SlackAuthAttributes {
  user_id?: string;
  user_name?: string;
  full_name?: string;
  channel_id?: string;
}

export default defineTool({
  description:
    "Record a FICTITIOUS win/lose bet with the current user — no money, no stakes, bragging rights only. Call it only after the user has explicitly agreed to the bet and picked the fixture. The bet is that `team` beats `opponent` in the given match; a scheduled sweep settles it from the final score and announces the result in this channel. Returns the recorded bet — confirm it back mentioning the user as <@userId>.",
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
    const auth = ctx.session.auth.current;
    if (auth?.authenticator !== "slack-webhook") {
      return { error: "Bets can only be recorded from Slack — I need to know who I'm betting against." };
    }
    const attributes = auth.attributes as SlackAuthAttributes;
    const userId = attributes.user_id;
    const channelId = attributes.channel_id;
    if (!userId || !channelId) {
      return { error: "Could not resolve the Slack user or channel for this bet." };
    }

    const existing = (await listPendingBets()).find(
      (bet) => bet.userId === userId && sameFixture(bet, { team, opponent, fixtureDate }),
    );
    if (existing) {
      return {
        error:
          `<@${userId}> already has a bet on this match: ${existing.team} beat ${existing.opponent} ` +
          `(${existing.round}, ${existing.fixtureDate} UTC). One bet per user per match — ` +
          `they can call it off first if they want to change it.`,
      };
    }

    const bet = {
      id: nanoid(10),
      userId,
      userName: attributes.user_name ?? attributes.full_name ?? null,
      channelId,
      team,
      opponent,
      round,
      fixtureDate,
      venue: venue ?? null,
      createdAt: new Date().toISOString(),
      status: "pending" as const,
    };
    await saveBet(bet);
    return { recorded: bet };
  },
});
