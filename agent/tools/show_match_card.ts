import { defineTool } from "eve/tools";
import { z } from "zod";

const teamSchema = z.object({
  code: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .describe("FIFA trigram, e.g. 'FRA', 'MAR'"),
  name: z.string().min(1).max(32).describe("Full team name, e.g. 'France'"),
  flag: z
    .string()
    .regex(/^[a-z]{2}(-[a-z]{2,3})?$/)
    .describe("Lowercase flagcdn code: ISO 3166-1 alpha-2 ('fr', 'ma'); England is 'gb-eng'"),
  score: z.number().int().min(0).optional().describe("Omit for scheduled matches"),
});

export default defineTool({
  description:
    "Show an interactive match card in the web chat UI: round, kickoff, status, score, and both teams with flags. Use it whenever the conversation centers on one specific fixture from get_wc_schedule. The card is rendered by the UI — do not repeat its contents in your text reply.",
  inputSchema: z.object({
    matchNumber: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Official FIFA match number (e.g. 97). Omit it unless a tool returned one — slot numbers like 'Quarterfinal 1' are NOT match numbers.",
      ),
    round: z.string().min(1).max(24).describe("Short round label, e.g. 'Quarter', 'Semi', 'Final'"),
    kickoff: z
      .string()
      .min(1)
      .max(24)
      .describe("Short kickoff label in the user's frame, e.g. 'Jul 9, 16hs'"),
    status: z.enum(["scheduled", "live", "full time"]),
    home: teamSchema,
    away: teamSchema,
  }),
  async execute(input) {
    return input;
  },
  toModelOutput() {
    return {
      type: "text",
      value: "Match card rendered in the chat UI. Don't restate the fixture details.",
    };
  },
});
