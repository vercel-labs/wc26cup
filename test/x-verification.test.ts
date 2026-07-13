import assert from "node:assert/strict";
import test from "node:test";
import { createXVerificationClient } from "../agent/lib/x-verification.js";

test("X verification requests the verified field and requires a matching user", async () => {
  let authorization = "";
  let requestedUrl = "";
  const client = createXVerificationClient({
    environment: {
      X_API_BASE_URL: "https://api.x.test",
      X_BEARER_TOKEN: "app-token",
    },
    async fetch(input, init) {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      requestedUrl = input.toString();
      return Response.json({ data: { id: "123", verified: true } });
    },
  });

  assert.equal(await client.isVerified("123"), true);
  assert.equal(authorization, "Bearer app-token");
  assert.equal(new URL(requestedUrl).searchParams.get("user.fields"), "verified");

  const mismatched = createXVerificationClient({
    environment: { X_BEARER_TOKEN: "app-token" },
    async fetch() {
      return Response.json({ data: { id: "999", verified: true } });
    },
  });
  assert.equal(await mismatched.isVerified("123"), false);
});

test("X verification rejects unverified and malformed user responses", async () => {
  const unverified = createXVerificationClient({
    environment: { X_BEARER_TOKEN: "app-token" },
    async fetch() {
      return Response.json({ data: { id: "123", verified: false } });
    },
  });
  assert.equal(await unverified.isVerified("123"), false);

  const malformed = createXVerificationClient({
    environment: { X_BEARER_TOKEN: "app-token" },
    async fetch() {
      return Response.json({ data: { id: "123" } });
    },
  });
  await assert.rejects(() => malformed.isVerified("123"), /Invalid X user lookup response/u);
});

test("X verification can mint and reuse an app bearer", async () => {
  let tokenRequests = 0;
  let lookupRequests = 0;
  const client = createXVerificationClient({
    environment: {
      X_API_BASE_URL: "https://api.x.test",
      X_CONSUMER_KEY: "consumer-key",
      X_CONSUMER_SECRET: "consumer-secret",
    },
    async fetch(input) {
      const url = input.toString();
      if (url.endsWith("/oauth2/token")) {
        tokenRequests += 1;
        return Response.json({ access_token: "minted-token", token_type: "bearer" });
      }
      lookupRequests += 1;
      return Response.json({ data: { id: "123", verified: true } });
    },
  });

  assert.equal(await client.isVerified("123"), true);
  assert.equal(await client.isVerified("123"), true);
  assert.equal(tokenRequests, 1);
  assert.equal(lookupRequests, 2);
});
