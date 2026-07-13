import { createHmac, randomBytes } from "node:crypto";
import { createXAdapter, XFormatConverter } from "@chat-adapter/x";
import type { Message, Thread } from "chat";
import { chatSdkChannel } from "eve/channels/chat-sdk";
import type { SessionContext } from "eve/context";
import { createBlobState } from "../lib/blob-state.js";
import { allowed, allowlisted, premium } from "../lib/gating.js";

interface RenderedCard {
  pngBase64?: string;
  filename?: string;
  caption?: string;
}

const MEDIA_UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";
const TWEETS_URL = `${(process.env.X_API_BASE_URL || "https://api.x.com").replace(/\/+$/, "")}/2/tweets`;

// X's Account Activity API is at-least-once and redelivers events (retries,
// backlog replay) sometimes 30+ minutes after the original mention, so the
// per-tweet reply dedup must outlive that window. A tweet id is permanent, so
// 30 days is safely beyond any X redelivery while still auto-expiring.
const HANDLED_TTL = 30 * 24 * 60 * 60 * 1000;

// Both the card and the text reply are posted here via OAuth 1.0a rather than
// through the adapter, for two reasons. (1) The app tier lacks the media.write
// scope, so the adapter's OAuth 2.0 /2/media/upload 403s, while v1.1 media upload
// works on OAuth 1.0a on any tier. (2) The adapter picks a reply target from an
// in-memory map that eve's multi-invocation flow loses, so it falls back to the
// conversation root instead of the tweet that pinged us. Posting here lets us set
// in_reply_to_tweet_id to the actual mention id, so replies attach to the right
// tweet in a thread.
function oauth1Header(method: string, url: string): string {
  const enc = (v: string) =>
    encodeURIComponent(v).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const params: Record<string, string> = {
    oauth_consumer_key: process.env.X_CONSUMER_KEY ?? "",
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: process.env.X_ACCESS_TOKEN ?? "",
    oauth_version: "1.0",
  };
  const p = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join("&");
  const base = [method.toUpperCase(), enc(url), enc(p)].join("&");
  const key = `${enc(process.env.X_CONSUMER_SECRET ?? "")}&${enc(process.env.X_ACCESS_TOKEN_SECRET ?? "")}`;
  const signature = createHmac("sha1", key).update(base).digest("base64");
  const header: Record<string, string> = { ...params, oauth_signature: signature };
  return `OAuth ${Object.keys(header).sort().map((k) => `${enc(k)}="${enc(header[k])}"`).join(", ")}`;
}

async function postTweet(
  replyToId: string,
  text: string,
  png?: Buffer,
): Promise<boolean> {
  let mediaId: string | undefined;
  if (png) {
    const form = new FormData();
    form.append(
      "media",
      new Blob([new Uint8Array(png)], { type: "image/png" }),
      "wc26-odds.png",
    );
    const upload = await fetch(MEDIA_UPLOAD_URL, {
      method: "POST",
      headers: { Authorization: oauth1Header("POST", MEDIA_UPLOAD_URL) },
      body: form,
    });
    if (!upload.ok) {
      console.error(
        "[x] media upload failed",
        upload.status,
        (await upload.text()).slice(0, 200),
      );
      return false;
    }
    mediaId = ((await upload.json()) as { media_id_string?: string })
      .media_id_string;
    if (!mediaId) {
      return false;
    }
  }

  const tweet = await fetch(TWEETS_URL, {
    method: "POST",
    headers: {
      Authorization: oauth1Header("POST", TWEETS_URL),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...(text.trim() ? { text } : {}),
      ...(mediaId ? { media: { media_ids: [mediaId] } } : {}),
      reply: { in_reply_to_tweet_id: replyToId },
    }),
  });
  if (!tweet.ok) {
    console.error(
      "[x] tweet failed",
      tweet.status,
      (await tweet.text()).slice(0, 200),
    );
    return false;
  }
  return true;
}

// Constructed outside the bridge so the rate-limit gate can share it.
const state = createBlobState();

// Same markdown-to-X-text rendering the adapter uses, reused here so the text
// reply we post ourselves matches the adapter's output.
const formatConverter = new XFormatConverter();

// The reply must attach to the tweet that pinged us, not the thread root. The
// mention tweet id is carried on the session auth (set on send() below); fall
// back to the conversation id encoded in the thread id if it is ever missing.
function replyTarget(ctx: SessionContext, thread: Thread): string {
  const id = ctx.session.auth.initiator?.attributes.message_id;
  if (typeof id === "string") {
    return id;
  }
  return thread.id.split(":")[2] ?? thread.id;
}

