import { connectSlackCredentials } from "@vercel/connect/eve";
import { slackChannel } from "eve/channels/slack";

interface RenderedCard {
  pngBase64?: string;
  filename?: string;
  caption?: string;
}

export default slackChannel({
  credentials: connectSlackCredentials("slack/wc26bot"),
  threadContext: { since: "last-agent-reply" },
  events: {
    async "action.result"(eventData, channel) {
      const { result } = eventData;
      if (result.kind !== "tool-result" || result.toolName !== "render_odds_card") return;
      const output = result.output as RenderedCard;
      if (!output?.pngBase64) return;
      await channel.thread.post({
        text: output.caption || "World Cup 2026 odds",
        files: [
          {
            data: Buffer.from(output.pngBase64, "base64"),
            filename: output.filename ?? "wc26-odds.png",
            mimeType: "image/png",
          },
        ],
      });
    },
  },
});
