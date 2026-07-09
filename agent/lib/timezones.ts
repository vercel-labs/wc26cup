import { isIanaTimeZone } from "./fixtures.js";

export type TimeZoneSource = "browser" | "explicit" | "ip" | "profile";

export interface ResolvedTimeZone {
  readonly source: TimeZoneSource;
  readonly timeZone: string;
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
