import { cn } from "@/lib/utils";

export function Flag({
  code,
  width,
  className,
}: {
  readonly code: string;
  readonly width: number;
  readonly className?: string;
}) {
  const asset = width <= 20 ? "w40" : width <= 40 ? "w80" : "w160";
  return (
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
