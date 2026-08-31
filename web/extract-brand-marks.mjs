/**
 * Strip the flat backdrop out of the brand exports in public/proyektologos/v3/
 * and trim each one to its ink, in place.
 *
 * The v3 artwork ships as a flat RGB render on a near-white card. Everything
 * downstream — BrandMark, the favicon set, render-final-assets.mjs — expects a
 * transparent, tightly-cropped mark (that is what v2 was), so this bridges the
 * two. A plain colour key would leave a white halo on the antialiased edges, so
 * edge pixels are un-matted instead: P = a*F + (1-a)*B is solved for `a` using
 * the nearest fully-solid pixel as F, then the pixel is rewritten as F.
 *
 * Idempotent: an image that already carries real transparency is left alone.
 * Run from web/:  node extract-brand-marks.mjs [name ...]
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const DIR = path.resolve(process.cwd(), "public/proyektologos/v3");
const NAMES = ["logomark", "logo-primary", "logo-stacked"];

/** Everything below this distance from the backdrop is backdrop. Kills the faint export halo. */
const LO = 7;
/** Fraction of the ink's own distance from the backdrop above which a pixel counts as fully solid. */
const SOLID_RATIO = 0.55;
/** How far an edge pixel may look for a solid neighbour to borrow its colour from. */
const SEARCH_R = 6;

const dist = (r, g, b, c) => Math.hypot(r - c[0], g - c[1], b - c[2]);
const median = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];

/** The backdrop colour, read off a 3px ring around the edge. */
function readBackdrop(data, w, h) {
  const rs = [], gs = [], bs = [];
  const push = (x, y) => {
    const i = (y * w + x) * 4;
    rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
  };
  for (let x = 0; x < w; x += 2) for (let y = 0; y < 3; y++) { push(x, y); push(x, h - 1 - y); }
  for (let y = 0; y < h; y += 2) for (let x = 0; x < 3; x++) { push(x, y); push(w - 1 - x, y); }
  return [median(rs), median(gs), median(bs)];
}

async function strip(name) {
  const file = path.join(DIR, `${name}.png`);
  const src = sharp(file);
  const meta = await src.metadata();
  const { data, info } = await src.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;

  if (meta.hasAlpha) {
    let transparent = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 250) transparent++;
    if (transparent > w * h * 0.02) {
      console.log(`${name}: already transparent, skipped`);
      return;
    }
  }

  const bg = readBackdrop(data, w, h);

  // Distance field, and the ink's typical distance from the backdrop (P98 keeps
  // a stray dark pixel from inflating the scale).
  const d = new Float32Array(w * h);
  const sample = [];
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    d[p] = dist(data[i], data[i + 1], data[i + 2], bg);
    if ((p & 7) === 0) sample.push(d[p]);
  }
  sample.sort((a, b) => a - b);
  const solidThreshold = sample[Math.floor(sample.length * 0.98)] * SOLID_RATIO;

  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const i = p * 4;
      if (d[p] >= solidThreshold) {
        out[i] = data[i]; out[i + 1] = data[i + 1]; out[i + 2] = data[i + 2]; out[i + 3] = 255;
        continue;
      }
      if (d[p] <= LO) continue; // leaves 0,0,0,0

      // Antialiased edge: borrow the nearest solid pixel as F and solve for alpha.
      let best = -1, bestD = Infinity;
      for (let dy = -SEARCH_R; dy <= SEARCH_R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -SEARCH_R; dx <= SEARCH_R; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (d[q] < solidThreshold) continue;
          const r2 = dx * dx + dy * dy;
          if (r2 < bestD) { bestD = r2; best = q; }
        }
      }
      if (best < 0) continue;

      const j = best * 4;
      const a = Math.min(1, d[p] / Math.max(1, d[best]));
      out[i] = data[j]; out[i + 1] = data[j + 1]; out[i + 2] = data[j + 2];
      out[i + 3] = Math.round(a * 255);
    }
  }

  // Trim to the ink. v2 was cropped flush, and every downstream scale ratio
  // assumes that, so a padded canvas would silently shrink every icon.
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (out[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }

  await sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
    .png({ compressionLevel: 9 })
    .toFile(`${file}.tmp`);
  fs.renameSync(`${file}.tmp`, file);

  console.log(
    `${name}: bg rgb(${bg}) -> transparent, cropped ${w}x${h} to ${x1 - x0 + 1}x${y1 - y0 + 1}`,
  );
}

for (const name of process.argv.slice(2).length ? process.argv.slice(2) : NAMES) {
  await strip(name);
}
