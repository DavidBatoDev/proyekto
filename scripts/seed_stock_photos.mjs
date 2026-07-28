#!/usr/bin/env node
/**
 * Seeds curated stock photos into the public R2 bucket and emits the manifest
 * the web app imports.
 *
 * Roadmap thumbnails used to be fetched from Pexels at runtime, once per
 * roadmap create — which scaled 1:1 with traffic and hit the free-tier ceiling.
 * This script front-loads that work: you supply a folder of images, it
 * normalises and compresses them to well under 1 MB, uploads them once, and
 * writes web/src/data/stockPhotoManifest.ts. After that, picking a cover image
 * is a pure local lookup with no network call and no quota.
 *
 * Source layout — one directory per theme, names must match THEMES below:
 *
 *   seed-images/
 *     web-development/  mobile-app/  saas/  ai-ml/  ...
 *     generic/            <- required; the fallback pool
 *
 * Usage:
 *   cd scripts && npm install && cd ..
 *   node scripts/seed_stock_photos.mjs --source=./seed-images --dry-run
 *   node scripts/seed_stock_photos.mjs --source=./seed-images --skip-upload
 *   node scripts/seed_stock_photos.mjs --source=./seed-images
 *
 * Upload transport is chosen by --upload (default "auto"): the S3 endpoint is
 * probed first because it reuses the R2_* keys already in backend/.env, and
 * falls back to `wrangler r2 object put --remote` if that handshake fails.
 * docs/08-storage-media/r2-architecture.md records TLS failures against
 * <account>.r2.cloudflarestorage.com on some networks, which is why the
 * fallback exists — but it does work from a machine with a clean path to it.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Theme keys. Kept in sync BY HAND with STOCK_PHOTO_MANIFEST in
 * web/src/data/stockPhotoManifest.ts and THEME_KEYWORDS in
 * web/src/lib/stockPhoto.ts. An unrecognised source directory is a hard error,
 * which is what keeps the three lists honest.
 */
const THEMES = [
  "web-development",
  "mobile-app",
  "saas",
  "ai-ml",
  "e-commerce",
  "marketing",
  "health-fitness",
  "finance",
  "education",
  "design",
  "data-analytics",
  "devops-cloud",
  "security",
  "operations",
  "team-collaboration",
  "generic",
];

/** Every theme needs enough photos for Shuffle to have somewhere to go. */
const MIN_PER_THEME = 3;

const SOURCE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ".tif",
  ".tiff",
  ".gif",
]);

/** Re-encode at successively lower quality until the file fits the cap. */
const QUALITY_LADDER = [80, 70, 60, 50, 40];

const DEFAULTS = {
  source: "./seed-images",
  out: "web/src/data/stockPhotoManifest.ts",
  staging: ".stock-staging",
  bucket: "proyekto-media",
  prefix: "stock",
  baseUrl: "https://cdn.proyekto.tech",
  maxBytes: 1_000_000,
  width: 1200,
  height: 675,
  quality: 80,
};

