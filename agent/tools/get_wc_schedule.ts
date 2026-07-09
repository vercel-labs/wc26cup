import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  fetchFixtureById,
  fetchFixturesForRange,
  fetchTournamentFixtures,
  fixtureTimes,
  FixtureIdSchema,
  isIanaTimeZone,
  type Fixture,
} from "../lib/fixtures.js";
import { calendarDate, resolveUserTimeZone } from "../lib/timezones.js";

const TimeZoneSchema = z.string().min(1).refine(isIanaTimeZone, "Expected an IANA time zone such as America/Los_Angeles.");

const InputSchema = z.discriminatedUnion("view", [
  z.object({ timeZone: TimeZoneSchema.optional(), view: z.literal("today") }),
  z.object({ timeZone: TimeZoneSchema.optional(), view: z.literal("remaining") }),
  z.object({ fixtureId: FixtureIdSchema, timeZone: TimeZoneSchema.optional(), view: z.literal("fixture") }),
  z.object({ team: z.string().min(2), timeZone: TimeZoneSchema.optional(), view: z.literal("next_for_team") }),
]);

function fixtureView(fixture: Fixture, zone: ReturnType<typeof resolveUserTimeZone>) {
  const times = fixtureTimes(fixture, zone?.timeZone ?? null);
  const score = fixture.status.kind === "final"
    ? `${fixture.home.name} ${fixture.status.homeGoals}–${fixture.status.awayGoals} ${fixture.away.name}`
    : null;
  return {
    away: fixture.away,
    fixtureId: fixture.id,
    home: fixture.home,
    kickoff: {
      userLocal: times.userLocal ? { ...times.userLocal, source: zone?.source ?? null } : null,
      utc: fixture.kickoffUtc,
      venueLocal: times.venueLocal,
    },
    round: fixture.round,
    score,
    slot: fixture.slot,
    status: fixture.status.kind,
    venue: fixture.venue,
  };
}

function teamMatches(fixture: Fixture, team: string): boolean {
  const needle = team.trim().toLowerCase();
  return [fixture.home, fixture.away].some(
    (candidate) => candidate.id === team || candidate.name.toLowerCase().includes(needle),
  );
}

function shiftedUtcDate(value: Date, days: number): string {
  const shifted = new Date(value);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10).replaceAll("-", "");
}

export default defineTool({
  description:
    "Current 2026 FIFA World Cup fixtures from ESPN, preserving stable fixture IDs. Use 'today' for the user's current tournament day, 'fixture' for an exact ID, 'next_for_team' only when they ask what is next for a team, and 'remaining' for the future bracket. Times include venue-local and, when available, explicit/profile/browser/IP-derived user-local time.",
  inputSchema: InputSchema,
  async execute(input, ctx) {
    const asOf = new Date().toISOString();
    const attributes = ctx.session.auth.current?.attributes ?? {};
    const zone = resolveUserTimeZone({ attributes, explicit: input.timeZone });

    if (input.view === "fixture") {
      try {
        const fixture = await fetchFixtureById(input.fixtureId);
        return { asOf, fixture: fixtureView(fixture, zone), source: "ESPN" };
      } catch (error) {
        return { error: String(error) };
      }
    }

    if (input.view === "today") {
      const now = new Date(asOf);
      const timeZone = zone?.timeZone ?? "UTC";
      const date = calendarDate(now, timeZone);
      try {
        const fixtures = await fetchFixturesForRange(shiftedUtcDate(now, -1), shiftedUtcDate(now, 1));
        return {
          asOf,
          calendar: { date, source: zone?.source ?? null, timeZone },
          matches: fixtures
            .filter((fixture) => calendarDate(fixture.kickoffUtc, timeZone) === date)
            .map((fixture) => fixtureView(fixture, zone)),
          source: "ESPN",
        };
      } catch (error) {
        return { error: String(error) };
      }
    }

    let fixtures;
    try {
      fixtures = await fetchTournamentFixtures();
    } catch (error) {
      return { error: String(error) };
    }

    if (input.view === "next_for_team") {
      const fixture = fixtures.find(
        (candidate) => candidate.status.kind === "scheduled" && teamMatches(candidate, input.team),
      );
      return fixture
        ? { asOf, fixture: fixtureView(fixture, zone), source: "ESPN" }
        : { asOf, fixture: null, note: `${input.team} has no remaining scheduled fixture.`, source: "ESPN" };
    }

    return { asOf, matches: fixtures.map((fixture) => fixtureView(fixture, zone)), source: "ESPN" };
  },
});
