import { cn } from "@/lib/utils";

interface Bet {
  readonly team: string;
  readonly opponent: string;
  readonly round: string;
  readonly fixtureDate: string;
  readonly status: "pending" | "won" | "lost" | "void";
}

export interface MyBetsData {
  readonly bets: readonly Bet[];
}

function isBet(value: unknown): value is Bet {
  if (typeof value !== "object" || value === null) return false;
  const bet = value as Record<string, unknown>;
  return (
    typeof bet.team === "string" &&
    typeof bet.opponent === "string" &&
    typeof bet.status === "string"
  );
}

export function isMyBetsData(value: unknown): value is MyBetsData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return Array.isArray(data.bets) && data.bets.every(isBet);
}

const STATUS: Record<Bet["status"], { label: string; className: string }> = {
  pending: { label: "pending", className: "text-muted-foreground" },
  won: { label: "won", className: "text-emerald-500" },
  lost: { label: "lost", className: "text-destructive" },
  void: { label: "called off", className: "text-muted-foreground/60" },
};

export function MyBetsCard({ data }: { readonly data: MyBetsData }) {
  if (data.bets.length === 0) {
    return (
      <div className="w-full max-w-md rounded-2xl border bg-card px-5 py-4 text-muted-foreground text-sm">
        No bets yet, pick a match and lock one in.
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-2xl border bg-card p-5">
      <p className="font-medium text-sm">Your bets</p>
      <div className="mt-2 flex flex-col divide-y divide-border">
        {data.bets.map((bet, index) => {
          const status = STATUS[bet.status] ?? STATUS.pending;
          return (
            <div
              className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              key={`${bet.team}-${bet.opponent}-${bet.fixtureDate}-${index}`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm">
                  <span className="font-medium">{bet.team}</span> to beat {bet.opponent}
                </p>
                <p className="text-muted-foreground text-xs">
                  {bet.round} · {bet.fixtureDate}
                </p>
              </div>
              <span className={cn("shrink-0 font-medium text-xs", status.className)}>
                {status.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
