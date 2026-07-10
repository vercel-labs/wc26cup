"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface ScoreOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

const SCORELINE = /^\d{1,2}-\d{1,2}$/;

export function isScorePick(options: readonly ScoreOption[] | undefined): options is readonly ScoreOption[] {
  return (
    Array.isArray(options) &&
    options.length >= 2 &&
    options.every(
      (option) =>
        typeof option.id === "string" &&
        SCORELINE.test(option.id) &&
        typeof option.label === "string",
    )
  );
}

export function BetCard({
  onPick,
  options,
  prompt,
  responded,
}: {
  readonly onPick: (optionId: string) => void;
  readonly options: readonly ScoreOption[];
  readonly prompt: string;
  readonly responded?: string;
}) {
  const [local, setLocal] = useState<string | null>(null);
  const picked = responded ?? local;

  const handlePick = (id: string) => {
    if (picked) return;
    setLocal(id);
    onPick(id);
  };

  return (
    <div className="w-full max-w-md rounded-2xl border bg-card p-5">
      <p className="text-sm">{prompt}</p>
      <p className="mt-1 text-muted-foreground text-xs">
        {picked
          ? "prediction locked · bragging rights only"
          : "tap your exact score · fictitious, bragging rights only"}
      </p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {options.map((option) => {
          const isPicked = picked === option.id;
          const dimmed = picked !== null && !isPicked;
          return (
            <button
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-xl border p-3 transition-colors",
                isPicked
                  ? "border-emerald-500 bg-emerald-500/10"
                  : "hover:border-foreground/30 hover:bg-accent",
                dimmed && "opacity-40",
              )}
              disabled={picked !== null}
              key={option.id}
              onClick={() => handlePick(option.id)}
              type="button"
            >
              <span className="font-semibold text-base text-foreground tabular-nums">{option.id}</span>
              {option.description ? (
                <span className="text-center text-[11px] text-muted-foreground leading-tight">
                  {option.description}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
