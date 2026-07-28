#!/usr/bin/env node
/**
 * Downloads a starter set of stock photos from Pexels into `seed-images/`, one
 * directory per theme, ready for `seed_stock_photos.mjs` to compress and
 * upload.
 *
 * This is a BUILD-TIME tool, run by hand. The product never calls Pexels: the
 * photos end up in our own R2 bucket and the app reads a committed manifest.
 * Keeping the fetch in its own script is what makes the seed script
 * provider-agnostic — swap this out for any other source, or skip it entirely
 * and populate seed-images/ yourself.
 *
 * Needs PEXELS_API_KEY (free, https://www.pexels.com/api/). One request per
 * theme, so a full run costs ~16 of the 200/hour allowance.
 *
 * Usage:
 *   node scripts/fetch_stock_photos.mjs --per-theme=16
 *   node scripts/fetch_stock_photos.mjs --themes=finance,security --force
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PEXELS_SEARCH_ENDPOINT = "https://api.pexels.com/v1/search";
const REQUEST_TIMEOUT_MS = 20000;

/**
 * Theme -> search phrase. Editorial choices: each phrase is tuned to return
 * photos that read as a project cover image rather than a literal illustration
 * of the noun. Keys must match THEMES in seed_stock_photos.mjs.
 */
const THEME_QUERIES = {
  "web-development": "web developer workspace code",
  "mobile-app": "smartphone mobile app hands",
  saas: "modern startup office team",
  "ai-ml": "artificial intelligence abstract technology",
  "e-commerce": "online shopping delivery boxes",
  marketing: "marketing strategy whiteboard",
  "health-fitness": "fitness running workout",
  finance: "finance accounting calculator desk",
  education: "students learning classroom",
  design: "designer creative desk sketching",
  "data-analytics": "data charts analytics screen",
  "devops-cloud": "server room data center",
  security: "cyber security lock digital",
  operations: "warehouse logistics forklift",
  "team-collaboration": "team meeting collaboration office",
  generic: "abstract gradient texture background",
};

const DEFAULTS = {
  source: "./seed-images",
  perTheme: 16,
  orientation: "landscape",
};

async function main() {
  loadEnvFiles();

  const options = parseCliOptions(process.argv.slice(2));
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const sourceDir = path.resolve(repoRoot, options.source ?? DEFAULTS.source);
  const perTheme = options.perTheme ?? DEFAULTS.perTheme;
  const orientation = options.orientation ?? DEFAULTS.orientation;

  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    console.error(
      "PEXELS_API_KEY is not set. Add it to backend/.env or scripts/.env.\n" +
        "Get a free key at https://www.pexels.com/api/",
    );
    process.exit(1);
  }

  const themes = options.themes ?? Object.keys(THEME_QUERIES);
  const unknown = themes.filter((theme) => !THEME_QUERIES[theme]);
  if (unknown.length > 0) {
    console.error(
      `Unknown theme: ${unknown.join(", ")}\nKnown: ${Object.keys(THEME_QUERIES).join(", ")}`,
    );
    process.exit(1);
  }

  console.log("=== fetch stock photos ===");
  console.log(`destination  ${sourceDir}`);
  console.log(`themes       ${themes.length}`);
  console.log(`per theme    ${perTheme} (${orientation})`);
  if (options.dryRun) console.log("mode         DRY RUN");

  const credits = [];
  let downloaded = 0;
  let skipped = 0;

  for (const theme of themes) {
    const query = THEME_QUERIES[theme];
    const themeDir = path.join(sourceDir, theme);

    const existing = fs.existsSync(themeDir)
      ? fs.readdirSync(themeDir).filter((n) => /\.(jpe?g|png|webp)$/i.test(n))
      : [];
    if (existing.length >= perTheme && !options.force) {
      console.log(
        `  ${theme.padEnd(20)} already has ${existing.length} — skipping (use --force to refetch)`,
      );
      skipped += existing.length;
      continue;
    }

    const photos = await searchPexels({ apiKey, query, orientation, perTheme });
    if (photos.length === 0) {
      console.error(`\nNo photos returned for "${query}" (${theme}).`);
      process.exit(1);
    }

    if (options.dryRun) {
      console.log(
        `  ${theme.padEnd(20)} would download ${photos.length} for "${query}"`,
      );
      continue;
    }

    fs.rmSync(themeDir, { recursive: true, force: true });
    fs.mkdirSync(themeDir, { recursive: true });

    for (const [index, photo] of photos.entries()) {
      const name = `${String(index + 1).padStart(2, "0")}.jpg`;
      // large2x (~1880px) so the seed script downscales rather than upscales.
      const buffer = await download(photo.src.large2x);
      fs.writeFileSync(path.join(themeDir, name), buffer);
      credits.push({
        theme,
        file: name,
        photographer: photo.photographer,
        url: photo.url,
      });
      downloaded += 1;
    }

    console.log(
      `  ${theme.padEnd(20)} ${String(photos.length).padStart(3)} downloaded  "${query}"`,
    );
  }

  if (!options.dryRun && credits.length > 0) {
    writeCredits({ repoRoot, credits });
  }

  console.log("\n=== summary ===");
  console.log(`  downloaded ${downloaded}`);
  if (skipped > 0) console.log(`  skipped    ${skipped} (already present)`);
  if (!options.dryRun) {
    console.log("\nNext:");
    console.log("  node scripts/seed_stock_photos.mjs --source=./seed-images --dry-run");
    console.log("  node scripts/seed_stock_photos.mjs --source=./seed-images");
  }
}