// createXAdapter validates credentials at construction, which breaks
// `eve build` on machines without X env (build imports this module but no
// webhook ever fires). Placeholders keep the build green; with them in place
// the adapter can't verify a single webhook, so the channel is inert — hence
// the loud warning instead of a silent dead bot.
function xAdapter() {
  const hasCreds =
    process.env.X_CONSUMER_SECRET &&
    (process.env.X_USER_ACCESS_TOKEN || (process.env.X_CLIENT_ID && process.env.X_REFRESH_TOKEN));
  if (hasCreds) return createXAdapter();
  console.warn("[x] X credentials missing — X channel is inert (set X_CONSUMER_SECRET and a token)");
  return createXAdapter({
    consumerSecret: "unconfigured",
    userAccessToken: "unconfigured",
  });
}

export const { bot, channel, send } = chatSdkChannel({
  userName: process.env.X_USERNAME ?? "wc26bot",
  adapters: { x: xAdapter() },
  state,
  // X posts are single messages; reply once on completion instead of
  // post-then-edit streaming.
  streaming: false,
  events: {
    // Exactly one reply per mention on X. The card (action.result) and the text
    // (message.completed) are separate events; ctx.state does not persist between
    // them here (we post outside the adapter), so the reply is claimed in the
    // durable state adapter keyed on the turn id (from the third handler arg,
    // SessionContext). The turn id is unique per mention and shared by both events
    // of that turn, so the card claims the reply and the follow-up text no-ops,
    // while a later mention in the same thread is a new turn and is still
    // answered. The flag is set only after a successful post, so a failed card
    // upload still falls back to the text reply.
    async "action.result"(event, channel, ctx) {
      const { result } = event;
      if (
        result.kind !== "tool-result" ||
        result.toolName !== "render_odds_card"
      ) {
        return;
      }
      const output = result.output as RenderedCard;
      if (!(output?.pngBase64 && channel.thread)) {
        return;
      }
      const key = `x:answered:${ctx.session.turn.id}`;
      if (await state.get(key)) {
        return;
      }
      const posted = await postTweet(
        replyTarget(ctx, channel.thread),
        output.caption || "World Cup 2026 odds",
        Buffer.from(output.pngBase64, "base64"),
      );
      if (posted) {
        await state.set(key, true, 300_000);
      }
    },
    async "message.completed"(event, channel, ctx) {
      if (
        event.finishReason === "tool-calls" ||
        !event.message ||
        !channel.thread
      ) {
        return;
      }
      const key = `x:answered:${ctx.session.turn.id}`;
      if (await state.get(key)) {
        return;
      }
      const posted = await postTweet(
        replyTarget(ctx, channel.thread),
        formatConverter.renderPostable({ markdown: event.message }),
      );
      if (posted) {
        await state.set(key, true, 300_000);
      }
    },
  },
});

// Mention-only, no thread.subscribe(): on X, replies to the bot's post carry
// the @mention and re-enter here, while subscribing would answer every
// message in a public conversation whether or not the bot was addressed.
bot.onNewMention(async (thread: Thread, message: Message) => {
  // DMs are disabled: X delivers DMs as mentions (isMention), so drop `x:dm:`
  // threads before the agent runs, so there is no reply or image on DMs.
  if (thread.id.startsWith("x:dm:")) return;
  // Stop self-reply loops. X auto-mentions every thread participant on a
  // threaded reply, so the bot's own replies come back here as mentions. The
  // adapter's isMe only flags posts it sent through its own postMessage, and we
  // post via OAuth 1.0a outside the adapter, so match the bot's user id directly.
  if (message.author.isMe || message.author.userId === process.env.X_USER_ID) {
    return;
  }
  // Idempotency: X can deliver the same mention more than once (including long
  // after the original), and the default dedup does not catch it in the eve
  // path, so answer at most once per mention tweet. setIfNotExists writes the
  // key only on the first delivery; HANDLED_TTL keeps it alive past any X
  // redelivery window so a stale redelivery never triggers a second reply.
  if (
    !(await state.setIfNotExists(`x:handled:${message.id}`, true, HANDLED_TTL))
  ) {
    return;
  }
  if (!allowlisted(message)) return;
  if (!premium(message)) return;
  if (!(await allowed(state, message.author.userId))) return;
  await thread.startTyping();
  await send(message.text, {
    auth: {
      attributes: {
        thread_id: thread.id,
        user_id: message.author.userId,
        user_name: message.author.userName ?? message.author.fullName,
        message_id: message.id,
      },
      authenticator: "x-webhook",
      principalId: message.author.userId,
      principalType: "user",
    },
    thread,
  });
});

export default channel;
