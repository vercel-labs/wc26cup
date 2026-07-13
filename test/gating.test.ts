import assert from "node:assert/strict";
import test from "node:test";
import {
  createVerifiedAccountGate,
  createXInteractionLimit,
  shouldRejectXMessage,
  type QuotaSlotStore,
  type VerificationCache,
} from "../agent/lib/gating.js";

const silentLogger = {
  error() {},
};

function createMemoryCache(): VerificationCache {
  const values = new Map<string, unknown>();
  return {
    async read(key) {
      return values.get(key) ?? null;
    },
    async write(key, value) {
      values.set(key, value);
    },
  };
}

function createMemoryQuotaStore(): QuotaSlotStore {
  const claims = new Map<string, number>();
  return {
    async tryClaim({ claimedAt, expiresBefore, pathname }) {
      await Promise.resolve();
      const current = claims.get(pathname);
      if (current !== undefined && current > expiresBefore) {
        return false;
      }
      claims.set(pathname, claimedAt);
      return true;
    },
  };
}

test("X rejects DMs, self-authored events, and missing bot identity", () => {
  const common = {
    authorUserId: "123",
    botUserId: "999",
    isMe: false,
    threadId: "x:post:conversation",
  };

  assert.equal(shouldRejectXMessage({ ...common, threadId: "x:dm:123" }), true);
  assert.equal(shouldRejectXMessage({ ...common, isMe: true }), true);
  assert.equal(shouldRejectXMessage({ ...common, authorUserId: "999" }), true);
  assert.equal(shouldRejectXMessage({ ...common, botUserId: undefined }), true);
  assert.equal(shouldRejectXMessage(common), false);
});

test("the verified-account gate caches X's decision and fails closed", async () => {
  let lookups = 0;
  const allowed = createVerifiedAccountGate({
    cache: createMemoryCache(),
    client: {
      async isVerified() {
        lookups += 1;
        return true;
      },
    },
    logger: silentLogger,
  });

  assert.equal(await allowed("123"), true);
  assert.equal(await allowed("123"), true);
  assert.equal(lookups, 1);

  const denied = createVerifiedAccountGate({
    cache: createMemoryCache(),
    client: {
      async isVerified() {
        throw new Error("X unavailable");
      },
    },
    logger: silentLogger,
  });
  assert.equal(await denied("456"), false);
});

test("the rolling account limit admits exactly 10 concurrent interactions", async () => {
  const now = Date.parse("2026-07-13T12:00:00Z");
  const claim = createXInteractionLimit({
    clock: () => now,
    logger: silentLogger,
    store: createMemoryQuotaStore(),
  });

  const results = await Promise.all(
    Array.from({ length: 30 }, () => claim("123")),
  );
  assert.equal(results.filter(Boolean).length, 10);
});

test("the rolling account limit opens one slot after 24 hours", async () => {
  let now = Date.parse("2026-07-13T12:00:00Z");
  const claim = createXInteractionLimit({
    clock: () => now,
    logger: silentLogger,
    store: createMemoryQuotaStore(),
  });

  for (let index = 0; index < 10; index += 1) {
    assert.equal(await claim("123"), true);
  }
  assert.equal(await claim("123"), false);

  now += 24 * 60 * 60 * 1000 - 1;
  assert.equal(await claim("123"), false);

  now += 1;
  assert.equal(await claim("123"), true);
});
