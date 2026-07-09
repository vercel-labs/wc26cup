import { createHash } from "node:crypto";
import { z } from "zod";

const TOURNAMENT_FINAL_DATE = "20260719";

export const FixtureIdSchema = z.string().regex(/^\d+$/u, "Expected a numeric ESPN fixture ID.").brand<"FixtureId">();
export const TeamIdSchema = z.string().regex(/^\d+$/u, "Expected a numeric ESPN team ID.").brand<"TeamId">();
export type FixtureId = z.infer<typeof FixtureIdSchema>;
export type TeamId = z.infer<typeof TeamIdSchema>;

const TeamSchema = z.object({
  id: TeamIdSchema,
  name: z.string().min(1),
});

const VenueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unknown") }),
  z.object({
    city: z.string().min(1),
    kind: z.literal("known"),
    name: z.string().min(1),
    timeZone: z.string().min(1).nullable(),
  }),
]);

const FixtureStatusSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scheduled") }),
  z.object({ kind: z.literal("postponed") }),
  z.object({ kind: z.literal("in_play") }),
  z.object({ awayGoals: z.number().int().nonnegative(), homeGoals: z.number().int().nonnegative(), kind: z.literal("final") }),
  z.object({ kind: z.literal("cancelled") }),
]);

export const FixtureSchema = z.object({
  away: TeamSchema,
  home: TeamSchema,
  id: FixtureIdSchema,
  kickoffUtc: z.string().datetime({ offset: true }),
  revision: z.string().min(8),
  round: z.string().min(1),
  slot: z.string().min(1),
  status: FixtureStatusSchema,
  venue: VenueSchema,
});

export type Fixture = z.infer<typeof FixtureSchema>;
export type ScheduledFixture = Fixture & { status: { kind: "scheduled" } | { kind: "postponed" } };

const EspnTeamSchema = z.object({
  displayName: z.string().min(1),
  id: z.string().min(1),
});

const EspnCompetitorSchema = z.object({
  homeAway: z.enum(["home", "away"]),
  id: z.string().min(1),
  score: z.string().optional(),
  team: EspnTeamSchema,
});

const EspnStatusSchema = z.object({
  type: z.object({
    completed: z.boolean().optional(),
    description: z.string().optional(),
    detail: z.string().optional(),
    name: z.string().optional(),
    state: z.enum(["pre", "in", "post"]),
  }),
});

const EspnVenueSchema = z.object({
  address: z.object({ city: z.string().min(1) }),
  fullName: z.string().min(1),
});

const EspnCompetitionSchema = z.object({
  competitors: z.array(EspnCompetitorSchema).min(2),
  date: z.string().datetime({ offset: true }).optional(),
  status: EspnStatusSchema,
  venue: EspnVenueSchema.nullish(),
});

const EspnEventSchema = z.object({
  competitions: z.array(EspnCompetitionSchema).min(1),
  date: z.string().datetime({ offset: true }),
  id: z.string().min(1),
  season: z.object({ slug: z.string().min(1).optional() }).optional(),
});

const EspnScoreboardSchema = z.object({
  events: z.array(EspnEventSchema).default([]),
});

const EspnSummarySchema = z.object({
  gameInfo: z.object({ venue: EspnVenueSchema.nullish() }).optional(),
  header: z.object({
    competitions: z.array(EspnCompetitionSchema).min(1),
    id: z.string().min(1),
    season: z.object({ name: z.string().min(1) }),
  }),
});

const ROUND_LABELS: Readonly<Record<string, string>> = {
  "3rd-place-match": "Third place",
  final: "Final",
  quarterfinals: "Quarterfinal",
  "round-of-16": "Round of 16",
  "round-of-32": "Round of 32",
  semifinals: "Semifinal",
};

