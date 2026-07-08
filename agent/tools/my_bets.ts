import { defineTool } from "eve/tools";
import { z } from "zod";
import { listBets } from "../lib/bets.js";
import { betIdentity } from "../lib/identity.js";

export default defineTool({
  description:
    "List the current user's fictitious bets — pending and settled. Use when they ask about their bet, whether they won, or what's riding on a match. Statuses: pending (match not settled yet), won, lost, void (they called it off).",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const identity = betIdentity(ctx.session.auth.current);
    if (!identity) {
      return { error: "This session has no authenticated principal — no bets to look up." };
    }
    const bets = (await listBets())
      .filter((bet) => bet.principalId === identity.principalId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { mention: identity.mention, bets };
  },
});
