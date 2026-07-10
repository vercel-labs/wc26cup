import { defineTool } from "eve/tools";
import { z } from "zod";

const teamSchema = z.object({
  code: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .describe("FIFA trigram, e.g. 'FRA'"),
  name: z.string().min(1).max(32).describe("Full team name, e.g. 'France'"),
  flag: z
    .string()
    .regex(/^[a-z]{2}(-[a-z]{2,3})?$/)
    .describe("Lowercase flagcdn code: ISO 3166-1 alpha-2 ('fr'); England is 'gb-eng'"),
  pct: z
    .number()
    .min(0)
    .max(100)
    .nullable()
    .optional()
    .describe("Title-winning % from get_wc_odds; omit if unknown"),
});

export default defineTool({
  description:
    "Show the World Cup title-race leaderboard in the web chat: contenders ranked by championship odds. Pull the ranking from `get_wc_odds` (winner market) first, then pass the teams highest-odds first. Use it for 'who's the favorite', 'power ranking', or 'leaderboard' questions about the tournament. The board renders in the UI; write one line around the top and don't restate the list.",
  inputSchema: z.object({
    title: z.string().min(1).max(48).default("Title race"),
    teams: z
      .array(teamSchema)
      .min(2)
      .max(16)
      .describe("Teams ranked by title-winning odds, highest first"),
  }),
  async execute(input) {
    return input;
  },
  toModelOutput() {
    return {
      type: "text",
      value: "Title-race leaderboard rendered in the chat UI. Don't restate the list.",
    };
  },
});
