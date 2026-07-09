import { defineTool } from "eve/tools";
import { z } from "zod";
import { listPredictions } from "../lib/bets.js";
import { predictionIdentity, samePredictionOwner } from "../lib/identity.js";

export default defineTool({
  description:
    "List the current user's fictitious exact-score predictions and their pending, hit, miss, or void result.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const identity = predictionIdentity(ctx.session.auth.current, ctx.session.id);
    if (!identity) return { error: "This session has no stable prediction identity." };
    const predictions = (await listPredictions()).filter((candidate) =>
      samePredictionOwner(candidate.placed.owner, identity.owner),
    );
    return { mention: identity.mention, predictions };
  },
});
