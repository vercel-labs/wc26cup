import type { BetRecord } from "./bets.js";

function normalize(team: string): string {
  return team.trim().toLowerCase();
}

/**
 * Two bets describe the same match when they share the UTC fixture date and
 * the same unordered pair of teams — "England beat Spain" and "Spain beat
 * England" on the same date are one fixture.
 */
export function sameFixture(
  a: Pick<BetRecord, "team" | "opponent" | "fixtureDate">,
  b: Pick<BetRecord, "team" | "opponent" | "fixtureDate">,
): boolean {
  if (a.fixtureDate !== b.fixtureDate) return false;
  const pairA = [normalize(a.team), normalize(a.opponent)].sort();
  const pairB = [normalize(b.team), normalize(b.opponent)].sort();
  return pairA[0] === pairB[0] && pairA[1] === pairB[1];
}
