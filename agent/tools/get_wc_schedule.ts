import { defineTool } from "eve/tools";
import { z } from "zod";

const TOURNAMENT_FINAL_DATE = "20260719";

interface EspnCompetitor {
  homeAway?: string;
  score?: string;
  winner?: boolean;
  team?: { displayName?: string };
}

interface EspnEvent {
  date: string;
  season?: { slug?: string };
  competitions?: {
    status?: { type?: { state?: string; detail?: string } };
    venue?: { fullName?: string; address?: { city?: string } };
    competitors?: EspnCompetitor[];
  }[];
}

// season.slug -> label used for slot names, matching ESPN's bracket
// placeholders ("Quarterfinal 1 Winner" refers to slot "Quarterfinal 1").
const ROUND_LABELS: Record<string, string> = {
  "round-of-32": "Round of 32",
  "round-of-16": "Round of 16",
  quarterfinals: "Quarterfinal",
  semifinals: "Semifinal",
  "3rd-place-match": "Third place",
  final: "Final",
};

function competitorName(competitor: EspnCompetitor | undefined): string {
  return competitor?.team?.displayName ?? "TBD";
}

function competitorScore(competitor: EspnCompetitor | undefined): number | null {
  const score = Number(competitor?.score);
  return Number.isFinite(score) ? score : null;
}

export default defineTool({
  description:
    "Remaining 2026 FIFA World Cup schedule, from today through the final on 2026-07-19. Returns every fixture with round, kickoff time (UTC), venue, and teams. Future rounds whose teams are not decided yet use bracket placeholders like 'Quarterfinal 1 Winner'; slot names ('Quarterfinal 1') are numbered by kickoff order within each round, so placeholders resolve to earlier fixtures in the list — use that to answer questions about potential matchups. Includes live/final scores for matches already underway.",
  inputSchema: z.object({}),
  async execute() {
    const asOf = new Date().toISOString();
    const today = asOf.slice(0, 10).replaceAll("-", "");

    if (today > TOURNAMENT_FINAL_DATE) {
      return { asOf, matches: [], note: "The tournament ended on 2026-07-19." };
    }

    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${today}-${TOURNAMENT_FINAL_DATE}`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) return { error: `ESPN schedule API responded ${res.status}. Try again shortly.` };
    const data = (await res.json()) as { events?: EspnEvent[] };

    const slotCounts: Record<string, number> = {};
    const matches = (data.events ?? [])
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((event) => {
        const competition = event.competitions?.[0];
        const roundSlug = event.season?.slug ?? "unknown";
        const label = ROUND_LABELS[roundSlug] ?? roundSlug;
        const numbered = roundSlug === "quarterfinals" || roundSlug === "semifinals";
        slotCounts[roundSlug] = (slotCounts[roundSlug] ?? 0) + 1;

        const home = competition?.competitors?.find((c) => c.homeAway === "home");
        const away = competition?.competitors?.find((c) => c.homeAway === "away");
        const state = competition?.status?.type?.state ?? "pre";

        return {
          slot: numbered ? `${label} ${slotCounts[roundSlug]}` : label,
          round: label,
          kickoffUtc: event.date,
          venue: competition?.venue?.fullName ?? null,
          city: competition?.venue?.address?.city ?? null,
          home: competitorName(home),
          away: competitorName(away),
          status:
            state === "pre" ? "scheduled" : state === "in" ? "in play" : "full time",
          ...(state !== "pre" && {
            score: `${competitorName(home)} ${competitorScore(home) ?? "?"}–${competitorScore(away) ?? "?"} ${competitorName(away)}`,
          }),
        };
      });

    if (matches.length === 0) {
      return { error: "ESPN returned no fixtures for the remaining tournament dates. Try again shortly." };
    }

    return { asOf, source: "ESPN", matches };
  },
});
