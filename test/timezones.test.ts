import assert from "node:assert/strict";
import test from "node:test";
import { calendarDate, requestTimeZoneAttributes, resolveUserTimeZone } from "../agent/lib/timezones.js";

test("calendar date follows the requested civil time zone", () => {
  const instant = "2026-07-10T01:00:00Z";
  assert.equal(calendarDate(instant, "America/New_York"), "2026-07-09");
  assert.equal(calendarDate(instant, "Europe/Paris"), "2026-07-10");
  assert.throws(() => calendarDate("not-a-date", "America/New_York"), /Invalid date/u);
  assert.throws(() => calendarDate(instant, "not-a-zone"), /Invalid IANA time zone/u);
});

test("time zone precedence uses explicit, profile, browser, then IP", () => {
  const attributes = {
    browser_time_zone: "America/Los_Angeles",
    ip_time_zone: "America/New_York",
    profile_time_zone: "Europe/Paris",
  };
  assert.deepEqual(resolveUserTimeZone({ attributes, explicit: "Asia/Tokyo" }), {
    source: "explicit",
    timeZone: "Asia/Tokyo",
  });
  assert.deepEqual(resolveUserTimeZone({ attributes }), { source: "profile", timeZone: "Europe/Paris" });
  assert.deepEqual(resolveUserTimeZone({ attributes: { ...attributes, profile_time_zone: "invalid" } }), {
    source: "browser",
    timeZone: "America/Los_Angeles",
  });
  assert.deepEqual(resolveUserTimeZone({ attributes: { ip_time_zone: "America/New_York" } }), {
    source: "ip",
    timeZone: "America/New_York",
  });
});

test("request headers accept only valid IANA zones", () => {
  const headers = new Headers({
    "x-vercel-ip-timezone": "America/New_York",
    "x-wc26-time-zone": "not-a-zone",
  });
  assert.deepEqual(requestTimeZoneAttributes(headers), { ip_time_zone: "America/New_York" });
});
