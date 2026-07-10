import { Flag } from "@/app/_components/flag";
import { cn } from "@/lib/utils";

interface BracketTeam {
  readonly code: string;
  readonly name: string;
  readonly flag: string;
}

interface BracketMatch {
  readonly home: BracketTeam | null;
  readonly away: BracketTeam | null;
  readonly winner?: "home" | "away" | null;
}

interface BracketRound {
  readonly name: string;
  readonly matches: readonly BracketMatch[];
}

export interface BracketData {
  readonly rounds: readonly BracketRound[];
}

function isRound(value: unknown): value is BracketRound {
  if (typeof value !== "object" || value === null) return false;
  const round = value as Record<string, unknown>;
  return typeof round.name === "string" && Array.isArray(round.matches);
}

export function isBracketData(value: unknown): value is BracketData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return Array.isArray(data.rounds) && data.rounds.length > 0 && data.rounds.every(isRound);
}

function TeamRow({ team, won }: { readonly team: BracketTeam | null; readonly won: boolean }) {
  return (
    <div className={cn("flex items-center gap-2 px-2.5 py-1.5", won && "bg-emerald-500/10")}>
      {team ? (
        <Flag code={team.flag} width={20} />
      ) : (
        <span aria-hidden className="size-3.5 rounded-sm bg-muted" />
      )}
      <span
        className={cn(
          "truncate text-sm",
          team ? (won ? "font-semibold text-foreground" : "text-foreground") : "text-muted-foreground",
        )}
      >
        {team ? team.name : "TBD"}
      </span>
    </div>
  );
}

export function BracketCard({ data }: { readonly data: BracketData }) {
  return (
    <div className="w-full rounded-2xl border bg-card p-5">
      <div className="flex gap-3">
        {data.rounds.map((round) => (
          <div className="flex min-w-0 flex-1 flex-col gap-3" key={round.name}>
            <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              {round.name}
            </p>
            <div className="flex flex-1 flex-col justify-around gap-3">
              {round.matches.map((match, index) => (
                <div
                  className="overflow-hidden rounded-lg border"
                  key={`${round.name}-${index}`}
                >
                  <TeamRow team={match.home} won={match.winner === "home"} />
                  <div className="h-px bg-border" />
                  <TeamRow team={match.away} won={match.winner === "away"} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
