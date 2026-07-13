/**
 * One-time X v2 webhook registration + subscription for the Account Activity API.
 *
 * Setup-time tooling, NOT the adapter runtime. It registers the bot's deployed
 * webhook URL and subscribes the bot account so mentions and DMs are delivered.
 *
 * Verified against docs.x.com (v2), which splits this across two APIs with two
 * different auth schemes:
 * - Webhook management (POST/GET /2/webhooks, PUT/DELETE /2/webhooks/:id) uses
 *   an OAuth 2.0 App-Only Bearer token.
 * - Subscribing a user (POST /2/account_activity/webhooks/:id/subscriptions/all)
 *   requires OAuth 1.0a (3-legged user context). App-only bearer does not work
 *   for the subscribe step; that is by design, not the community "bare 403" bug.
 *
 * Prerequisites:
 * - The deploy must answer X's CRC GET on WEBHOOK_URL. CRC GET routing landed in
 *   eve 0.22.6, so the deploy must be on eve >= 0.22.6 or registration fails CRC.
 * - Set WEBHOOK_URL to the deployed X route, e.g.
 *   https://worldcup.labs.vercel.dev/eve/v1/x
 * - Creds in .env.local:
 *     X_CONSUMER_KEY, X_CONSUMER_SECRET      (API Key + Secret / consumer keys)
 *     X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET  (OAuth 1.0a user tokens, bot account)
 *   Optional X_BEARER_TOKEN (app-only bearer); minted from the consumer key and
 *   secret via client_credentials when absent.
 *
 * Run: node --env-file=.env.local --experimental-strip-types scripts/register-x-webhook.ts
 */

import { createHmac, randomBytes } from "node:crypto";

const API_BASE = (process.env.X_API_BASE_URL || "https://api.x.com").replace(/\/+$/, "");
const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.X_WEBHOOK_URL;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

// RFC 3986 percent-encoding, stricter than encodeURIComponent (OAuth 1.0a needs
// !*'() encoded too).
function encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

// App-only bearer for /2/webhooks. Prefer a pasted X_BEARER_TOKEN; otherwise mint
// one from the consumer key/secret via client_credentials.
async function appBearer(): Promise<string> {
  if (process.env.X_BEARER_TOKEN) {
    return process.env.X_BEARER_TOKEN;
  }
  const key = required("X_CONSUMER_KEY");
  const secret = required("X_CONSUMER_SECRET");
  const basic = Buffer.from(`${encode(key)}:${encode(secret)}`).toString("base64");
  const response = await fetch(`${API_BASE}/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = (await readJson(response)) as { access_token?: string };
  if (!(response.ok && data.access_token)) {
    throw new Error(
      `App-only bearer mint failed (${response.status}): ${JSON.stringify(data)}`
    );
  }
  return data.access_token;
}

// OAuth 1.0a Authorization header for a request with no query or body params
// (subscribing the authenticating user).
function oauth1Header(method: string, url: string): string {
  const params: Record<string, string> = {
    oauth_consumer_key: required("X_CONSUMER_KEY"),
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: required("X_ACCESS_TOKEN"),
    oauth_version: "1.0",
  };
  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${encode(k)}=${encode(params[k])}`)
    .join("&");
  const base = [method.toUpperCase(), encode(url), encode(paramString)].join("&");
  const signingKey = `${encode(required("X_CONSUMER_SECRET"))}&${encode(required("X_ACCESS_TOKEN_SECRET"))}`;
  const signature = createHmac("sha1", signingKey).update(base).digest("base64");
  const header: Record<string, string> = { ...params, oauth_signature: signature };
  return `OAuth ${Object.keys(header)
    .sort()
    .map((k) => `${encode(k)}="${encode(header[k])}"`)
    .join(", ")}`;
}

async function main(): Promise<void> {
  if (!WEBHOOK_URL) {
    throw new Error("Set WEBHOOK_URL to the deployed X route (e.g. https://<host>/eve/v1/x)");
  }

  const bearer = await appBearer();

  console.log(`[register-x-webhook] registering webhook: ${WEBHOOK_URL}`);
  const registerResponse = await fetch(`${API_BASE}/2/webhooks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: WEBHOOK_URL }),
  });
  const register = await readJson(registerResponse);
  if (!registerResponse.ok) {
    throw new Error(
      `Webhook registration failed (${registerResponse.status}): ${JSON.stringify(register)}`
    );
  }
  const webhookId = (register as { data?: { id?: string } })?.data?.id;
  if (!webhookId) {
    throw new Error(`No webhook id in response: ${JSON.stringify(register)}`);
  }
  console.log(`[register-x-webhook] registered webhook id: ${webhookId}`);

  console.log("[register-x-webhook] subscribing bot account (OAuth 1.0a)");
  const subscribeUrl = `${API_BASE}/2/account_activity/webhooks/${webhookId}/subscriptions/all`;
  const subscribeResponse = await fetch(subscribeUrl, {
    method: "POST",
    headers: { Authorization: oauth1Header("POST", subscribeUrl) },
  });
  if (!subscribeResponse.ok) {
    const subscribe = await readJson(subscribeResponse);
    throw new Error(
      `Subscription failed (${subscribeResponse.status}): ${JSON.stringify(subscribe)}`
    );
  }

  console.log("[register-x-webhook] done: webhook registered and subscribed");
}

main().catch((error) => {
  console.error(`[register-x-webhook] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
