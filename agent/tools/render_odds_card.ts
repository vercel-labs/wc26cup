import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { defineTool } from "eve/tools";
import { z } from "zod";

const WIDTH = 900;
const MARGIN = 18;
const RADIUS = 24;
const BORDER = "#2a2d35";
const BG = "#000000";
const FONT_URL = "https://cdn.jsdelivr.net/npm/@fontsource/geist-mono@5/files/geist-mono-latin-500-normal.woff";

const EVE_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 40" fill="none"><path d="M127.474 6.39062H88.7139L61.6484 40.001H53.0693L85.2393 0H127.474V6.39062Z" fill="#ffffff"/><path d="M127.474 33.5938V39.9844H92.873V33.5938H127.474Z" fill="#ffffff"/><path d="M34.5996 39.9834H0V33.5928H34.5996V39.9834Z" fill="#ffffff"/><path d="M29.1592 23.0557H0V16.666H29.1592V23.0557Z" fill="#ffffff"/><path d="M127.474 23.0557H98.3135V16.666H127.474V23.0557Z" fill="#ffffff"/><path d="M56.9609 6.39062H0V0H56.9609V6.39062Z" fill="#ffffff"/></svg>`;

const teamSchema = z.object({
  name: z.string().min(1).max(32),
  flag: z
    .string()
    .regex(/^[a-z]{2}(-[a-z]{2,3})?$/)
    .describe("Lowercase flagcdn code: ISO 3166-1 alpha-2 ('ar', 'fr'); England is 'gb-eng'"),
  pct: z.number().min(0).max(100).describe("Implied probability in percent, from get_wc_odds"),
});

type Team = z.infer<typeof teamSchema>;
type CardInput = { template: "head_to_head" | "draw"; title: string; teams: Team[]; asOf: string };

let fontData: Promise<ArrayBuffer> | undefined;
function loadFont(): Promise<ArrayBuffer> {
  fontData ??= fetch(FONT_URL).then((res) => {
    if (!res.ok) throw new Error(`font fetch failed: ${res.status}`);
    return res.arrayBuffer();
  });
  return fontData;
}

const flagCache = new Map<string, Promise<string>>();
function loadFlagDataUri(code: string): Promise<string> {
  let cached = flagCache.get(code);
  if (!cached) {
    cached = fetch(`https://flagcdn.com/w160/${code}.png`).then(async (res) => {
      if (!res.ok) throw new Error(`unknown flag code '${code}' (flagcdn ${res.status})`);
      const bytes = Buffer.from(await res.arrayBuffer());
      return `data:image/png;base64,${bytes.toString("base64")}`;
    });
    flagCache.set(code, cached);
  }
  return cached;
}

function el(type: string, style: Record<string, unknown>, children?: unknown, extra?: Record<string, unknown>) {
  return { type, props: { style, children, ...extra } };
}

function flagImg(dataUri: string, size: number) {
  const height = Math.round(size * 0.72);
  return el("img", { width: size, height, borderRadius: 6 }, undefined, { src: dataUri, width: size, height });
}

function eveLogo(size: number) {
  const uri = `data:image/svg+xml;base64,${Buffer.from(EVE_LOGO).toString("base64")}`;
  const height = Math.round((size * 40) / 128);
  return el("img", { width: size, height }, undefined, { src: uri, width: size, height });
}

function bar(pct: number, denom: number, color: string, trackWidth: number) {
  const fill = Math.max(5, Math.min(trackWidth, (pct / denom) * trackWidth));
  return el("div", { display: "flex", width: trackWidth, height: 8, backgroundColor: "#22252b", borderRadius: 4 }, [
    el("div", { display: "flex", width: fill, height: 8, backgroundColor: color, borderRadius: 4 }),
  ]);
}

function footer(asOf: string) {
  return el("div", { display: "flex", justifyContent: "space-between", alignItems: "center" }, [
    el("div", { display: "flex", fontSize: 16, color: "#565f6e" }, `kalshi + polymarket · ${asOf}`.toLowerCase()),
    eveLogo(42),
  ]);
}

