import { isIanaTimeZone } from "./fixtures.js";

export type TimeZoneSource = "browser" | "explicit" | "ip" | "profile";

export interface ResolvedTimeZone {
  readonly source: TimeZoneSource;
  readonly timeZone: string;
}

export function calendarDate(value: Date | string, timeZone: string): string {
  if (!isIanaTimeZone(timeZone)) throw new Error(`Invalid IANA time zone: ${timeZone}`);
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.valueOf())) throw new Error(`Invalid date: ${String(value)}`);

  const parts = new Map(
    new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const year = parts.get("year");
  const month = parts.get("month");
  const day = parts.get("day");
  if (!year || !month || !day) throw new Error(`Could not resolve calendar date in ${timeZone}.`);
  return `${year}-${month}-${day}`;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function requestTimeZoneAttributes(headers: Headers): Readonly<Record<string, string>> {
  const browser = headers.get("x-wc26-time-zone");
  const ip = headers.get("x-vercel-ip-timezone");
  return {
    ...(browser && isIanaTimeZone(browser) ? { browser_time_zone: browser } : {}),
    ...(ip && isIanaTimeZone(ip) ? { ip_time_zone: ip } : {}),
  };
}

export function resolveUserTimeZone(input: {
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly explicit?: string;
}): ResolvedTimeZone | null {
  const candidates: readonly { readonly source: TimeZoneSource; readonly value: string | null }[] = [
    { source: "explicit", value: input.explicit ?? null },
    { source: "profile", value: stringValue(input.attributes.profile_time_zone) },
    { source: "browser", value: stringValue(input.attributes.browser_time_zone) },
    { source: "ip", value: stringValue(input.attributes.ip_time_zone) },
  ];
  const match = candidates.find((candidate) => candidate.value && isIanaTimeZone(candidate.value));
  return match?.value ? { source: match.source, timeZone: match.value } : null;
}
