/**
 * Generates the 1200x630 social-share image referenced by BaseLayout
 * (og:image / twitter:image) into public/og.png.
 *
 * Run with: bun run og
 *
 * The image is built as an SVG (so it stays in sync with the site's
 * palette and terminal aesthetic) and rasterized to PNG with resvg —
 * Twitter/Facebook/Slack/iMessage don't reliably render SVG OG images,
 * so a baked PNG is required.
 */
import { Resvg } from "@resvg/resvg-js";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");

// Palette mirrors src/styles/global.css
const BG = "#fbf6ec";
const FG = "#1a1a1a";
const MUTED = "#666";
const ACCENT = "#1d6dab";
const PROMPT = "#859900";
const HIGHLIGHT = "#cb4b16";
const BORDER = "#ecdfc4";
const CARD = "#fffdf8";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${BG}"/>
  <rect x="20" y="20" width="1160" height="590" rx="20" fill="none" stroke="${BORDER}" stroke-width="2"/>

  <!-- brand -->
  <text x="80" y="130" font-family="SFMono-Regular, Menlo, monospace" font-size="54" font-weight="700" fill="${FG}">mono-poly</text>
  <text x="80" y="184" font-family="SFMono-Regular, Menlo, monospace" font-size="30" fill="${MUTED}">Pragmatic code <tspan font-style="italic" fill="${HIGHLIGHT}">re</tspan>-organization across repositories.</text>

  <!-- terminal card -->
  <rect x="80" y="240" width="1040" height="210" rx="14" fill="${CARD}" stroke="${BORDER}" stroke-width="2"/>
  <circle cx="116" cy="278" r="7" fill="#e06c6c"/>
  <circle cx="142" cy="278" r="7" fill="#e0bd6c"/>
  <circle cx="168" cy="278" r="7" fill="#86b86c"/>
  <line x1="80" y1="302" x2="1120" y2="302" stroke="${BORDER}" stroke-width="2"/>

  <text x="116" y="358" font-family="SFMono-Regular, Menlo, monospace" font-size="28">
    <tspan fill="${PROMPT}">$ </tspan><tspan fill="${FG}">npx monopoly-repo move </tspan><tspan fill="${ACCENT}">packages/auth</tspan><tspan fill="${FG}"> --to </tspan><tspan fill="${ACCENT}">../api</tspan>
  </text>
  <text x="116" y="408" font-family="SFMono-Regular, Menlo, monospace" font-size="24" fill="${MUTED}">moved 4 commits · git log, git blame, git bisect still work</text>

  <!-- footer tagline -->
  <text x="80" y="530" font-family="SFMono-Regular, Menlo, monospace" font-size="26" fill="${FG}">Move code between git repos <tspan fill="${HIGHLIGHT}" font-weight="700">without losing history.</tspan></text>
  <text x="80" y="568" font-family="SFMono-Regular, Menlo, monospace" font-size="22" fill="${MUTED}">monorepo → polyrepo → monorepo · whatever your code needs</text>
</svg>`;

const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: 1200 },
  font: {
    fontDirs: ["/System/Library/Fonts", "/System/Library/Fonts/Supplemental"],
    defaultFontFamily: "Menlo",
    loadSystemFonts: true,
  },
});

mkdirSync(publicDir, { recursive: true });
const out = join(publicDir, "og.png");
writeFileSync(out, resvg.render().asPng());
console.log(`wrote ${out}`);
