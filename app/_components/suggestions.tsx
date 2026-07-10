"use client";

import { CalendarDaysIcon, ChartColumnIcon, NetworkIcon, TrophyIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const SUGGESTIONS: readonly { icon: LucideIcon; label: string; prompt: string }[] = [
  {
    icon: TrophyIcon,
    label: "who are the favorites?",
    prompt: "who are the favorites to win the world cup?",
  },
  {
    icon: CalendarDaysIcon,
    label: "what's on today?",
    prompt: "what matches are on today?",
  },
  {
    icon: NetworkIcon,
    label: "show me the bracket",
    prompt: "show me the knockout bracket",
  },
  {
    icon: ChartColumnIcon,
    label: "chance to reach each round",
    prompt: "show me each team's chance to reach each round",
  },
];

export function Suggestions({
  className,
  disabled,
  onSelect,
}: {
  readonly className?: string;
  readonly disabled?: boolean;
  readonly onSelect: (prompt: string) => void;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-2", className)}>
      {SUGGESTIONS.map(({ icon: Icon, label, prompt }) => (
        <button
          className="flex items-center gap-2.5 rounded-xl border bg-input/30 px-3.5 py-2.5 text-left text-muted-foreground text-sm transition-colors hover:border-foreground/30 hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          disabled={disabled}
          key={label}
          onClick={() => onSelect(prompt)}
          type="button"
        >
          <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{label}</span>
        </button>
      ))}
    </div>
  );
}
