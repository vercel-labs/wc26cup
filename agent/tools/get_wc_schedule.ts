import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  fetchFixtureById,
  fetchTournamentFixtures,
  fixtureTimes,
  FixtureIdSchema,
  isIanaTimeZone,
  type Fixture,
} from "../lib/fixtures.js";
import { resolveUserTimeZone } from "../lib/timezones.js";

const TimeZoneSchema = z.string().min(1).refine(isIanaTimeZone, "Expected an IANA time zone such as America/Los_Angeles.");

const InputSchema = z.discriminatedUnion("view", [
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

export default defineTool({
  description:
    "Current 2026 FIFA World Cup fixtures from ESPN, preserving stable fixture IDs. Always use this for 'what is next?', 'what should I watch?', today, or tomorrow. Use 'fixture' for an exact ID, 'next_for_team' to bridge from a team to its next match, and 'remaining' for the bracket. Times include venue-local and, when available, explicit/profile/browser/IP-derived user-local time.",
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
