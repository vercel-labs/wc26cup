import { defineTool } from "eve/tools";
import { z } from "zod";
import { listNotes } from "../lib/notes.js";

export default defineTool({
  description:
    "Read your in-tournament memory: noteworthy World Cup 2026 facts collected by the news sweep (results, records, storylines). This is your only legitimate source of in-tournament lore — use a note as one line of color when it touches the current conversation. Optionally filter by team.",
  inputSchema: z.object({
    team: z.string().min(2).optional().describe("Only notes involving this team, e.g. 'Morocco'"),
    limit: z.number().int().min(1).max(50).default(15),
  }),
  async execute({ team, limit }) {
    let notes = await listNotes();
    if (team) {
      const needle = team.toLowerCase();
      notes = notes.filter((note) => note.teams.some((t) => t.toLowerCase().includes(needle)));
    }
    return { notes: notes.slice(0, limit) };
  },
});
