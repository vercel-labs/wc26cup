"use client";

import { useState } from "react";
import { Flag } from "@/app/_components/flag";
import { cn } from "@/lib/utils";

interface BetOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

const FLAG_CODE = /^[a-z]{2}(-[a-z]{2,3})?$/;

export function isBetQuestion(options: readonly BetOption[] | undefined): options is readonly BetOption[] {
  return (
    Array.isArray(options) &&
    options.length === 2 &&
    options.every(
      (option) =>
        typeof option.id === "string" &&
        FLAG_CODE.test(option.id) &&
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
  readonly options: readonly BetOption[];
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
          ? "bet locked · bragging rights only"
          : "tap your pick · fictitious, bragging rights only"}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {options.map((option) => {
          const isPicked = picked === option.id;
          const dimmed = picked !== null && !isPicked;
          return (
            <button
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-xl border p-4 transition-colors",
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
              <Flag code={option.id} width={44} />
              <span className="mt-1 font-semibold text-base text-foreground">{option.label}</span>
              {option.description ? (
                <span className="text-muted-foreground text-xs tabular-nums">
                  {option.description}
                </span>
              ) : null}
              {isPicked ? <span className="font-medium text-emerald-500 text-xs">your pick</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
