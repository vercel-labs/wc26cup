import { cn } from "@/lib/utils";

/** Flag PNG from flagcdn, same source the agent's tools use for codes. */
export function Flag({
  code,
  width,
  className,
}: {
  readonly code: string;
  readonly width: number;
  readonly className?: string;
}) {
  // flagcdn serves fixed widths; pick the smallest one >= 2x display size.
  const asset = width <= 20 ? "w40" : width <= 40 ? "w80" : "w160";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={`${code} flag`}
      className={cn("rounded-[3px] object-cover", className)}
      height={Math.round(width * 0.75)}
      loading="lazy"
      src={`https://flagcdn.com/${asset}/${code}.png`}
      width={width}
    />
  );
}
