/**
 * Render the @capacitor/assets source set: the Proyekto logomark in white on the
 * brand blue. Output -> web/assets/, which `npx @capacitor/assets generate`
 * consumes to produce every Android/iOS density + the adaptive-icon layers.
 * Run from web/:  node render-final-assets.mjs
 *
 * The mark is inlined as a data URI rather than an SVG path: the current brand
 * artwork (proyektologos/logomark.png) is a raster export, and the only vector
 * in the repo — proyektologos/light/logovector.svg — is the LEGACY orange/pink
 * mark. `brightness(0) invert(1)` flattens the artwork's indigo gradient to a
 * clean white silhouette off its alpha channel, which is what gives contrast on
 * the blue; the mark's own mid-indigo would nearly vanish against it.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const OUT = path.resolve(process.cwd(), "assets");
fs.mkdirSync(OUT, { recursive: true });

const MARK_SRC = path.resolve(process.cwd(), "public/proyektologos/logomark.png");
const MARK_DATA_URI = `data:image/png;base64,${fs.readFileSync(MARK_SRC).toString("base64")}`;

/** blue-500 -> blue-600 (--primary #2563eb) -> blue-700. */
const GRADIENT = "linear-gradient(135deg,#3B82F6 0%,#2563EB 52%,#1D4ED8 100%)";

function html({ bg, markScale, withMark = true, glow = false }) {
  const shadow = glow ? "filter: brightness(0) invert(1) drop-shadow(0 8px 24px rgba(0,0,0,0.20));" : "filter: brightness(0) invert(1);";
  const mark = withMark
    ? `<img src="${MARK_DATA_URI}" style="height:${Math.round(markScale * 100)}%;width:auto;display:block;${shadow}">`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent}
    .icon{width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden;${bg}}
  </style></head><body><div class="icon">${mark}</div></body></html>`;
}

// name -> { size, html, transparent }
const ASSETS = {
  // Adaptive background: full-bleed brand blue (no mark).
  "icon-background": { size: 1024, transparent: false,
    html: html({ bg: `background:${GRADIENT};`, withMark: false }) },
  // Adaptive foreground: white mark on transparent, inside the safe zone (~52%).
  // Android masks the outer ~33%, so anything larger risks being clipped.
  "icon-foreground": { size: 1024, transparent: true,
    html: html({ bg: "background:transparent;", markScale: 0.52 }) },
  // Composed square/round icon (iOS + legacy Android): blue + white mark.
  "icon-only": { size: 1024, transparent: false,
    html: html({ bg: `background:${GRADIENT};`, markScale: 0.58, glow: true }) },
  // Splash (light): blue + centered white mark.
  "splash": { size: 2732, transparent: false,
    html: html({ bg: `background:${GRADIENT};`, markScale: 0.22 }) },
  // Splash (dark): dark navy + centered white mark (avoids a bright flash).
  "splash-dark": { size: 2732, transparent: false,
    html: html({ bg: "background:#0B1020;", markScale: 0.22 }) },
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
// web/public icons, derived from the same icon-only.png the native icons use so
// the browser tab and the phone home screen can never drift apart.
// ---------------------------------------------------------------------------
if (!only.length || only.includes("web")) {
  const ICON = path.join(OUT, "icon-only.png");
  const png = (size) => sharp(ICON).resize(size, size).png({ compressionLevel: 9 });

  for (const [file, size] of [
    ["public/favicon-32.png", 32],
    ["public/apple-touch-icon.png", 180],
    ["public/logo192.png", 192],
    ["public/logo512.png", 512],
  ]) {
    await png(size).toFile(file);
    console.log(`[web-icon] ${file} (${size}x${size})`);
  }

  // favicon.ico, hand-packed. sharp cannot write ICO, and rather than add a
  // dependency for one file we use the PNG-in-ICO form (supported since Vista):
  // a 6-byte ICONDIR, one 16-byte ICONDIRENTRY per image, then the PNG payloads.
  const icoSizes = [16, 32, 48];
  const images = await Promise.all(icoSizes.map((s) => png(s).toBuffer()));
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
