import { cn } from "@/lib/utils";

interface ExactScore {
  readonly homeGoals: number;
  readonly awayGoals: number;
}

interface Prediction {
  readonly placed: {
    readonly fixture: {
      readonly home: { readonly name: string };
      readonly away: { readonly name: string };
      readonly round: string;
      readonly kickoffUtc: string;
    };
    readonly prediction: ExactScore;
  };
  readonly terminal:
    | null
    | { readonly kind: "settled"; readonly result: "hit" | "miss"; readonly actual: ExactScore }
    | { readonly kind: "void"; readonly reason: string };
}

export interface MyBetsData {
  readonly mention?: string;
  readonly predictions: readonly Prediction[];
}

function isExactScore(value: unknown): value is ExactScore {
  if (typeof value !== "object" || value === null) return false;
  const score = value as Record<string, unknown>;
  return typeof score.homeGoals === "number" && typeof score.awayGoals === "number";
}

function isPrediction(value: unknown): value is Prediction {
  if (typeof value !== "object" || value === null) return false;
  const placed = (value as Record<string, unknown>).placed as Record<string, unknown> | undefined;
  const fixture = placed?.fixture as Record<string, unknown> | undefined;
  const home = fixture?.home as Record<string, unknown> | undefined;
  const away = fixture?.away as Record<string, unknown> | undefined;
  return (
    typeof home?.name === "string" &&
    typeof away?.name === "string" &&
    typeof fixture?.round === "string" &&
    isExactScore(placed?.prediction)
  );
}

export function isMyBetsData(value: unknown): value is MyBetsData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return Array.isArray(data.predictions) && data.predictions.every(isPrediction);
}

const RESULT: Record<string, { label: string; className: string }> = {
  pending: { label: "pending", className: "text-muted-foreground" },
  hit: { label: "hit", className: "text-emerald-500" },
  miss: { label: "miss", className: "text-destructive" },
  void: { label: "called off", className: "text-muted-foreground/60" },
};

function resultKey(terminal: Prediction["terminal"]): keyof typeof RESULT {
  if (terminal === null) return "pending";
  if (terminal.kind === "void") return "void";
  return terminal.result;
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function MyBetsCard({ data }: { readonly data: MyBetsData }) {
  if (data.predictions.length === 0) {
    return (
      <div className="w-full max-w-md rounded-2xl border bg-card px-5 py-4 text-muted-foreground text-sm">
        No predictions yet, call a match and I'll lock in your exact score.
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-2xl border bg-card p-5">
      <p className="font-medium text-sm">Your predictions</p>
      <div className="mt-2 flex flex-col divide-y divide-border">
        {data.predictions.map((entry) => {
          const { fixture, prediction } = entry.placed;
          const result = RESULT[resultKey(entry.terminal)];
          const meta = shortDate(fixture.kickoffUtc);
          const actual =
            entry.terminal?.kind === "settled"
              ? `${entry.terminal.actual.homeGoals}-${entry.terminal.actual.awayGoals}`
              : null;
          return (
            <div
              className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              key={`${fixture.home.name}-${fixture.away.name}-${fixture.kickoffUtc}`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm">
                  <span className="font-medium text-foreground">{fixture.home.name}</span>
                  <span className="mx-1.5 tabular-nums text-muted-foreground">
                    {prediction.homeGoals}-{prediction.awayGoals}
                  </span>
                  <span className="font-medium text-foreground">{fixture.away.name}</span>
                </p>
                <p className="truncate text-muted-foreground text-xs">
                  {fixture.round}
                  {meta ? ` · ${meta}` : ""}
                  {actual ? ` · final ${actual}` : ""}
                </p>
              </div>
              <span className={cn("shrink-0 font-medium text-xs", result.className)}>
                {result.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