async function main() {
  loadEnvFiles();

  const options = parseCliOptions(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  const sourceDir = path.resolve(repoRoot, options.source ?? DEFAULTS.source);
  const stagingDir = path.resolve(repoRoot, options.staging ?? DEFAULTS.staging);
  const outFile = path.resolve(repoRoot, options.out ?? DEFAULTS.out);
  const bucket = options.bucket ?? process.env.R2_PUBLIC_BUCKET ?? DEFAULTS.bucket;
  const prefix = options.prefix ?? DEFAULTS.prefix;
  const baseUrl = (
    options.baseUrl ??
    process.env.R2_PUBLIC_BASE_URL ??
    DEFAULTS.baseUrl
  ).replace(/\/+$/, "");
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const width = options.width ?? DEFAULTS.width;
  const height = options.height ?? DEFAULTS.height;
  const quality = options.quality ?? DEFAULTS.quality;

  console.log("=== seed stock photos ===");
  console.log(`source     ${sourceDir}`);
  console.log(`staging    ${stagingDir}`);
  console.log(`manifest   ${outFile}`);
  console.log(`target     ${bucket}/${prefix}/  ->  ${baseUrl}/${prefix}/`);
  console.log(
    `encode     ${width}x${height} jpeg q${quality} (max ${formatBytes(maxBytes)})`,
  );
  if (options.dryRun) console.log("mode       DRY RUN (no writes, no uploads)");
  else if (options.skipUpload) console.log("mode       stage + manifest only");

  const plan = readSourcePlan(sourceDir);

  if (options.dryRun) {
    console.log("\n=== plan ===");
    let planned = 0;
    for (const theme of THEMES) {
      const count = plan.get(theme)?.length ?? 0;
      planned += count;
      console.log(`  ${theme.padEnd(20)} ${String(count).padStart(3)} image(s)`);
    }
    console.log(`\n${planned} image(s) would be processed. Nothing written.`);
    return;
  }

  const sharp = await loadSharp();

  console.log("\n=== compress ===");
  const manifest = new Map();
  const stats = { count: 0, bytes: 0, largest: 0, largestKey: "" };

  resetDirectory(stagingDir);

  for (const theme of THEMES) {
    const files = plan.get(theme) ?? [];
    const themeStagingDir = path.join(stagingDir, theme);
    fs.mkdirSync(themeStagingDir, { recursive: true });

    const keys = [];
    for (const [index, sourceFile] of files.entries()) {
      const name = `${String(index + 1).padStart(2, "0")}.jpg`;
      const stagedPath = path.join(themeStagingDir, name);

      const buffer = await encodeWithinBudget(sharp, sourceFile, {
        width,
        height,
        quality,
        maxBytes,
      });
      if (!buffer) {
        console.error(
          `\nCould not get ${sourceFile} under ${formatBytes(maxBytes)} ` +
            `even at quality ${QUALITY_LADDER[QUALITY_LADDER.length - 1]}. ` +
            "Remove it or pre-shrink it, then re-run.",
        );
        process.exit(1);
      }

      fs.writeFileSync(stagedPath, buffer);
      keys.push(`${prefix}/${theme}/${name}`);

      stats.count += 1;
      stats.bytes += buffer.byteLength;
      if (buffer.byteLength > stats.largest) {
        stats.largest = buffer.byteLength;
        stats.largestKey = `${theme}/${name}`;
      }
    }

    manifest.set(theme, keys);
    console.log(
      `  ${theme.padEnd(20)} ${String(keys.length).padStart(3)} image(s)`,
    );
  }

  if (!options.skipUpload) {
    console.log("\n=== upload ===");
    const mode = await resolveUploadMode(options.upload ?? "auto", repoRoot);
    console.log(`  transport ${mode}`);
    if (mode === "s3") {
      await uploadAllViaS3({ manifest, stagingDir, bucket, repoRoot });
    } else {
      assertWranglerAvailable(repoRoot);
      uploadAll({ manifest, stagingDir, bucket, repoRoot });
    }
  } else {
    console.log("\n=== upload === skipped (--skip-upload)");
  }

  writeManifest({ outFile, baseUrl, manifest });
  formatWithBiome({ outFile, repoRoot });
  console.log(`\nmanifest written to ${path.relative(repoRoot, outFile)}`);

  console.log("\n=== summary ===");
  console.log(`  images     ${stats.count}`);
  console.log(`  total      ${formatBytes(stats.bytes)}`);
  console.log(
    `  average    ${formatBytes(Math.round(stats.bytes / Math.max(1, stats.count)))}`,
  );
  console.log(`  largest    ${formatBytes(stats.largest)} (${stats.largestKey})`);
  console.log(
    `\nVerify one object, then flip VITE_STOCK_PHOTOS_ENABLED=true:\n` +
      `  curl -sI ${baseUrl}/${prefix}/generic/01.jpg | head -1`,
  );
}

/** Reads the source tree and validates it before any expensive work happens. */
function readSourcePlan(sourceDir) {
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    console.error(
      `Source directory not found: ${sourceDir}\n` +
        `Create it with one sub-directory per theme:\n  ${THEMES.join("\n  ")}`,
    );
    process.exit(1);
  }

  const known = new Set(THEMES);
  const entries = fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());

  const unknown = entries
    .map((entry) => entry.name)
    .filter((name) => !known.has(name));
  if (unknown.length > 0) {
    console.error(
      `Unrecognised theme directory: ${unknown.join(", ")}\n` +
        `Rename it, or add the theme to THEMES here AND to ` +
        `web/src/data/stockPhotoManifest.ts and web/src/lib/stockPhoto.ts.`,
    );
    process.exit(1);
  }

  const plan = new Map();
  const thin = [];

  for (const theme of THEMES) {
    const themeDir = path.join(sourceDir, theme);
    const files = fs.existsSync(themeDir)
      ? fs
          .readdirSync(themeDir)
          .filter((name) =>
            SOURCE_EXTENSIONS.has(path.extname(name).toLowerCase()),
          )
          .sort()
          .map((name) => path.join(themeDir, name))
      : [];

    if (files.length < MIN_PER_THEME) thin.push(`${theme} (${files.length})`);
    plan.set(theme, files);
  }

  if (thin.length > 0) {
    console.error(
      `Every theme needs at least ${MIN_PER_THEME} images so Shuffle has ` +
        `somewhere to go. Under-filled: ${thin.join(", ")}`,
    );
    process.exit(1);
  }

  return plan;
}

/**
 * Resizes and encodes, walking the quality ladder until the result fits.
 * Returns null when even the lowest quality is too big.
 */
