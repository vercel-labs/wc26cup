import { cn } from "@/lib/utils";

/**
 * Keepy-uppy (embaixadinha) loader: a boot juggling a ball. Keyframes live in
 * globals.css (`embaixadinha-ball` / `embaixadinha-boot`), synced so the boot
 * flicks exactly when the ball reaches it.
 */
export function Embaixadinha({
  className,
  animate = true,
}: {
  readonly className?: string;
  readonly animate?: boolean;
}) {
  return (
    <svg
      aria-label="juggling a ball"
      className={cn("text-muted-foreground", className)}
      fill="none"
      role="img"
      viewBox="0 0 48 48"
    >
      <circle
        className={cn("fill-emerald-500", animate && "embaixadinha-ball")}
        cx="30"
        cy="10"
        r="5"
      />
      <g className={animate ? "embaixadinha-boot" : undefined}>
        <line stroke="currentColor" strokeLinecap="round" strokeWidth="5" x1="16" x2="16" y1="18" y2="34" />
        <line stroke="currentColor" strokeLinecap="round" strokeWidth="5" x1="16" x2="28" y1="37" y2="38" />
      </g>
    </svg>
  );
}
