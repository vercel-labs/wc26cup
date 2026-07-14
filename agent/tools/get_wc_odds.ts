import { defineTool } from "eve/tools";
import { z } from "zod";
import { aliveTeamNames, fetchFixtureById, FixtureIdSchema } from "../lib/fixtures.js";
import { fetchMatchMarkets } from "../lib/odds.js";

// Market team names (Polymarket/Kalshi) vs fixture names (ESPN). Normalize and
// alias the few known divergences so the bracket cross-check matches reliably.
const TEAM_ALIASES: Readonly<Record<string, string>> = {
  korearepublic: "southkorea",
  unitedstates: "usa",
};

function normalizeTeamName(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z]/gu, "");
  return TEAM_ALIASES[base] ?? base;
}

function isTeamAlive(team: string, alive: ReadonlySet<string>): boolean {
  const normalized = normalizeTeamName(team);
  if (alive.has(normalized)) return true;
  for (const name of alive) {
    if (name.length > 3 && (name.includes(normalized) || normalized.includes(name))) {
      return true;
    }
  }
  return false;
}

const POLYMARKET_WINNER_SLUG = "world-cup-winner";
const KALSHI_WINNER_SERIES = "KXMENWORLDCUP";

const PolymarketMarketSchema = z.object({
  closed: z.boolean().optional(),
  groupItemTitle: z.string().optional(),
  id: z.string().min(1),
  outcomePrices: z.string().optional(),
  outcomes: z.string().optional(),
  question: z.string().min(1),
  slug: z.string().min(1),
});

const PolymarketEventSchema = z.object({
  closed: z.boolean().optional(),
  endDate: z.string().optional(),
  markets: z.array(PolymarketMarketSchema).default([]),
  slug: z.string().min(1),
  title: z.string().min(1),
});

const PolymarketEventsSchema = z.array(PolymarketEventSchema);
const PolymarketSearchSchema = z.object({ events: z.array(PolymarketEventSchema).default([]) });
const KalshiWinnerSchema = z.object({
  markets: z.array(z.object({ last_price_dollars: z.string().optional(), yes_sub_title: z.string().optional() })).default([]),
});
const EmbeddedPricesSchema = z.array(z.string()).min(1);

const InputSchema = z.discriminatedUnion("view", [
  z.object({ limit: z.number().int().min(1).max(20).default(10), view: z.literal("winner") }),
  z.object({ limit: z.number().int().min(1).max(20).default(10), query: z.string().min(2), view: z.literal("search") }),
  z.object({
    contractKind: z.enum(["advance", "regulation_time"]),
    fixtureId: FixtureIdSchema,
    view: z.literal("match"),
  }),
]);

const FlatInputSchema = z.object({
  view: z.enum(["winner", "search", "match"]),
  limit: z.number().int().min(1).max(20).optional(),
  query: z.string().min(2).optional(),
  contractKind: z.enum(["advance", "regulation_time"]).optional(),
  fixtureId: FixtureIdSchema.optional(),
});

async function fetchUnknown(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} responded ${response.status}.`);
  const value: unknown = await response.json();
  return value;
}

function polymarketYesPct(market: z.infer<typeof PolymarketMarketSchema>): number | null {
  if (!market.outcomePrices) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(market.outcomePrices);
  } catch {
    return null;
  }
  const prices = EmbeddedPricesSchema.safeParse(raw);
  if (!prices.success) return null;
  const price = z.coerce.number().min(0).max(1).safeParse(prices.data[0]);
  return price.success ? Math.round(price.data * 1000) / 10 : null;
}

async function fetchPolymarketWinnerOdds(): Promise<Map<string, number>> {
  const url = `https://gamma-api.polymarket.com/events?slug=${POLYMARKET_WINNER_SLUG}`;
  const events = PolymarketEventsSchema.parse(await fetchUnknown(url));
  const odds = new Map<string, number>();
  for (const market of events[0]?.markets ?? []) {
    const team = market.groupItemTitle ?? market.question;
    const pct = polymarketYesPct(market);
    if (team && pct !== null) odds.set(team, pct);
  }
  return odds;
}

