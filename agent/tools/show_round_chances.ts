import { defineTool } from "eve/tools";
import { z } from "zod";

// Polymarket's reach-round ladder. There is no reach-round-of-32 event; R32 is
// derived: settled R16 implies the team already came through R32.
const LADDER = [
  { key: "r16", slug: "world-cup-nation-to-reach-round-of-16" },
  { key: "qf", slug: "world-cup-nation-to-reach-quarterfinals" },
  { key: "sf", slug: "world-cup-nation-to-reach-semifinals" },
  { key: "final", slug: "world-cup-nation-to-reach-final" },
  { key: "cup", slug: "world-cup-winner" },
] as const;

type LadderKey = (typeof LADDER)[number]["key"];

// A market priced at effectively 1 means the round was already reached.
const SETTLED_PCT = 99.5;

/** "in" = reached, number = implied probability %, null = no market data. */
type Cell = "in" | number | null;

// The 48 qualified nations as Polymarket names them -> flagcdn codes.
const FLAGS: Record<string, string> = {
  Algeria: "dz",
  Argentina: "ar",
  Australia: "au",
  Austria: "at",
  Belgium: "be",
  "Bosnia and Herzegovina": "ba",
  Brazil: "br",
  Canada: "ca",
  "Cape Verde": "cv",
  Colombia: "co",
  Croatia: "hr",
  Curacao: "cw",
  Czechia: "cz",
  "DR Congo": "cd",
  Ecuador: "ec",
  Egypt: "eg",
  England: "gb-eng",
  France: "fr",
  Germany: "de",
  Ghana: "gh",
  Haiti: "ht",
  Iran: "ir",
  Iraq: "iq",
  "Ivory Coast": "ci",
  Japan: "jp",
  Jordan: "jo",
  Mexico: "mx",
  Morocco: "ma",
  Netherlands: "nl",
  "New Zealand": "nz",
  Norway: "no",
  Panama: "pa",
  Paraguay: "py",
  Portugal: "pt",
  Qatar: "qa",
  "Saudi Arabia": "sa",
  Scotland: "gb-sct",
  Senegal: "sn",
  "South Africa": "za",
  "South Korea": "kr",
  Spain: "es",
  Sweden: "se",
  Switzerland: "ch",
  Tunisia: "tn",
  Turkiye: "tr",
  USA: "us",
  Uruguay: "uy",
  Uzbekistan: "uz",
};

interface PolymarketMarket {
  question: string;
  groupItemTitle?: string;
  outcomePrices?: string;
}

async function fetchEventOdds(slug: string): Promise<Map<string, number>> {
  const res = await fetch(`https://gamma-api.polymarket.com/events?slug=${slug}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${slug} responded ${res.status}`);
  const events = (await res.json()) as { markets?: PolymarketMarket[] }[];
  const odds = new Map<string, number>();
  for (const market of events[0]?.markets ?? []) {
    const team = market.groupItemTitle ?? market.question;
    if (!team || !market.outcomePrices) continue;
    const price = Number(JSON.parse(market.outcomePrices)[0]);
    if (Number.isFinite(price)) odds.set(team, Math.round(price * 1000) / 10);
  }
  return odds;
}

function toCell(pct: number | undefined): Cell {
  if (pct === undefined) return null;
  return pct >= SETTLED_PCT ? "in" : pct;
}

export default defineTool({
  description:
    "Show an interactive 'chance to reach each round' table in the web chat UI: one row per team, columns R32 → R16 → QF → SF → FINAL → CUP. It fetches live Polymarket reach-round and winner markets itself — you only choose how many teams to show. Use it for 'who wins the cup' / tournament-picture questions. The table is rendered by the UI; the tool result gives you the headline numbers to write one sentence around — don't restate the full table.",
  inputSchema: z.object({
    title: z.string().min(1).max(64).default("Chance to reach each round"),
    limit: z.number().int().min(2).max(12).default(8).describe("How many teams, top-down by winner probability"),
  }),
  async execute({ title, limit }) {
    const settled = await Promise.allSettled(LADDER.map((rung) => fetchEventOdds(rung.slug)));
    const odds = new Map<LadderKey, Map<string, number>>();
    LADDER.forEach((rung, i) => {
      const result = settled[i];
      if (result.status === "fulfilled") odds.set(rung.key, result.value);
    });

    const cup = odds.get("cup");
    if (!cup || cup.size === 0) {
      return { error: "Polymarket winner market unreachable. Try again shortly." };
    }

    const teams = [...cup.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([team, cupPct]) => {
        const r16 = toCell(odds.get("r16")?.get(team));
        return {
          name: team,
          flag: FLAGS[team] ?? null,
          r32: r16 === "in" ? ("in" as const) : null,
          r16,
          qf: toCell(odds.get("qf")?.get(team)),
          sf: toCell(odds.get("sf")?.get(team)),
          final: toCell(odds.get("final")?.get(team)),
          cup: toCell(cupPct),
        };
      });

    return {
      asOf: new Date().toISOString(),
      source: "Polymarket",
      title,
      subtitle: `Top ${limit}`,
      teams,
    };
  },
  toModelOutput(output) {
    if (!("teams" in output) || output.teams === undefined) {
      return { type: "text", value: `Error: ${"error" in output ? output.error : "no data"}` };
    }
    const lines = output.teams.map((team) => {
      const cells = (["sf", "final", "cup"] as const)
        .map((key) => `${key.toUpperCase()} ${team[key] === "in" ? "in" : team[key] === null ? "–" : `${team[key]}%`}`)
        .join(", ");
      return `${team.name}: ${cells}`;
    });
    return {
      type: "text",
      value: `Table rendered in the chat UI (Polymarket, ${output.asOf}). Headline numbers:\n${lines.join("\n")}`,
    };
  },
});
