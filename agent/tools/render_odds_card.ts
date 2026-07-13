import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { defineTool } from "eve/tools";
import { z } from "zod";

const WIDTH = 900;
const FONT_URL = "https://unpkg.com/@fontsource/inter@5.1.0/files/inter-latin-600-normal.woff";

const teamSchema = z.object({
  name: z.string().min(1).max(32),
  flag: z
    .string()
    .regex(/^[a-z]{2}(-[a-z]{2,3})?$/)
    .describe("Lowercase flagcdn code: ISO 3166-1 alpha-2 ('ar', 'fr'); England is 'gb-eng'"),
  pct: z.number().min(0).max(100).describe("Implied probability in percent, from get_wc_odds"),
});

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
  return el("img", { width: size, height: Math.round(size * 0.75), borderRadius: 8 }, undefined, {
    src: dataUri,
    width: size,
    height: Math.round(size * 0.75),
  });
}

function probabilityBar(pct: number, color: string) {
  return el(
    "div",
    { display: "flex", width: 320, height: 14, backgroundColor: "#1f2430", borderRadius: 7 },
    [el("div", { display: "flex", width: (320 * Math.max(pct, 1)) / 100, height: 14, backgroundColor: color, borderRadius: 7 })],
  );
}

function vercelLogo(size: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 116 100"><path d="M57.5 0 115 100H0Z" fill="#ffffff"/></svg>`;
  const uri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const height = Math.round((size * 100) / 116);
  return el("img", { width: size, height }, undefined, { src: uri, width: size, height });
}

function footer(asOf: string, marginTop = 0) {
  return el("div", { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop }, [
    el("div", { display: "flex", fontSize: 20, color: "#5b6474" }, `implied win probability · Kalshi + Polymarket · ${asOf}`),
    vercelLogo(22),
  ]);
}

function headToHeadCard(title: string, teams: { name: string; pct: number; flagUri: string }[], asOf: string) {
  const [a, b] = teams;
  const column = (team: { name: string; pct: number; flagUri: string }, color: string) =>
    el("div", { display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }, [
      flagImg(team.flagUri, 160),
      el("div", { display: "flex", fontSize: 40, color: "#f5f7fa" }, team.name),
      el("div", { display: "flex", fontSize: 64, color }, `${team.pct.toFixed(1)}%`),
      probabilityBar(team.pct, color),
    ]);
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width: WIDTH,
      height: 520,
      backgroundColor: "#000000",
      padding: 48,
      gap: 36,
      fontFamily: "Inter",
    },
    [
      el("div", { display: "flex", fontSize: 30, color: "#8a93a6" }, title),
      el("div", { display: "flex", justifyContent: "space-between", alignItems: "center" }, [
        column(a, "#4da3ff"),
        el("div", { display: "flex", fontSize: 48, color: "#3a4152" }, "vs"),
        column(b, "#ffb454"),
      ]),
      footer(asOf),
    ],
  );
}

function drawCard(title: string, teams: { name: string; pct: number; flagUri: string }[], asOf: string) {
  const rows = teams.map((team, i) =>
    el("div", { display: "flex", alignItems: "center", gap: 24, height: 64 }, [
      el("div", { display: "flex", width: 44, fontSize: 30, color: "#3a4152" }, `${i + 1}`),
      flagImg(team.flagUri, 64),
      el("div", { display: "flex", width: 280, fontSize: 34, color: "#f5f7fa" }, team.name),
      probabilityBar(team.pct, i === 0 ? "#4da3ff" : "#2f6fb5"),
      el("div", { display: "flex", fontSize: 34, color: "#4da3ff" }, `${team.pct.toFixed(1)}%`),
    ]),
  );
  return el(
    "div",
    {
      display: "flex",
      flexDirection: "column",
      width: WIDTH,
      height: 200 + teams.length * 68,
      backgroundColor: "#000000",
      padding: 48,
      gap: 12,
      fontFamily: "Inter",
    },
    [
      el("div", { display: "flex", fontSize: 30, color: "#8a93a6", marginBottom: 16 }, title),
      ...rows,
      footer(asOf, 16),
    ],
  );
}

export default defineTool({
  description:
    "Render a World Cup odds image card (PNG). Two templates: 'head_to_head' compares exactly 2 teams; 'draw' ranks 2-8 teams by probability. Pass probabilities from get_wc_odds. The card is posted to the thread automatically — do not describe its contents in detail afterwards.",
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

    const [font, ...flagUris] = await Promise.all([
      loadFont(),
      ...teams.map((team) => loadFlagDataUri(team.flag)),
    ]);
    const withFlags = teams.map((team, i) => ({ ...team, flagUri: flagUris[i] }));
    const asOf = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

    const tree =
      template === "head_to_head"
        ? headToHeadCard(title, withFlags, asOf)
        : drawCard(title, [...withFlags].sort((a, b) => b.pct - a.pct), asOf);

    const svg = await satori(tree as Parameters<typeof satori>[0], {
      width: WIDTH,
      height: template === "head_to_head" ? 520 : 200 + teams.length * 68,
      fonts: [{ name: "Inter", data: font, weight: 600, style: "normal" }],
    });
    const png = new Resvg(svg).render().asPng();

    return {
      pngBase64: Buffer.from(png).toString("base64"),
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
