import { defineTool } from "eve/tools";
import { z } from "zod";
import { ExactScoreSchema, listPredictions, predictionId, recordExactScore } from "../lib/bets.js";
import { fetchFixtureById, FixtureIdSchema } from "../lib/fixtures.js";
import { predictionIdentity } from "../lib/identity.js";

export default defineTool({
  description:
    "Record one FICTITIOUS exact-score prediction for the current user and fixture. No money or stakes. Call only after explicit agreement and a score. The model supplies fixture ID plus home/away goals; the tool resolves all fixture metadata and follows up automatically only when this surface has a verified push target.",
  inputSchema: z.object({
    awayGoals: ExactScoreSchema.shape.awayGoals.describe("Predicted away-team goals"),
    fixtureId: FixtureIdSchema,
    homeGoals: ExactScoreSchema.shape.homeGoals.describe("Predicted home-team goals"),
  }),
  async execute({ awayGoals, fixtureId, homeGoals }, ctx) {
    const identity = predictionIdentity(ctx.session.auth.current, ctx.session.id);
    if (!identity) return { error: "This session has no stable prediction identity." };

    let fixture;
    try {
      fixture = await fetchFixtureById(fixtureId);
    } catch (error) {
      return { error: String(error) };
    }
    if (fixture.status.kind !== "scheduled") {
      return { error: `${fixture.home.name} vs ${fixture.away.name} is ${fixture.status.kind}; predictions are closed.` };
    }

    const id = predictionId(identity.owner, fixture.id);
    if ((await listPredictions()).some((candidate) => candidate.placed.id === id)) {
      return { error: `${identity.mention} already has a score prediction for this fixture.` };
    }

    const recorded = await recordExactScore({
      fixture,
      followUp: identity.followUp,
      owner: identity.owner,
      prediction: { awayGoals, homeGoals },
    });
    if (!recorded.created) return { error: `${identity.mention} already has a score prediction for this fixture.` };

    return {
      mention: identity.mention,
      prediction: recorded.prediction,
      settlement:
        identity.followUp.kind === "pull_only"
          ? "Settles after full time. Web cannot push, so the user must return to this session for the result."
          : "The bot will follow up on this thread after full time.",
    };
  },
});
