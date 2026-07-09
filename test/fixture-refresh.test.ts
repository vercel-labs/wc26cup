import assert from "node:assert/strict";
import test from "node:test";
import { selectDuePathnames } from "../agent/lib/fixture-refresh.js";

test("the minute dispatcher selects materialized times without consulting a fixture feed", () => {
  const now = Date.parse("2026-07-09T19:30:00Z");
  const due = "wc26-refresh/v1/due/001783625400000-760510-abcd1234.json";
  const sameTime = "wc26-refresh/v1/due/001783625400000-760511-efgh5678.json";
  const future = "wc26-refresh/v1/due/001783629000000-760512-ijkl9012.json";

  assert.deepEqual(
    selectDuePathnames({
      completedRefreshKeys: new Set(),
      now,
      pathnames: [future, sameTime, due],
      supersededRefreshKeys: new Set(),
    }),
    [due, sameTime],
  );
});

test("completed and superseded fixture revisions are not due again", () => {
  const pathname = "wc26-refresh/v1/due/001783625400000-760510-abcd1234.json";

  assert.deepEqual(
    selectDuePathnames({
      completedRefreshKeys: new Set(["760510-abcd1234"]),
      now: Date.parse("2026-07-09T19:31:00Z"),
      pathnames: [pathname],
      supersededRefreshKeys: new Set(),
    }),
    [],
  );
  assert.deepEqual(
    selectDuePathnames({
      completedRefreshKeys: new Set(),
      now: Date.parse("2026-07-09T19:31:00Z"),
      pathnames: [pathname],
      supersededRefreshKeys: new Set(["760510-abcd1234"]),
    }),
    [],
  );
});
