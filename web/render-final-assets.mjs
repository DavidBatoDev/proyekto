/**
 * Render the FINAL @capacitor/assets source set for the chosen icon design
 * (A: white Proyekto mark on the brand gradient). Output -> web/assets/, which
 * `npx @capacitor/assets generate` consumes to produce every Android/iOS density
 * + the adaptive-icon layers. Run from web/:  node render-final-assets.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const OUT = path.resolve(process.cwd(), "assets");
fs.mkdirSync(OUT, { recursive: true });

const MARK =
  "M3 149.714V431.651L57.119 460.634V176.999L250.881 63.2645V119.032L104.029 206.282L103.041 318.117L156.074 349.399L300.555 263.149L299.864 147.216L347.07 120.831L396.251 149.615V317.617L155.777 460.734V403.567L105.806 372.785L103.831 488.518L152.42 520L448 348.299V117.933L346.083 60.9659L300.16 89.8491V31.7828L250.979 2L3 149.714ZM155.382 231.267V286.935L249.597 232.966V176.999L155.382 231.267Z";

const GRADIENT = "linear-gradient(135deg,#FF9933 0%,#FF3366 52%,#E72074 100%)";

function html({ bg, fill, markScale, withMark = true, glow = false }) {
  const shadow = glow ? "filter: drop-shadow(0 8px 24px rgba(0,0,0,0.20));" : "";
  const svg = withMark
    ? `<svg viewBox="0 0 451 524" xmlns="http://www.w3.org/2000/svg" style="height:${Math.round(
        markScale * 100,
      )}%;width:auto;display:block;${shadow}">
         <path fill-rule="evenodd" clip-rule="evenodd" d="${MARK}" fill="${fill}"/>
       </svg>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent}
    .icon{width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden;${bg}}
  </style></head><body><div class="icon">${svg}</div></body></html>`;
}

// name -> { size, html, transparent }
const ASSETS = {
  // Adaptive background: full-bleed brand gradient (no mark).
  "icon-background": { size: 1024, transparent: false,
    html: html({ bg: `background:${GRADIENT};`, withMark: false }) },
  // Adaptive foreground: white mark on transparent, inside the safe zone (~52%).
  "icon-foreground": { size: 1024, transparent: true,
    html: html({ bg: "background:transparent;", fill: "#FFFFFF", markScale: 0.52 }) },
  // Composed square/round icon (iOS + legacy Android): gradient + white mark.
  "icon-only": { size: 1024, transparent: false,
    html: html({ bg: `background:${GRADIENT};`, fill: "#FFFFFF", markScale: 0.58, glow: true }) },
  // Splash (light): gradient + centered white mark.
  "splash": { size: 2732, transparent: false,
    html: html({ bg: `background:${GRADIENT};`, fill: "#FFFFFF", markScale: 0.22 }) },
  // Splash (dark): dark navy + centered white mark (avoids a bright flash).
  "splash-dark": { size: 2732, transparent: false,
    html: html({ bg: "background:#0B1020;", fill: "#FFFFFF", markScale: 0.22 }) },
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
const pg = await ctx.newPage();
for (const [name, a] of Object.entries(ASSETS)) {
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
