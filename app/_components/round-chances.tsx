import { CheckIcon } from "lucide-react";
import { Flag } from "@/app/_components/flag";
import { cn } from "@/lib/utils";

type Cell = "in" | number | null;

const ROUNDS = [
  { key: "r32", label: "R32" },
  { key: "r16", label: "R16" },
  { key: "qf", label: "QF" },
  { key: "sf", label: "SF" },
  { key: "final", label: "FINAL" },
  { key: "cup", label: "CUP" },
] as const;

type RoundKey = (typeof ROUNDS)[number]["key"];

type TeamRow = { readonly name: string; readonly flag: string | null } & Readonly<
  Record<RoundKey, Cell>
>;

export interface RoundChancesData {
  readonly title: string;
  readonly subtitle?: string;
  readonly teams: readonly TeamRow[];
}

function isCell(value: unknown): value is Cell {
  return value === "in" || value === null || typeof value === "number";
}

export function isRoundChancesData(value: unknown): value is RoundChancesData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  if (typeof data.title !== "string" || !Array.isArray(data.teams)) return false;
  return data.teams.every((team: unknown) => {
    if (typeof team !== "object" || team === null) return false;
    const row = team as Record<string, unknown>;
    return (
      typeof row.name === "string" &&
      (typeof row.flag === "string" || row.flag === null) &&
      ROUNDS.every((round) => isCell(row[round.key]))
    );
  });
}

function formatPct(pct: number): string {
  return `${pct < 10 ? (Math.round(pct * 10) / 10).toFixed(1) : Math.round(pct)}%`;
}

function ChanceCell({ cell }: { readonly cell: Cell }) {
  if (cell === null) {
    return (
      <div className="flex h-9 items-center justify-center rounded-md bg-muted/40 text-muted-foreground/50 text-sm">
        –
      </div>
    );
  }
  if (cell === "in") {
    return (
      <div className="flex h-9 items-center justify-center rounded-md bg-emerald-500/12">
        <CheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} />
      </div>
    );
  }
  const emphasized = cell >= 60;
  return (
    <div
      className={cn(
        "flex h-9 items-center justify-center rounded-md text-sm tabular-nums",
        emphasized
          ? "bg-emerald-500/30 font-semibold text-foreground"
          : "bg-emerald-500/12 text-muted-foreground",
      )}
    >
      {formatPct(cell)}
    </div>
  );
}

export function RoundChances({ data }: { readonly data: RoundChancesData }) {
  return (
    <div className="flex max-h-[70vh] w-full max-w-2xl shrink-0 flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex shrink-0 items-baseline justify-between gap-4 border-b px-4 py-3">
        <span className="font-medium text-foreground text-sm">{data.title}</span>
        {data.subtitle ? (
          <span className="text-muted-foreground text-sm">{data.subtitle}</span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <table className="w-full border-separate border-spacing-x-1 border-spacing-y-1">
          <thead className="sticky top-0 z-10">
            <tr className="text-left text-muted-foreground text-xs tracking-wider">
              <th className="min-w-32 bg-card px-1 pb-1 font-medium">TEAM</th>
              {ROUNDS.map((round) => (
                <th className="w-14 bg-card pb-1 text-center font-medium" key={round.key}>
                  {round.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.teams.map((team) => (
              <tr key={team.name}>
                <td className="px-1">
                  <div className="flex items-center gap-2.5">
                    {team.flag === null ? (
                      <span className="h-[15px] w-5 rounded-[3px] bg-muted" />
                    ) : (
                      <Flag code={team.flag} width={20} />
                    )}
                    <span className="whitespace-nowrap text-foreground text-sm">{team.name}</span>
                  </div>
                </td>
                {ROUNDS.map((round) => (
                  <td key={round.key}>
                    <ChanceCell cell={team[round.key]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
