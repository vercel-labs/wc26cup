import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";

export default defineDynamic({
  events: {
    "session.started": (_event, ctx) => {
      const auth = ctx.session.auth.initiator;
      if (auth?.authenticator === "app" && auth.principalId === "eve:app") return null;

      return {
        web_search: defineTool({
          description:
            "Generic web search is unavailable in user conversations. For fixtures, kickoff times, venues, or what to watch next, call get_wc_schedule. For prediction-market prices, call get_wc_odds. For stored tournament stories, call get_wc_facts.",
          inputSchema: z.object({ query: z.string().min(1) }),
          execute: async ({ query }) => ({
            error: "Use a typed World Cup tool in user conversations.",
            query,
            routes: {
              facts: "get_wc_facts",
              fixtures: "get_wc_schedule",
              odds: "get_wc_odds",
            },
          }),
        }),
      };
    },
  },
});