async function encodeWithinBudget(sharp, sourceFile, { width, height, quality, maxBytes }) {
  const ladder = [quality, ...QUALITY_LADDER.filter((q) => q < quality)];

  for (const attempt of ladder) {
    const buffer = await sharp(sourceFile)
      .rotate() // honour EXIF orientation before cropping
      .resize(width, height, { fit: "cover", position: "attention" })
      .jpeg({ quality: attempt, mozjpeg: true, progressive: true })
      .toBuffer();

    if (buffer.byteLength <= maxBytes) return buffer;
  }

  return null;
}

function uploadAll({ manifest, stagingDir, bucket, repoRoot }) {
  const realtimeDir = path.join(repoRoot, "realtime");
  let uploaded = 0;
  const total = [...manifest.values()].reduce((sum, keys) => sum + keys.length, 0);

  for (const [theme, keys] of manifest) {
    for (const key of keys) {
      const filePath = path.join(stagingDir, theme, path.basename(key));
      try {
        execFileSync(
          "npx",
          [
            "wrangler",
            "r2",
            "object",
            "put",
            `${bucket}/${key}`,
            `--file=${filePath}`,
            "--content-type=image/jpeg",
            // Without --remote wrangler writes to local simulated storage and
            // the objects never reach the real bucket.
            "--remote",
          ],
          { cwd: realtimeDir, stdio: "pipe", shell: process.platform === "win32" },
        );
      } catch (error) {
        const detail = error?.stderr?.toString?.() ?? String(error);
        console.error(`\nUpload failed for ${key}:\n${detail}`);
        process.exit(1);
      }

      uploaded += 1;
      if (uploaded % 10 === 0 || uploaded === total) {
        console.log(`  ${uploaded}/${total} uploaded`);
      }
    }
  }
}

/**
 * Picks the upload transport.
 *
 * `wrangler` is the documented-safe default because R2's S3 endpoint has been
 * seen failing the TLS handshake on some networks (see
 * docs/08-storage-media/r2-architecture.md). But it needs an interactive
 * `wrangler login`, while the S3 path reuses the R2_* keys already in
 * backend/.env — so "auto" probes S3 first and falls back.
 */
async function resolveUploadMode(requested, repoRoot) {
  if (requested === "s3" || requested === "wrangler") return requested;

  const client = await createS3Client(repoRoot);
  if (!client) return "wrangler";

  try {
    const { HeadBucketCommand } = await loadS3Module(repoRoot);
    await client.send(
      new HeadBucketCommand({
        Bucket: process.env.R2_PUBLIC_BUCKET || DEFAULTS.bucket,
      }),
    );
    return "s3";
  } catch (error) {
    console.log(
      `  (S3 endpoint unreachable — ${error?.name ?? "error"}; falling back to wrangler)`,
    );
    return "wrangler";
  }
}

/**
 * @aws-sdk/client-s3 lives in backend/node_modules rather than scripts/ — it is
 * already a backend dependency, and duplicating a multi-megabyte AWS SDK just
 * for a one-off script is not worth it. Returns null when it cannot be
 * resolved, which sends the caller down the wrangler path.
 */
async function loadS3Module(repoRoot) {
  try {
    const require = createRequire(path.join(repoRoot, "backend", "noop.js"));
    return require("@aws-sdk/client-s3");
  } catch {
    return null;
  }
}

async function createS3Client(repoRoot) {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;

  const s3 = await loadS3Module(repoRoot);
  if (!s3) return null;

  return new s3.S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    // Load-bearing: R2 rejects the aws-sdk v3 default flexible checksums
    // (aws-chunked + CRC32 trailer) and aborts the request mid-flight.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

async function uploadAllViaS3({ manifest, stagingDir, bucket, repoRoot }) {
  const client = await createS3Client(repoRoot);
  const { PutObjectCommand } = await loadS3Module(repoRoot);

  let uploaded = 0;
  const total = [...manifest.values()].reduce(
    (sum, keys) => sum + keys.length,
    0,
  );

  for (const [theme, keys] of manifest) {
    for (const key of keys) {
      const filePath = path.join(stagingDir, theme, path.basename(key));
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: fs.readFileSync(filePath),
            ContentType: "image/jpeg",
            // Immutable content at a content-addressed key: let the CDN and
            // browsers keep it for a year.
            CacheControl: "public, max-age=31536000, immutable",
          }),
        );
      } catch (error) {
        console.error(
          `\nUpload failed for ${key}: ${error?.name}: ${error?.message}`,
        );
        process.exit(1);
      }

      uploaded += 1;
      if (uploaded % 25 === 0 || uploaded === total) {
        console.log(`  ${uploaded}/${total} uploaded`);
      }
    }
  }
}