async function searchPexels({ apiKey, query, orientation, perTheme }) {
  const url = new URL(PEXELS_SEARCH_ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", orientation);
  url.searchParams.set("per_page", String(Math.min(80, perTheme)));
  url.searchParams.set("page", "1");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      // Pexels uses a bare key, NOT a Bearer token.
      headers: { Authorization: apiKey },
      signal: controller.signal,
    });
    if (!response.ok) {
      const remaining = response.headers.get("X-Ratelimit-Remaining") ?? "n/a";
      throw new Error(
        `Pexels responded ${response.status} for "${query}" (ratelimit_remaining=${remaining})`,
      );
    }
    const body = await response.json();
    return (body.photos ?? []).slice(0, perTheme);
  } finally {
    clearTimeout(timer);
  }
}

async function download(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Download failed ${response.status}: ${url}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The Pexels licence does not require attribution, but crediting the
 * photographers costs nothing and keeps the provenance of every shipped asset
 * traceable back to a source.
 */
function writeCredits({ repoRoot, credits }) {
  const outFile = path.join(
    repoRoot,
    "docs",
    "08-storage-media",
    "stock-photo-credits.md",
  );

  const byTheme = new Map();
  for (const credit of credits) {
    if (!byTheme.has(credit.theme)) byTheme.set(credit.theme, []);
    byTheme.get(credit.theme).push(credit);
  }

  const sections = [...byTheme.entries()]
    .map(([theme, items]) => {
      const rows = items
        .map(
          (item) =>
            `| \`${item.file}\` | ${item.photographer} | [source](${item.url}) |`,
        )
        .join("\n");
      return `### ${theme}\n\n| File | Photographer | Link |\n| --- | --- | --- |\n${rows}`;
    })
    .join("\n\n");

  const content = `# Stock photo credits

> **Status:** generated by \`node scripts/fetch_stock_photos.mjs\` — do not edit by hand.

Roadmap cover images are served from our own R2 bucket
(\`cdn.proyekto.tech/stock/...\`) and listed in
\`web/src/data/stockPhotoManifest.ts\`. They were downloaded once from
[Pexels](https://www.pexels.com), whose licence permits commercial use and
redistribution. Attribution is not required by that licence; these credits are
recorded so every shipped asset stays traceable to its source.

${sections}
`;

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, content, "utf8");
  console.log(
    `\ncredits written to ${path.relative(repoRoot, outFile)} (${credits.length} photos)`,
  );
}

function parseCliOptions(argv) {
  const options = {
    source: null,
    perTheme: null,
    orientation: null,
    themes: null,
    force: false,
    dryRun: false,
  };

  for (const arg of argv) {
    if (arg.startsWith("--source=")) {
      options.source = arg.slice("--source=".length);
      continue;
    }
    if (arg.startsWith("--per-theme=")) {
      options.perTheme = Number(arg.slice("--per-theme=".length));
      continue;
    }
    if (arg.startsWith("--orientation=")) {
      options.orientation = arg.slice("--orientation=".length);
      continue;
    }
    if (arg.startsWith("--themes=")) {
      options.themes = arg
        .slice("--themes=".length)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
    }
  }

  return options;
}

function loadEnvFiles() {
  const cwdEnv = path.join(process.cwd(), ".env");
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const scriptEnv = path.join(scriptDir, ".env");
  const repoEnv = path.join(scriptDir, "..", ".env");
  const backendEnv = path.join(scriptDir, "..", "backend", ".env");

  for (const filePath of [cwdEnv, scriptEnv, repoEnv, backendEnv]) {
    applyEnvFile(filePath);
  }
}

function applyEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
