import { createXAdapter } from "@chat-adapter/x";
import type { Message, Thread } from "chat";
import { chatSdkChannel } from "eve/channels/chat-sdk";
import { createBlobState } from "../lib/blob-state.js";
import { allowed, allowlisted, premium } from "../lib/gating.js";

interface RenderedCard {
  pngBase64?: string;
  filename?: string;
  caption?: string;
}

// Constructed outside the bridge so the rate-limit gate can share it.
const state = createBlobState();

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
    // Hard cap: exactly one post per mention on X. eve posts the text on
    // `message.completed` and we post the odds card on `action.result`, with no
    // built-in cap, so a card would post twice (image + text) and multiple agent
    // messages would each post. `repliedOnce` (reset every turn) lets exactly one
    // through. One post also means one outbound request, so the adapter's OAuth
    // refresh never races itself into a dead single-use token.
    async "turn.started"(_event, ctx) {
      ctx.state.repliedOnce = false;
    },
    async "action.result"(event, ctx) {
      const { result } = event;
      if (
        result.kind !== "tool-result" ||
        result.toolName !== "render_odds_card"
      ) {
        return;
      }
      const output = result.output as RenderedCard;
      if (!(output?.pngBase64 && ctx.thread) || ctx.state.repliedOnce) {
        return;
      }
      await ctx.thread.post({
        markdown: output.caption || "World Cup 2026 odds",
        files: [
          {
            data: Buffer.from(output.pngBase64, "base64"),
            filename: output.filename ?? "wc26-odds.png",
            mimeType: "image/png",
          },
        ],
      });
      // Mark replied only after a successful post, so a failed card upload
      // (e.g. missing media.write scope) falls back to the text reply below.
      ctx.state.repliedOnce = true;
    },
    async "message.completed"(event, ctx) {
      if (
        event.finishReason === "tool-calls" ||
        !event.message ||
        ctx.state.repliedOnce ||
        !ctx.thread
      ) {
        return;
      }
      await ctx.thread.post({ markdown: event.message });
      ctx.state.repliedOnce = true;
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
      },
      authenticator: "x-webhook",
      principalId: message.author.userId,
      principalType: "user",
    },
    thread,
  });
});

export default channel;