function shell(height: number, title: string, rows: unknown[], asOf: string, rowGap: number) {
  return el(
    "div",
    { display: "flex", width: WIDTH, height, backgroundColor: BG, padding: MARGIN, fontFamily: "Geist Mono", fontWeight: 500 },
    [
      el(
        "div",
        {
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          border: `1px solid ${BORDER}`,
          borderRadius: RADIUS,
          backgroundColor: BG,
          paddingTop: 52,
          paddingBottom: 48,
          paddingLeft: 60,
          paddingRight: 60,
        },
        [
          el("div", { display: "flex", fontSize: 22, color: "#7e8695" }, title.toLowerCase()),
          el("div", { display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center", gap: rowGap }, rows),
          footer(asOf),
        ],
      ),
    ],
  );
}

function nameColor(lead: boolean) {
  return lead ? "#ffffff" : "#dfe3ea";
}
function pctColor(lead: boolean) {
  return lead ? "#ffffff" : "#7c8695";
}
function barColor(lead: boolean) {
  return lead ? "#ffffff" : "#525a67";
}

function headToHeadCard(title: string, teams: (Team & { flagUri: string })[], asOf: string) {
  const total = teams.reduce((sum, team) => sum + team.pct, 0) || 100;
  const rows = teams.map((team, i) =>
    el("div", { display: "flex", alignItems: "center", height: 52 }, [
      el("div", { display: "flex", alignItems: "center", width: 280 }, [
        flagImg(team.flagUri, 42),
        el("div", { display: "flex", marginLeft: 20, fontSize: 30, color: nameColor(i === 0) }, team.name.toLowerCase()),
      ]),
      bar(team.pct, total, barColor(i === 0), 300),
      el("div", { display: "flex", width: 162, justifyContent: "flex-end", fontSize: 30, color: pctColor(i === 0) }, `${team.pct.toFixed(1)}%`),
    ]),
  );
  return shell(cardHeight("head_to_head", 2), title, rows, asOf, 36);
}

function drawCard(title: string, teams: (Team & { flagUri: string })[], asOf: string) {
  const max = teams[0]?.pct ?? 100;
  const rows = teams.map((team, i) =>
    el("div", { display: "flex", alignItems: "center", height: 46 }, [
      el("div", { display: "flex", alignItems: "center", width: 300 }, [
        el("div", { display: "flex", width: 30, fontSize: 24, color: "#4b5563" }, `${i + 1}`),
        flagImg(team.flagUri, 38),
        el("div", { display: "flex", marginLeft: 18, fontSize: 26, color: nameColor(i === 0) }, team.name.toLowerCase()),
      ]),
      bar(team.pct, max, barColor(i === 0), 280),
      el("div", { display: "flex", width: 162, justifyContent: "flex-end", fontSize: 26, color: pctColor(i === 0) }, `${team.pct.toFixed(1)}%`),
    ]),
  );
  return shell(cardHeight("draw", teams.length), title, rows, asOf, 26);
}

function cardHeight(template: "head_to_head" | "draw", teamCount: number) {
  return template === "head_to_head" ? 400 : 208 + teamCount * 72;
}

export async function renderOddsCard(input: CardInput): Promise<Buffer> {
  const [font, ...flagUris] = await Promise.all([loadFont(), ...input.teams.map((team) => loadFlagDataUri(team.flag))]);
  const withFlags = input.teams
    .map((team, i) => ({ ...team, flagUri: flagUris[i] }))
    .sort((a, b) => b.pct - a.pct);

  const tree =
    input.template === "head_to_head"
      ? headToHeadCard(input.title, withFlags, input.asOf)
      : drawCard(input.title, withFlags, input.asOf);

  const svg = await satori(tree as Parameters<typeof satori>[0], {
    width: WIDTH,
    height: cardHeight(input.template, input.teams.length),
    fonts: [{ name: "Geist Mono", data: font, weight: 500, style: "normal" }],
  });
  return Buffer.from(new Resvg(svg).render().asPng());
}

export default defineTool({
  description:
    "Render a World Cup odds image card (PNG). Two templates: 'head_to_head' compares exactly 2 teams; 'draw' ranks 2-8 teams by probability. Pass probabilities from get_wc_odds. Never include teams already eliminated from the World Cup (knocked out) — only teams still in the tournament. The card is posted to the thread automatically — do not describe its contents in detail afterwards.",
  inputSchema: z.object({
    template: z.enum(["head_to_head", "draw"]),
    title: z.string().min(1).max(80),
    teams: z.array(teamSchema).min(2).max(8),
    caption: z.string().max(200).default("").describe("Short text posted alongside the image"),
  }),
  async execute({ template, title, teams, caption }) {
    if (template === "head_to_head" && teams.length !== 2) {
      return { error: "head_to_head requires exactly 2 teams" };
    }

    const asOf = `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
    const png = await renderOddsCard({ template, title, teams, asOf });

    return {
      pngBase64: png.toString("base64"),
      filename: `wc26-${template}-${teams.map((t) => t.flag).join("-")}.png`,
      caption,
      byteLength: png.length,
    };
  },
  toModelOutput(output) {
    if ("error" in output && output.error) return { type: "text", value: `Error: ${output.error}` };
    return {
      type: "text",
      value: `Card rendered (${output.byteLength} bytes) and posted to the thread with caption "${output.caption}".`,
    };
  },
});