async function fetchKalshiWinnerOdds(): Promise<Map<string, number>> {
  const url = `https://api.elections.kalshi.com/trade-api/v2/markets?limit=100&status=open&series_ticker=${KALSHI_WINNER_SERIES}`;
  const data = KalshiWinnerSchema.parse(await fetchUnknown(url));
  const odds = new Map<string, number>();
  for (const market of data.markets) {
    const price = z.coerce.number().min(0).max(1).safeParse(market.last_price_dollars);
    if (market.yes_sub_title && price.success && price.data > 0) {
      odds.set(market.yes_sub_title, Math.round(price.data * 1000) / 10);
    }
  }
  return odds;
}

async function searchPolymarket(query: string, limit: number) {
  const url = `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(`world cup ${query}`)}&limit_per_type=${limit}`;
  const data = PolymarketSearchSchema.parse(await fetchUnknown(url));
  return data.events
    .filter((event) => !event.closed)
    .slice(0, limit)
    .map((event) => ({
      endDate: event.endDate ?? null,
      slug: event.slug,
      title: event.title,
      topOutcomes: event.markets
        .map((market) => ({ name: market.groupItemTitle ?? market.question, pct: polymarketYesPct(market) }))
        .filter((outcome): outcome is { name: string; pct: number } => outcome.pct !== null)
        .sort((left, right) => right.pct - left.pct)
        .slice(0, 8),
    }));
}

export default defineTool({
  description:
    "Fresh World Cup 2026 prediction-market prices. 'match' fetches Polymarket and Kalshi for one stable fixture ID and one settlement contract. Use 'advance' for a knockout winner including extra time/penalties; use 'regulation_time' for 90-minute home/draw/away. 'winner' is tournament champion only. Never include teams already eliminated from the World Cup (knocked out) in rankings or leaderboards — only teams still in the tournament, even if a market still lists an eliminated team at ~0%. Never compare unlike contract kinds.",
  inputSchema: FlatInputSchema,
  async execute(rawInput) {
    const parsed = InputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid get_wc_odds input." };
    }
    const input = parsed.data;
    if (input.view === "match") {
      try {
        const fixture = await fetchFixtureById(input.fixtureId);
        return {
          contractKind: input.contractKind,
          fixture: { away: fixture.away, fixtureId: fixture.id, home: fixture.home, round: fixture.round },
          ...(await fetchMatchMarkets(fixture, input.contractKind)),
        };
      } catch (error) {
        return { error: String(error) };
      }
    }

    const asOf = new Date().toISOString();
    if (input.view === "search") {
      try {
        return { asOf, results: await searchPolymarket(input.query, input.limit), source: "polymarket" };
      } catch (error) {
        return { error: String(error) };
      }
    }

    const [polymarket, kalshi] = await Promise.allSettled([
      fetchPolymarketWinnerOdds(),
      fetchKalshiWinnerOdds(),
    ]);
    const polymarketOdds = polymarket.status === "fulfilled" ? polymarket.value : new Map<string, number>();
    const kalshiOdds = kalshi.status === "fulfilled" ? kalshi.value : new Map<string, number>();
    if (polymarketOdds.size === 0 && kalshiOdds.size === 0) {
      return { error: "Both Polymarket and Kalshi were unreachable. Try again shortly." };
    }
    const teams = new Set([...polymarketOdds.keys(), ...kalshiOdds.keys()]);
    let ranked = [...teams]
      .map((team) => ({
        kalshiPct: kalshiOdds.get(team) ?? null,
        polymarketPct: polymarketOdds.get(team) ?? null,
        team,
      }))
      .sort((left, right) => (right.polymarketPct ?? right.kalshiPct ?? 0) - (left.polymarketPct ?? left.kalshiPct ?? 0));

    // Cross-check the bracket: drop teams with no upcoming fixture (knocked out),
    // even if a market still lists them at ~0%. Fail open — if the fixture fetch
    // errors or would empty the list, keep the raw market ranking rather than
    // returning nothing.
    const aliveList = await aliveTeamNames().catch(() => [] as string[]);
    if (aliveList.length > 0) {
      const alive = new Set(aliveList.map(normalizeTeamName));
      const stillIn = ranked.filter((entry) => isTeamAlive(entry.team, alive));
      if (stillIn.length > 0) {
        ranked = stillIn;
      }
    }

    return {
      asOf,
      market: "2026 Men's World Cup winner (market-implied probability, %)",
      sources: {
        kalshi: kalshiOdds.size > 0 ? "ok" : "unavailable",
        polymarket: polymarketOdds.size > 0 ? "ok" : "unavailable",
      },
      teams: ranked.slice(0, input.limit),
    };
  },
});