const HOST_TIME_ZONES: readonly { readonly needles: readonly string[]; readonly timeZone: string }[] = [
  { needles: ["atlanta"], timeZone: "America/New_York" },
  { needles: ["arlington", "dallas"], timeZone: "America/Chicago" },
  { needles: ["east rutherford", "foxborough", "miami", "new york", "philadelphia"], timeZone: "America/New_York" },
  { needles: ["guadalajara", "mexico city"], timeZone: "America/Mexico_City" },
  { needles: ["houston", "kansas city"], timeZone: "America/Chicago" },
  { needles: ["inglewood", "los angeles", "santa clara", "seattle"], timeZone: "America/Los_Angeles" },
  { needles: ["monterrey"], timeZone: "America/Monterrey" },
  { needles: ["toronto"], timeZone: "America/Toronto" },
  { needles: ["vancouver"], timeZone: "America/Vancouver" },
];

function roundFromSlug(slug: string | undefined): string {
  if (!slug) return "Unknown round";
  return ROUND_LABELS[slug] ?? slug;
}

function roundFromSummary(name: string): string {
  const raw = name.split(",").at(-1)?.trim().toLowerCase() ?? "";
  if (raw.includes("quarterfinal")) return "Quarterfinal";
  if (raw.includes("semifinal")) return "Semifinal";
  if (raw.includes("round of 16")) return "Round of 16";
  if (raw.includes("round of 32")) return "Round of 32";
  if (raw.includes("third") || raw.includes("3rd")) return "Third place";
  if (raw.includes("final")) return "Final";
  return name;
}

function fixtureTeam(competitor: z.infer<typeof EspnCompetitorSchema>): z.infer<typeof TeamSchema> {
  return TeamSchema.parse({ id: competitor.team.id || competitor.id, name: competitor.team.displayName });
}

function competitor(
  competition: z.infer<typeof EspnCompetitionSchema>,
  homeAway: "home" | "away",
): z.infer<typeof EspnCompetitorSchema> {
  const found = competition.competitors.find((entry) => entry.homeAway === homeAway);
  if (!found) throw new Error(`ESPN fixture is missing its ${homeAway} competitor.`);
  return found;
}

function finalGoals(value: string | undefined, side: "home" | "away"): number {
  const parsed = z.coerce.number().int().nonnegative().safeParse(value);
  if (!parsed.success) throw new Error(`ESPN final fixture has no valid ${side} score.`);
  return parsed.data;
}

function fixtureStatus(
  status: z.infer<typeof EspnStatusSchema>,
  home: z.infer<typeof EspnCompetitorSchema>,
  away: z.infer<typeof EspnCompetitorSchema>,
): z.infer<typeof FixtureStatusSchema> {
  const text = [status.type.name, status.type.description, status.type.detail].filter(Boolean).join(" ").toLowerCase();
  if (text.includes("cancel")) return { kind: "cancelled" };
  if (text.includes("postpon")) return { kind: "postponed" };
  if (status.type.state === "in") return { kind: "in_play" };
  if (status.type.state === "post" || status.type.completed) {
    return {
      awayGoals: finalGoals(away.score, "away"),
      homeGoals: finalGoals(home.score, "home"),
      kind: "final",
    };
  }
  return { kind: "scheduled" };
}

function venueTimeZone(name: string, city: string): string | null {
  const value = `${name} ${city}`.toLowerCase();
  return HOST_TIME_ZONES.find((entry) => entry.needles.some((needle) => value.includes(needle)))?.timeZone ?? null;
}

function fixtureVenue(venue: z.infer<typeof EspnVenueSchema> | null | undefined): z.infer<typeof VenueSchema> {
  if (!venue) return { kind: "unknown" };
  return {
    city: venue.address.city,
    kind: "known",
    name: venue.fullName,
    timeZone: venueTimeZone(venue.fullName, venue.address.city),
  };
}

export function fixtureRevision(input: Pick<Fixture, "away" | "home" | "id" | "kickoffUtc">): string {
  return createHash("sha256")
    .update([input.id, input.kickoffUtc, input.home.id, input.away.id].join("\0"))
    .digest("hex")
    .slice(0, 16);
}