function assertWranglerAvailable(repoRoot) {
  try {
    execFileSync("npx", ["wrangler", "--version"], {
      cwd: path.join(repoRoot, "realtime"),
      stdio: "pipe",
      shell: process.platform === "win32",
    });
  } catch {
    console.error(
      "wrangler is not available. Install deps in realtime/ and log in:\n" +
        "  npm --prefix realtime install\n" +
        "  npx --prefix realtime wrangler login",
    );
    process.exit(1);
  }
}

/** Emits Biome-shaped TypeScript (tabs, double quotes) so `biome check` is a no-op. */
function writeManifest({ outFile, baseUrl, manifest }) {
  const entries = THEMES.map((theme) => {
    const keys = manifest.get(theme) ?? [];
    const quotedKey = /^[a-z][a-z0-9]*$/.test(theme) ? theme : `"${theme}"`;
    if (keys.length === 0) return `\t${quotedKey}: [],`;
    const lines = keys.map((key) => `\t\t"${key}",`).join("\n");
    return `\t${quotedKey}: [\n${lines}\n\t],`;
  }).join("\n");

  const content = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Written by \`node scripts/seed_stock_photos.mjs\`, which compresses a folder of
 * source images, uploads them to the proyekto-media R2 bucket, and emits this
 * manifest. Re-run the script to regenerate.
 *
 * The pools are empty until the first seed run. An empty pool makes
 * \`pickStockPhotoUrl\` return null, which falls the roadmap create flow back to
 * the generated gradient thumbnail — so this file is safe to commit before any
 * objects exist in R2.
 */

/** Public origin bound to the R2 public bucket. */
export const STOCK_PHOTO_BASE_URL = "${baseUrl}";

/**
 * Theme keys. Kept in sync BY HAND with \`THEMES\` in
 * scripts/seed_stock_photos.mjs — the script fails if a source directory does
 * not match one of these, which is what keeps the two lists honest.
 *
 * \`generic\` is the required fallback pool for categories that match nothing.
 */
export const STOCK_PHOTO_MANIFEST: Record<string, readonly string[]> = {
${entries}
};
`;

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, content, "utf8");
}

/**
 * Hands the generated file to Biome rather than trying to match its wrapping
 * rules here — it collapses short arrays onto one line when they fit the line
 * width, and reimplementing that heuristic would silently drift.
 *
 * Best-effort: a missing Biome leaves valid, if unformatted, TypeScript.
 */
function formatWithBiome({ outFile, repoRoot }) {
  const webDir = path.join(repoRoot, "web");
  try {
    execFileSync("npx", ["biome", "format", "--write", outFile], {
      cwd: webDir,
      stdio: "pipe",
      shell: process.platform === "win32",
    });
  } catch {
    console.log(
      "  (biome not available — run `npx biome format --write` in web/ before committing)",
    );
  }
}

async function loadSharp() {
  try {
    const module = await import("sharp");
    return module.default ?? module;
  } catch {
    console.error(
      "sharp is not installed. Run:\n  npm --prefix scripts install",
    );
    process.exit(1);
  }
}

function resetDirectory(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

function parseCliOptions(argv) {
  const options = {
    source: null,
    out: null,
    staging: null,
    bucket: null,
    prefix: null,
    baseUrl: null,
    maxBytes: null,
    width: null,
    height: null,
    quality: null,
    upload: null,
    dryRun: false,
    skipUpload: false,
  };

  for (const arg of argv) {
    if (arg.startsWith("--source=")) {
      options.source = arg.slice("--source=".length);
      continue;
    }
    if (arg.startsWith("--out=")) {
      options.out = arg.slice("--out=".length);
      continue;
    }
    if (arg.startsWith("--staging=")) {
      options.staging = arg.slice("--staging=".length);
      continue;
    }
    if (arg.startsWith("--bucket=")) {
      options.bucket = arg.slice("--bucket=".length);
      continue;
    }
    if (arg.startsWith("--prefix=")) {
      options.prefix = arg.slice("--prefix=".length);
      continue;
    }
    if (arg.startsWith("--base-url=")) {
      options.baseUrl = arg.slice("--base-url=".length);
      continue;
    }
    if (arg.startsWith("--max-bytes=")) {
      options.maxBytes = Number(arg.slice("--max-bytes=".length));
      continue;
    }
    if (arg.startsWith("--width=")) {
      options.width = Number(arg.slice("--width=".length));
      continue;
    }
    if (arg.startsWith("--height=")) {
      options.height = Number(arg.slice("--height=".length));
      continue;
    }
    if (arg.startsWith("--quality=")) {
      options.quality = Number(arg.slice("--quality=".length));
      continue;
    }
    if (arg.startsWith("--upload=")) {
      options.upload = arg.slice("--upload=".length);
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--skip-upload") {
      options.skipUpload = true;
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

  const candidates = [cwdEnv, scriptEnv, repoEnv, backendEnv];
  for (const filePath of candidates) {
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
