import { Flag } from "@/app/_components/flag";

interface Team {
  readonly code: string;
  readonly name: string;
  readonly flag: string;
  readonly pct?: number | null;
}

export interface LeaderboardData {
  readonly title?: string;
  readonly teams: readonly Team[];
}

function isTeam(value: unknown): value is Team {
  if (typeof value !== "object" || value === null) return false;
  const team = value as Record<string, unknown>;
  return (
    typeof team.code === "string" &&
    typeof team.name === "string" &&
    typeof team.flag === "string"
  );
}

export function isLeaderboardData(value: unknown): value is LeaderboardData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return Array.isArray(data.teams) && data.teams.length > 0 && data.teams.every(isTeam);
}

export function LeaderboardCard({ data }: { readonly data: LeaderboardData }) {
  return (
    <div className="flex max-h-[70vh] w-full max-w-md shrink-0 flex-col overflow-hidden rounded-2xl border bg-card p-5">
      <div className="flex shrink-0 items-baseline justify-between">
        <p className="font-medium text-sm">{data.title ?? "Title race"}</p>
        <span className="text-muted-foreground text-xs">to win</span>
      </div>
      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-1 overflow-auto">
        {data.teams.map((team, index) => (
          <div
            className="flex items-center gap-3 rounded-lg px-2 py-2 odd:bg-muted/30"
            key={team.code}
          >
            <span className="w-5 shrink-0 text-center font-mono text-muted-foreground text-sm tabular-nums">
              {index + 1}
            </span>
            <Flag code={team.flag} width={24} />
            <span className="min-w-0 flex-1 truncate font-medium text-sm">{team.name}</span>
            {team.pct == null ? null : (
              <span className="shrink-0 font-mono text-sm tabular-nums">{team.pct}%</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
