import { defineTool } from "eve/tools";
import { z } from "zod";

const POLYMARKET_WINNER_SLUG = "world-cup-winner";
const KALSHI_WINNER_SERIES = "KXMENWORLDCUP";

interface TeamOdds {
  team: string;
  polymarketPct: number | null;
  kalshiPct: number | null;
}

interface PolymarketMarket {
  question: string;
  groupItemTitle?: string;
  outcomes?: string;
  outcomePrices?: string;
}

interface PolymarketEvent {
  title: string;
  slug: string;
  endDate?: string;
  closed?: boolean;
  volume?: number;
  markets?: PolymarketMarket[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return (await res.json()) as T;
}

/** First outcome ("Yes") price of a Polymarket market, as a percentage. */
function polymarketYesPct(market: PolymarketMarket): number | null {
  if (!market.outcomePrices) return null;
  const price = Number(JSON.parse(market.outcomePrices)[0]);
  return Number.isFinite(price) ? Math.round(price * 1000) / 10 : null;
}

async function fetchPolymarketWinnerOdds(): Promise<Map<string, number>> {
  const events = await fetchJson<PolymarketEvent[]>(
    `https://gamma-api.polymarket.com/events?slug=${POLYMARKET_WINNER_SLUG}`,
  );
  const odds = new Map<string, number>();
  for (const market of events[0]?.markets ?? []) {
    const team = market.groupItemTitle ?? market.question;
    const pct = polymarketYesPct(market);
    if (team && pct !== null) odds.set(team, pct);
  }
  return odds;
}

async function fetchKalshiWinnerOdds(): Promise<Map<string, number>> {
  const data = await fetchJson<{
    markets: { yes_sub_title?: string; last_price_dollars?: string }[];
  }>(
    `https://api.elections.kalshi.com/trade-api/v2/markets?limit=100&status=open&series_ticker=${KALSHI_WINNER_SERIES}`,
  );
  const odds = new Map<string, number>();
  for (const market of data.markets) {
    const price = Number(market.last_price_dollars);
    if (market.yes_sub_title && Number.isFinite(price) && price > 0) {
      odds.set(market.yes_sub_title, Math.round(price * 1000) / 10);
    }
  }
  return odds;
}

async function searchPolymarket(query: string, limit: number) {
  const data = await fetchJson<{ events?: PolymarketEvent[] }>(
    `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(`world cup ${query}`)}&limit_per_type=${limit}`,
  );
  return (data.events ?? [])
    .filter((event) => !event.closed)
    .slice(0, limit)
    .map((event) => ({
      title: event.title,
      slug: event.slug,
      endDate: event.endDate ?? null,
      topOutcomes: (event.markets ?? [])
        .map((market) => ({
          name: market.groupItemTitle ?? market.question,
          pct: polymarketYesPct(market),
        }))
        .filter((outcome) => outcome.pct !== null)
        .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))
        .slice(0, 8),
    }));
}

export default defineTool({
  description:
    "Live 2026 FIFA World Cup prediction-market odds. Pick the view that matches the question's scope: 'winner' answers ONLY 'who wins the whole tournament' (implied probabilities from Polymarket and Kalshi, merged by team). For anything about a specific match, team-vs-team, reaching a round, or golden boot, use 'search' with the team/topic as the query.",
  inputSchema: z.object({
    view: z
      .enum(["winner", "search"])
      .describe(
        "'winner' = tournament champion only. 'search' = specific matches, rounds, props. A question about one match is never 'winner'.",
      ),
    query: z
      .string()
      .min(2)
      .optional()
      .describe("Required for view 'search': e.g. 'golden boot', 'France final'"),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  async execute({ view, query, limit }) {
    const asOf = new Date().toISOString();

    if (view === "search") {
      if (!query) return { error: "view 'search' requires a query" };
      return { asOf, source: "polymarket", results: await searchPolymarket(query, limit) };
    }

    const [polymarket, kalshi] = await Promise.allSettled([
      fetchPolymarketWinnerOdds(),
      fetchKalshiWinnerOdds(),
    ]);
    const pmOdds = polymarket.status === "fulfilled" ? polymarket.value : new Map<string, number>();
    const kalshiOdds = kalshi.status === "fulfilled" ? kalshi.value : new Map<string, number>();
    if (pmOdds.size === 0 && kalshiOdds.size === 0) {
      return { error: "Both Polymarket and Kalshi were unreachable. Try again shortly." };
    }

    const teams = new Set([...pmOdds.keys(), ...kalshiOdds.keys()]);
    const merged: TeamOdds[] = [...teams]
      .map((team) => ({
        team,
        polymarketPct: pmOdds.get(team) ?? null,
        kalshiPct: kalshiOdds.get(team) ?? null,
      }))
      .sort((a, b) => (b.polymarketPct ?? b.kalshiPct ?? 0) - (a.polymarketPct ?? a.kalshiPct ?? 0))
      .slice(0, limit);

    return {
      asOf,
      sources: {
        polymarket: pmOdds.size > 0 ? "ok" : "unavailable",
        kalshi: kalshiOdds.size > 0 ? "ok" : "unavailable",
      },
      market: "2026 Men's World Cup winner (implied probability, %)",
      teams: merged,
    };
  },
});
