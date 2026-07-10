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
});

export default defineTool({
  description:
    "Show the knockout bracket in the web chat UI as columns of rounds (e.g. Quarterfinals → Semifinals → Final). Build it from get_wc_schedule: use a null team for a slot that isn't decided yet (renders as TBD), and set `winner` only for matches already played. Use it for 'show the bracket' / 'path to the final' questions. The bracket renders in the UI; don't restate every matchup in text.",
  inputSchema: z.object({
    rounds: z
      .array(
        z.object({
          name: z.string().min(1).max(24).describe("Round label, e.g. 'Quarterfinals', 'Final'"),
          matches: z
            .array(
              z.object({
                home: teamSchema.nullable().describe("null when the slot isn't decided yet"),
                away: teamSchema.nullable().describe("null when the slot isn't decided yet"),
                winner: z
                  .enum(["home", "away"])
                  .nullable()
                  .optional()
                  .describe("Set only for a match already played"),
              }),
            )
            .min(1)
            .max(8),
        }),
      )
      .min(1)
      .max(4),
  }),
  async execute(input) {
    return input;
  },
  toModelOutput() {
    return {
      type: "text",
      value: "Bracket rendered in the chat UI. Don't restate every matchup.",
    };
  },
});
