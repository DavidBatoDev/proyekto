/**
 * Render the @capacitor/assets source set: the Proyekto logomark on white.
 * Output -> web/assets/, which `npx @capacitor/assets generate` consumes to
 * produce every Android/iOS density + the adaptive-icon layers.
 * Run from web/:  node render-final-assets.mjs
 *
 * Source artwork is public/proyektologos/v3/logomark.png — the indigo mark on
 * transparency, cropped flush to its ink by extract-brand-marks.mjs. Every
 * scale ratio below is a fraction of the icon square and assumes that flush
 * crop, so re-cropping the source silently resizes every icon.
 *
 * The mark is inlined as a data URI because the v3 brand artwork ships as a
 * raster export; the only vector in the repo (v1/logovector.svg) is the LEGACY
 * orange/pink mark. It is drawn in its own colour: launcher icons cannot carry
 * transparency, so the backdrop is white rather than a brand fill, which is
 * also the only backdrop the indigo mark keeps full contrast against.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const OUT = path.resolve(process.cwd(), "assets");
fs.mkdirSync(OUT, { recursive: true });

const MARK_SRC = path.resolve(process.cwd(), "public/proyektologos/v3/logomark.png");
const MARK_DATA_URI = `data:image/png;base64,${fs.readFileSync(MARK_SRC).toString("base64")}`;

/** Icon backdrop. Plain white — see the header note on transparency. */
const BG = "#FFFFFF";
/** Splash backdrop for dark mode; the indigo mark reads cleanly on it. */
const BG_DARK = "#0B1020";

function html({ bg, markScale, withMark = true }) {
  const mark = withMark
    ? `<img src="${MARK_DATA_URI}" style="height:${Math.round(markScale * 100)}%;width:auto;display:block;">`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent}
    .icon{width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden;${bg}}
  </style></head><body><div class="icon">${mark}</div></body></html>`;
}

// name -> { size, html, transparent }
const ASSETS = {
  // Adaptive background: full-bleed white (no mark).
  "icon-background": { size: 1024, transparent: false,
    html: html({ bg: `background:${BG};`, withMark: false }) },
  // Adaptive foreground: the mark on transparent, inside the safe zone (~52%).
  // Android masks the outer ~33%, so anything larger risks being clipped.
  "icon-foreground": { size: 1024, transparent: true,
    html: html({ bg: "background:transparent;", markScale: 0.52 }) },
  // Composed square/round icon (iOS + legacy Android): white + the mark.
  "icon-only": { size: 1024, transparent: false,
    html: html({ bg: `background:${BG};`, markScale: 0.58 }) },
  // Browser-tab source. Not consumed by @capacitor/assets — it feeds the
  // favicon below, which stays transparent so it sits on any tab-bar colour.
  // Scaled up because a favicon has no home-screen padding to respect.
  "favicon-src": { size: 512, transparent: true,
    html: html({ bg: "background:transparent;", markScale: 0.86 }) },
  // Splash (light): white + centered mark.
  "splash": { size: 2732, transparent: false,
    html: html({ bg: `background:${BG};`, markScale: 0.22 }) },
  // Splash (dark): dark navy + centered mark (avoids a bright flash).
  "splash-dark": { size: 2732, transparent: false,
    html: html({ bg: `background:${BG_DARK};`, markScale: 0.22 }) },
};

const only = process.argv.slice(2);
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
const pg = await ctx.newPage();
for (const [name, a] of Object.entries(ASSETS)) {
  if (only.length && !only.includes(name)) continue;
  await pg.setViewportSize({ width: a.size, height: a.size });
  await pg.setContent(a.html, { waitUntil: "networkidle" });
  await pg.screenshot({
    path: path.join(OUT, `${name}.png`),
    clip: { x: 0, y: 0, width: a.size, height: a.size },
    omitBackground: a.transparent,
  });
  console.log(`[asset] ${name}.png (${a.size}x${a.size}${a.transparent ? ", transparent" : ""})`);
}
await browser.close();
console.log(`[asset] done -> ${OUT}`);

// ---------------------------------------------------------------------------
// web/public icons, derived from the same rendered squares the native icons use
// so the browser tab and the phone home screen can never drift apart.
// ---------------------------------------------------------------------------
if (!only.length || only.includes("web")) {
  const png = (src, size) =>
    sharp(path.join(OUT, src)).resize(size, size).png({ compressionLevel: 9 });
  // iOS composites a transparent apple-touch-icon onto black, and a maskable
  // manifest icon is padded by the launcher, so those two stay opaque.
  const opaque = (size) => png("icon-only.png", size);
  const tab = (size) => png("favicon-src.png", size);

  for (const [file, size, render] of [
    ["public/favicon-32.png", 32, tab],
    ["public/apple-touch-icon.png", 180, opaque],
    ["public/logo192.png", 192, opaque],
    ["public/logo512.png", 512, opaque],
  ]) {
    await render(size).toFile(file);
    console.log(`[web-icon] ${file} (${size}x${size})`);
  }

  // favicon.ico, hand-packed. sharp cannot write ICO, and rather than add a
  // dependency for one file we use the PNG-in-ICO form (supported since Vista):
  // a 6-byte ICONDIR, one 16-byte ICONDIRENTRY per image, then the PNG payloads.
  const icoSizes = [16, 32, 48];
  const images = await Promise.all(icoSizes.map((s) => tab(s).toBuffer()));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(icoSizes.length, 4);
  const entries = Buffer.alloc(16 * icoSizes.length);
  let cursor = 6 + 16 * icoSizes.length;
  icoSizes.forEach((s, i) => {
    const b = 16 * i;
    entries.writeUInt8(s, b); // width  (0 would mean 256)
    entries.writeUInt8(s, b + 1); // height
    entries.writeUInt16LE(1, b + 4); // color planes
    entries.writeUInt16LE(32, b + 6); // bits per pixel
    entries.writeUInt32LE(images[i].length, b + 8);
    entries.writeUInt32LE(cursor, b + 12);
    cursor += images[i].length;
  });
  fs.writeFileSync("public/favicon.ico", Buffer.concat([header, entries, ...images]));
  console.log(`[web-icon] public/favicon.ico (${icoSizes.join(", ")})`);
}
