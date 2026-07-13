# wc26bot

A working example of an [eve](https://github.com/vercel/eve) agent with tools, schedules, channels, evals, and a custom web UI.

The football use case gives each part something real to do. The agent reads current fixtures and results, compares Polymarket and Kalshi prices, collects source-backed tournament facts, and settles fictitious exact-score predictions. The same agent runs on the web, Slack, and X.

## What to try

- Change the agent's voice and grounding rules in [`agent/instructions.md`](agent/instructions.md), then add channel-specific behavior in [`agent/instructions/surface.ts`](agent/instructions/surface.ts).
- Add a typed tool under [`agent/tools`](agent/tools). The examples cover live data, durable state, and custom UI results.
- Run background agent work from [`agent/schedules`](agent/schedules), including source collection before kickoff and prediction settlement after full time.
- Expose one agent through the web, Slack, and X with [`agent/channels`](agent/channels).
- Test conversation behavior with live [`evals`](evals) and deterministic domain logic with [`test`](test).

## Run locally

You need Node.js 24 or newer, pnpm, and a Vercel AI Gateway credential.

```bash
git clone https://github.com/vercel-labs/wc26cup.git
cd wc26cup
pnpm install
```

Create `.env.local`:

```bash
AI_GATEWAY_API_KEY=your_ai_gateway_key
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token
```

The Blob token enables the fact memory, predictions, and X channel state. You can use `VERCEL_OIDC_TOKEN` instead of an AI Gateway key; `pnpm exec eve link` pulls it from a linked Vercel project.

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), or run `pnpm dev:eve` for eve's terminal UI.

Useful checks:

```bash
pnpm typecheck
pnpm test:unit
pnpm exec eve eval --strict
pnpm build:eve
```

Live evals need both credentials shown above. Unit tests and typechecking need neither. Run `pnpm exec eve deploy` to deploy a linked Vercel project.

## Vercel open-source projects used here

This list covers Vercel projects used directly in the app, including AI Elements components checked into this repo. It excludes transitive dependencies.

| Project | Used for |
| --- | --- |
| [eve](https://github.com/vercel/eve) | Agent runtime, instructions, tools, schedules, channels, and evals |
| [AI SDK](https://github.com/vercel/ai) | UI message and tool-part types |
| [AI Elements](https://github.com/vercel/ai-elements) | Conversation, message, reasoning, and tool UI components |
| [Chat SDK](https://github.com/vercel/chat) | X adapter plus channel message and state types |
| [Next.js](https://github.com/vercel/next.js) | Web app and eve route integration |
| [Streamdown](https://github.com/vercel/streamdown) | Streaming Markdown, code, math, and diagram rendering |
| [Satori](https://github.com/vercel/satori) | SVG odds-card generation |
| [Vercel Blob SDK](https://github.com/vercel/storage/tree/main/packages/blob) | Shared facts, predictions, and X channel state |
| [Vercel Connect SDK](https://github.com/vercel/vercel/tree/main/packages/connect) | Slack credential binding |
| [Geist](https://github.com/vercel/geist-font) | Sans and mono UI fonts |

Market prices are time-stamped snapshots, not forecasts or betting advice. Predictions are fictitious and involve no money.