function buildFixture(input: {
  readonly away: z.infer<typeof EspnCompetitorSchema>;
  readonly competition: z.infer<typeof EspnCompetitionSchema>;
  readonly home: z.infer<typeof EspnCompetitorSchema>;
  readonly id: string;
  readonly kickoffUtc: string;
  readonly round: string;
  readonly slot: string;
  readonly venue: z.infer<typeof EspnVenueSchema> | null | undefined;
}): Fixture {
  const base = {
    away: fixtureTeam(input.away),
    home: fixtureTeam(input.home),
    id: FixtureIdSchema.parse(input.id),
    kickoffUtc: input.kickoffUtc,
  };
  return FixtureSchema.parse({
    ...base,
    revision: fixtureRevision(base),
    round: input.round,
    slot: input.slot,
    status: fixtureStatus(input.competition.status, input.home, input.away),
    venue: fixtureVenue(input.venue),
  });
}

export function parseEspnScoreboard(value: unknown): readonly Fixture[] {
  const data = EspnScoreboardSchema.parse(value);
  const slotCounts = new Map<string, number>();
  return [...data.events]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((event) => {
      const competition = event.competitions[0];
      const slug = event.season?.slug ?? "unknown";
      const round = roundFromSlug(slug);
      const count = (slotCounts.get(slug) ?? 0) + 1;
      slotCounts.set(slug, count);
      const numbered = slug === "quarterfinals" || slug === "semifinals";
      return buildFixture({
        away: competitor(competition, "away"),
        competition,
        home: competitor(competition, "home"),
        id: event.id,
        kickoffUtc: event.date,
        round,
        slot: numbered ? `${round} ${count}` : round,
        venue: competition.venue,
      });
    });
}

export function parseEspnSummary(value: unknown): Fixture {
  const data = EspnSummarySchema.parse(value);
  const competition = data.header.competitions[0];
  const round = roundFromSummary(data.header.season.name);
  return buildFixture({
    away: competitor(competition, "away"),
    competition,
    home: competitor(competition, "home"),
    id: data.header.id,
    kickoffUtc: competition.date ?? "",
    round,
    slot: round,
    venue: data.gameInfo?.venue ?? competition.venue,
  });
}

async function fetchUnknown(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} responded ${response.status}.`);
  const value: unknown = await response.json();
  return value;
}

function compactDate(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

export async function fetchTournamentFixtures(options: { readonly now?: Date } = {}): Promise<readonly Fixture[]> {
  const now = options.now ?? new Date();
  const from = compactDate(now);
  if (from > TOURNAMENT_FINAL_DATE) return [];
  const value = await fetchUnknown(
    `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${from}-${TOURNAMENT_FINAL_DATE}`,
  );
  return parseEspnScoreboard(value);
}

export async function fetchFixturesForRange(from: string, through: string): Promise<readonly Fixture[]> {
  const CompactDateSchema = z.string().regex(/^\d{8}$/u);
  const start = CompactDateSchema.parse(from);
  const end = CompactDateSchema.parse(through);
  const value = await fetchUnknown(
    `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${start}-${end}`,
  );
  return parseEspnScoreboard(value);
}

export async function fetchFixtureById(id: FixtureId): Promise<Fixture> {
  const value = await fetchUnknown(
    `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${encodeURIComponent(id)}`,
  );
  return parseEspnSummary(value);
}

export function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function formatKickoff(kickoffUtc: string, timeZone: string): string {
  if (!isIanaTimeZone(timeZone)) throw new Error(`Invalid IANA time zone: ${timeZone}`);
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone,
    timeZoneName: "short",
    weekday: "short",
  }).format(new Date(kickoffUtc));
}

export function fixtureTimes(fixture: Fixture, userTimeZone: string | null): {
  readonly userLocal: { readonly time: string; readonly timeZone: string } | null;
  readonly venueLocal: { readonly time: string; readonly timeZone: string } | null;
} {
  const venueTimeZone = fixture.venue.kind === "known" ? fixture.venue.timeZone : null;
  return {
    userLocal:
      userTimeZone && isIanaTimeZone(userTimeZone)
        ? { time: formatKickoff(fixture.kickoffUtc, userTimeZone), timeZone: userTimeZone }
        : null,
    venueLocal: venueTimeZone
      ? { time: formatKickoff(fixture.kickoffUtc, venueTimeZone), timeZone: venueTimeZone }
      : null,
  };
}
