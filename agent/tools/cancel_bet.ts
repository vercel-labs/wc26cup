import { defineTool } from "eve/tools";
import { z } from "zod";
import { listPredictions, writePredictionTerminal } from "../lib/bets.js";
import { FixtureIdSchema } from "../lib/fixtures.js";
import { predictionIdentity, samePredictionOwner } from "../lib/identity.js";

export default defineTool({
  description:
    "Void the current user's own pending fictitious exact-score prediction. Call only when that user explicitly asks to cancel it.",
  inputSchema: z.object({ fixtureId: FixtureIdSchema }),
  async execute({ fixtureId }, ctx) {
    const identity = predictionIdentity(ctx.session.auth.current, ctx.session.id);
    if (!identity) return { error: "This session has no stable prediction identity." };
    const prediction = (await listPredictions()).find(
      (candidate) =>
        candidate.placed.fixture.id === fixtureId &&
        candidate.terminal === null &&
        samePredictionOwner(candidate.placed.owner, identity.owner),
    );
    if (!prediction) return { error: `${identity.mention} has no pending prediction for that fixture.` };
    const cancelled = await writePredictionTerminal(prediction.placed.id, {
      at: new Date().toISOString(),
      kind: "void",
      reason: "user_cancelled",
      schemaVersion: 2,
    });
    return cancelled
      ? { cancelled: prediction.placed, mention: identity.mention }
      : { error: "That prediction was already settled or voided." };
  },
});
