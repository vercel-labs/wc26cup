import assert from "node:assert/strict";
import test from "node:test";
import { requestTimeZoneAttributes, resolveUserTimeZone } from "../agent/lib/timezones.js";

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
