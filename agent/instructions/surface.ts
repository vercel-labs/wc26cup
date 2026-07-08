import { defineDynamic, defineInstructions } from "eve/instructions";

const SLACK_SURFACE = `# Surface: Slack
You are replying in a Slack thread. For visuals use \`render_odds_card\` (posted
as a PNG). Never call \`show_match_card\` or \`show_round_chances\` here — Slack
cannot render them and the user would see nothing.`;

const WEB_SURFACE = `# Surface: web chat
You are replying in the web chat, which renders interactive components. For
visuals use \`show_match_card\` (one fixture) and \`show_round_chances\` (the
round-by-round probability table). Never call \`render_odds_card\` here — the
web chat does not post its PNG. One component per reply, and keep the text to
a single headline sentence; the component carries the details.

\`show_round_chances\` fetches its own live Polymarket data — don't call
\`get_wc_odds\` first just to feed it; its result gives you the headline
numbers for your one-sentence reply.`;

export default defineDynamic({
  events: {
    "session.started": (_event, ctx) => {
      const isSlack = ctx.session.auth.initiator?.authenticator === "slack-webhook";
      return defineInstructions({ markdown: isSlack ? SLACK_SURFACE : WEB_SURFACE });
    },
  },
});
