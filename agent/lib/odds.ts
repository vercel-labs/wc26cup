import { z } from "zod";
import type { Fixture } from "./fixtures.js";

export type ContractKind = "advance" | "regulation_time";
export type OddsProvider = "kalshi" | "polymarket";

export interface ComparableQuote {
  readonly contractKind: ContractKind;
  readonly fetchedAt: string;
  readonly homePct: number;
  readonly provider: OddsProvider;
}

export interface MatchMarketQuote extends ComparableQuote {
  readonly awayPct: number;
  readonly basis: "last_trade" | "midpoint" | "mixed";
  readonly drawPct: number | null;
  readonly marketId: string;
  readonly sourceUrl: string;
}

export function comparableQuotes(
  left: ComparableQuote,
  right: ComparableQuote,
): { readonly kalshi: ComparableQuote; readonly polymarket: ComparableQuote } | null {
  if (left.contractKind !== right.contractKind || left.provider === right.provider) return null;
  return left.provider === "polymarket"
    ? { kalshi: right, polymarket: left }
    : { kalshi: left, polymarket: right };
}

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
  id: z.string().min(1),
  markets: z.array(PolymarketMarketSchema).default([]),
  slug: z.string().min(1),
  title: z.string().min(1),
});

const PolymarketSearchSchema = z.object({ events: z.array(PolymarketEventSchema).default([]) });
const PolymarketEventsSchema = z.array(PolymarketEventSchema);

const KalshiMarketSchema = z.object({
  event_ticker: z.string().min(1),
  last_price_dollars: z.string().nullable().optional(),
  status: z.string().min(1),
  ticker: z.string().min(1),
  title: z.string().min(1),
  yes_ask_dollars: z.string().nullable().optional(),
  yes_bid_dollars: z.string().nullable().optional(),
  yes_sub_title: z.string().nullable().optional(),
});

const KalshiMarketsSchema = z.object({ markets: z.array(KalshiMarketSchema).default([]) });
const PriceArraySchema = z.array(z.string()).min(2);
const OutcomeArraySchema = z.array(z.string()).min(2);

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function includesTeam(value: string, team: string): boolean {
  return normalize(value).includes(normalize(team));
}

async function fetchUnknown(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} responded ${response.status}.`);
  const value: unknown = await response.json();
  return value;
}

function jsonString<T>(schema: z.ZodType<T>, value: string): T {
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    throw new Error("Prediction-market API returned malformed embedded JSON.");
  }
  return schema.parse(raw);
}

function polymarketYesPrice(market: z.infer<typeof PolymarketMarketSchema>): number {
  if (!market.outcomes || !market.outcomePrices) {
    throw new Error(`Polymarket market ${market.id} has no outcome prices.`);
  }
  const outcomes = jsonString(OutcomeArraySchema, market.outcomes);
  const prices = jsonString(PriceArraySchema, market.outcomePrices);
  const yesIndex = outcomes.findIndex((outcome) => normalize(outcome) === "yes");
  if (yesIndex < 0) throw new Error(`Polymarket market ${market.id} has no Yes outcome.`);
  const parsed = z.coerce.number().min(0).max(1).parse(prices[yesIndex]);
  return Math.round(parsed * 1000) / 10;
}

function findPolymarketTeamMarket(
  event: z.infer<typeof PolymarketEventSchema>,
  team: string,
): z.infer<typeof PolymarketMarketSchema> {
  const market = event.markets.find(
    (candidate) =>
      !candidate.closed &&
      (normalize(candidate.groupItemTitle ?? "") === normalize(team) || includesTeam(candidate.question, team)),
  );
  if (!market) throw new Error(`Polymarket has no open ${team} contract for ${event.title}.`);
  return market;
}

function polymarketQuote(input: {
  readonly contractKind: ContractKind;
  readonly event: z.infer<typeof PolymarketEventSchema>;
  readonly fetchedAt: string;
  readonly fixture: Fixture;
}): MatchMarketQuote {
  const home = findPolymarketTeamMarket(input.event, input.fixture.home.name);
  const away = findPolymarketTeamMarket(input.event, input.fixture.away.name);
  const draw = input.contractKind === "regulation_time"
    ? input.event.markets.find((market) => !market.closed && normalize(market.groupItemTitle ?? "").startsWith("draw"))
    : undefined;
  if (input.contractKind === "regulation_time" && !draw) {
    throw new Error(`Polymarket regulation market ${input.event.title} has no draw contract.`);
  }
  return {
    awayPct: polymarketYesPrice(away),
    basis: "last_trade",
    contractKind: input.contractKind,
    drawPct: draw ? polymarketYesPrice(draw) : null,
    fetchedAt: input.fetchedAt,
    homePct: polymarketYesPrice(home),
    marketId: input.event.id,
    provider: "polymarket",
    sourceUrl: `https://polymarket.com/event/${input.event.slug}`,
  };
}

async function fetchPolymarketRegulation(fixture: Fixture, fetchedAt: string): Promise<MatchMarketQuote> {
  const query = encodeURIComponent(`world cup ${fixture.home.name} ${fixture.away.name}`);
  const url = `https://gamma-api.polymarket.com/public-search?q=${query}&limit_per_type=20`;
  const data = PolymarketSearchSchema.parse(await fetchUnknown(url));
  const event = data.events.find(
    (candidate) =>
      !candidate.closed &&
      includesTeam(candidate.title, fixture.home.name) &&
      includesTeam(candidate.title, fixture.away.name) &&
      candidate.markets.some((market) => normalize(market.groupItemTitle ?? "").startsWith("draw")),
  );
  if (!event) throw new Error("Polymarket has no open regulation-time market for this fixture.");
  return polymarketQuote({ contractKind: "regulation_time", event, fetchedAt, fixture });
}

