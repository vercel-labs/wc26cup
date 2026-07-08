import { Flag } from "@/app/_components/flag";
import { cn } from "@/lib/utils";

interface MatchTeam {
  readonly code: string;
  readonly name: string;
  readonly flag: string;
  readonly score?: number;
}

export interface MatchCardData {
  readonly matchNumber?: number;
  readonly round: string;
  readonly kickoff: string;
  readonly status: "scheduled" | "live" | "full time";
  readonly home: MatchTeam;
  readonly away: MatchTeam;
}

function isMatchTeam(value: unknown): value is MatchTeam {
  if (typeof value !== "object" || value === null) return false;
  const team = value as Record<string, unknown>;
  return (
    typeof team.code === "string" && typeof team.name === "string" && typeof team.flag === "string"
  );
}

export function isMatchCardData(value: unknown): value is MatchCardData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.round === "string" &&
    typeof data.kickoff === "string" &&
    typeof data.status === "string" &&
    isMatchTeam(data.home) &&
    isMatchTeam(data.away)
  );
}

function TeamColumn({ team }: { readonly team: MatchTeam }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <Flag code={team.flag} width={56} />
      <span className="mt-1.5 font-bold text-foreground text-xl tracking-wide">{team.code}</span>
      <span className="text-muted-foreground text-sm">{team.name}</span>
    </div>
  );
}

export function MatchCard({ data }: { readonly data: MatchCardData }) {
  const isLive = data.status === "live";
  const scoreKnown = data.home.score !== undefined && data.away.score !== undefined;

  return (
    <div className="w-full max-w-md rounded-2xl border bg-card px-6 py-5">
      <div className="flex items-baseline justify-between gap-4 text-muted-foreground text-sm">
        <span className="font-medium">
          {data.matchNumber !== undefined ? `#${data.matchNumber} · ` : ""}
          {data.round}
        </span>
        <span className="underline decoration-dotted underline-offset-4">{data.kickoff}</span>
      </div>
      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-6 pb-2">
        <TeamColumn team={data.home} />
        <div className="flex flex-col items-center gap-1 self-start pt-1">
          <span
            className={cn(
              "text-xs uppercase tracking-[0.2em]",
              isLive ? "font-semibold text-emerald-500" : "text-muted-foreground",
            )}
          >
            {data.status}
          </span>
          <span
            className={cn(
              "font-bold text-4xl tabular-nums",
              scoreKnown && data.status !== "scheduled"
                ? "text-foreground"
                : "text-muted-foreground/60",
            )}
          >
            {data.home.score ?? 0} – {data.away.score ?? 0}
          </span>
        </div>
        <TeamColumn team={data.away} />
      </div>
    </div>
  );
}
