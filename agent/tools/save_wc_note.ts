import { nanoid } from "nanoid";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { saveNote } from "../lib/notes.js";

export default defineTool({
  description:
    "Append one noteworthy World Cup 2026 fact to your durable memory (used by the news-sweep schedule; get_wc_notes reads it back in conversations). Save only verified, sourced facts about this tournament — a result, a record, a storyline. Never save speculation, jokes, or anything you couldn't cite.",
  inputSchema: z.object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("UTC date of the event, YYYY-MM-DD"),
    teams: z.array(z.string().min(2)).min(1).max(4).describe("Teams involved, full names"),
    note: z
      .string()
      .min(20)
      .max(300)
      .describe("One or two factual sentences, e.g. 'Haaland scored twice as Norway knocked out Brazil 2-1; it is Norway's first World Cup semifinal.'"),
    source: z.string().min(2).max(80).describe("Domain or tool the fact came from, e.g. 'bbc.com' or 'get_wc_schedule'"),
  }),
  async execute({ date, teams, note, source }) {
    const record = { id: nanoid(10), createdAt: new Date().toISOString(), date, teams, note, source };
    await saveNote(record);
    return { saved: record };
  },
});