function advanceSlug(round: string): string | null {
  if (round === "Round of 32") return "world-cup-nation-to-reach-round-of-16";
  if (round === "Round of 16") return "world-cup-nation-to-reach-quarterfinals";
  if (round === "Quarterfinal") return "world-cup-nation-to-reach-semifinals";
  if (round === "Semifinal") return "world-cup-nation-to-reach-final";
  if (round === "Final") return "world-cup-winner";
  return null;
}

async function fetchPolymarketAdvance(fixture: Fixture, fetchedAt: string): Promise<MatchMarketQuote> {
  const slug = advanceSlug(fixture.round);
  if (!slug) throw new Error(`No advance contract mapping exists for ${fixture.round}.`);
  const url = `https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`;
  const events = PolymarketEventsSchema.parse(await fetchUnknown(url));
  const event = events.find((candidate) => !candidate.closed);
  if (!event) throw new Error(`Polymarket has no open ${fixture.round} advance event.`);
  return polymarketQuote({ contractKind: "advance", event, fetchedAt, fixture });
}

function kalshiPrice(market: z.infer<typeof KalshiMarketSchema>): { readonly basis: "last_trade" | "midpoint"; readonly pct: number } {
  const last = z.coerce.number().min(0).max(1).safeParse(market.last_price_dollars);
  if (last.success && last.data > 0) return { basis: "last_trade", pct: Math.round(last.data * 1000) / 10 };
  const bid = z.coerce.number().min(0).max(1).safeParse(market.yes_bid_dollars);
  const ask = z.coerce.number().min(0).max(1).safeParse(market.yes_ask_dollars);
  if (!bid.success || !ask.success) throw new Error(`Kalshi market ${market.ticker} has no usable price.`);
  return { basis: "midpoint", pct: Math.round(((bid.data + ask.data) / 2) * 1000) / 10 };
}

function findKalshiMarket(
  markets: readonly z.infer<typeof KalshiMarketSchema>[],
  fixture: Fixture,
  outcome: "away" | "draw" | "home",
): z.infer<typeof KalshiMarketSchema> {
  const team = outcome === "home" ? fixture.home.name : fixture.away.name;
  const market = markets.find((candidate) => {
    if (candidate.status !== "active") return false;
    if (!includesTeam(candidate.title, fixture.home.name) || !includesTeam(candidate.title, fixture.away.name)) return false;
    const subtitle = normalize(candidate.yes_sub_title ?? "");
    return outcome === "draw" ? subtitle.includes("tie") || subtitle.includes("draw") : includesTeam(subtitle, team);
  });
  if (!market) throw new Error(`Kalshi has no open ${outcome} contract for this fixture.`);
  return market;
}

async function fetchKalshi(fixture: Fixture, contractKind: ContractKind, fetchedAt: string): Promise<MatchMarketQuote> {
  const series = contractKind === "advance" ? "KXWCADVANCE" : "KXWCGAME";
  const url = `https://api.elections.kalshi.com/trade-api/v2/markets?limit=100&status=open&series_ticker=${series}`;
  const data = KalshiMarketsSchema.parse(await fetchUnknown(url));
  const home = findKalshiMarket(data.markets, fixture, "home");
  const away = findKalshiMarket(data.markets, fixture, "away");
  const draw = contractKind === "regulation_time" ? findKalshiMarket(data.markets, fixture, "draw") : null;
  const homePrice = kalshiPrice(home);
  const awayPrice = kalshiPrice(away);
  const drawPrice = draw ? kalshiPrice(draw) : null;
  const bases = new Set([homePrice.basis, awayPrice.basis, ...(drawPrice ? [drawPrice.basis] : [])]);
  return {
    awayPct: awayPrice.pct,
    basis: bases.size === 1 ? homePrice.basis : "mixed",
    contractKind,
    drawPct: drawPrice?.pct ?? null,
    fetchedAt,
    homePct: homePrice.pct,
    marketId: home.event_ticker,
    provider: "kalshi",
    sourceUrl: url,
  };
}

export async function fetchMatchMarkets(
  fixture: Fixture,
  contractKind: ContractKind,
): Promise<{
  readonly asOf: string;
  readonly kalshi: MatchMarketQuote | null;
  readonly polymarket: MatchMarketQuote | null;
  readonly unavailable: readonly { readonly provider: OddsProvider; readonly reason: string }[];
}> {
  const asOf = new Date().toISOString();
  const polymarketPromise = contractKind === "advance"
    ? fetchPolymarketAdvance(fixture, asOf)
    : fetchPolymarketRegulation(fixture, asOf);
  const [polymarket, kalshi] = await Promise.allSettled([
    polymarketPromise,
    fetchKalshi(fixture, contractKind, asOf),
  ]);
  const unavailable: { provider: OddsProvider; reason: string }[] = [];
  if (polymarket.status === "rejected") {
    unavailable.push({ provider: "polymarket", reason: String(polymarket.reason) });
  }
  if (kalshi.status === "rejected") {
    unavailable.push({ provider: "kalshi", reason: String(kalshi.reason) });
  }
  return {
    asOf,
    kalshi: kalshi.status === "fulfilled" ? kalshi.value : null,
    polymarket: polymarket.status === "fulfilled" ? polymarket.value : null,
    unavailable,
  };
}
