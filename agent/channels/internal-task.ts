import { defineChannel } from "eve/channels";
import { completeRefreshFromBatchReceipt } from "../lib/fixture-refresh.js";

type InternalTaskState =
  | { kind: "idle" }
  | { kind: "broad"; runId: string }
  | { attemptPath: string; kind: "pre_match"; refreshKey: string };

export type InternalTaskTarget = Exclude<InternalTaskState, { kind: "idle" }>;

export default defineChannel<InternalTaskState, { state: InternalTaskState }, InternalTaskTarget>({
  routes: [],
  state: { kind: "idle" },
  context(state) {
    return { state };
  },
  receive(input, { send }) {
    const token = input.target.kind === "broad"
      ? `broad:${input.target.runId}`
      : `prematch:${input.target.refreshKey}:${encodeURIComponent(input.target.attemptPath)}`;
    return send(input.message, {
      auth: input.auth,
      continuationToken: token,
      mode: "task",
      state: input.target,
      title: input.target.kind === "broad" ? "Four-hour fact refresh" : `Pre-match refresh ${input.target.refreshKey}`,
    });
  },
  events: {
    async "session.completed"(_event, channel) {
      if (channel.state.kind !== "pre_match") return;
      const completed = await completeRefreshFromBatchReceipt(channel.state);
      if (!completed) {
        console.warn(`[fixture-refresh] ${channel.state.refreshKey} completed without a valid fact-batch receipt`);
      }
    },
  },
});
