import { createXAdapter } from "@chat-adapter/x";
import type { Message, Thread } from "chat";
import { chatSdkChannel } from "eve/channels/chat-sdk";
import { createBlobState } from "../lib/blob-state.js";
import { allowed, allowlisted, premium } from "../lib/gating.js";

// Constructed outside the bridge so the rate-limit gate can share it.
const state = createBlobState();

export const { bot, channel, send } = chatSdkChannel({
  userName: process.env.X_USERNAME ?? "wc26bot",
  adapters: { x: createXAdapter() },
  state,
  // X posts are single messages; reply once on completion instead of
  // post-then-edit streaming.
  streaming: false,
});

// Mention-only, no thread.subscribe(): on X, replies to the bot's post carry
// the @mention and re-enter here, while subscribing would answer every
// message in a public conversation whether or not the bot was addressed.
bot.onNewMention(async (thread: Thread, message: Message) => {
  if (!allowlisted(message)) return;
  if (!premium(message)) return;
  if (!(await allowed(state, message.author.userId))) return;
  await thread.startTyping();
  await send(message.text, { thread });
});

export default channel;
