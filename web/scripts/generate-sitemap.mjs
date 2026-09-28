#!/usr/bin/env node
/**
 * Regenerates web/public/sitemap.xml from the docs manifest plus the handful of
 * public marketing routes.
 *
 * The docs manifest is the source of truth for article URLs, so the sitemap is
 * derived from it rather than hand-maintained — a list of 47 URLs kept by hand
 * is a list that goes stale on the first rename. The manifest is read as TEXT
 * (the same technique the route-coverage tests use) so this script needs no
 * TypeScript toolchain.
 *
 * Run: node scripts/generate-sitemap.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ORIGIN = "https://www.proyekto.tech";

const manifestPath = fileURLToPath(
  new URL("../src/content/docs.manifest.ts", import.meta.url),
);
const manifest = readFileSync(manifestPath, "utf8");

const articles = [
  ...manifest.matchAll(/slug: "([^"]+)",\s*\n\s*section: "([^"]+)"/g),
].map(([, slug, section]) => `/docs/${section}/${slug}`);

if (articles.length === 0) {
  console.error("No docs articles found — has the manifest shape changed?");
  process.exit(1);
}

// Public, indexable pages only. Anything behind a login is deliberately absent.
const staticRoutes = [
  "/",
  "/product",
  "/pricing",
  "/docs",
  "/contact",
  "/start-selling",
  "/privacy",
  "/terms",
];

const urls = [...staticRoutes, ...articles.sort()];

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((path) => `  <url><loc>${ORIGIN}${path}</loc></url>`).join("\n")}
</urlset>
`;

const out = fileURLToPath(new URL("../public/sitemap.xml", import.meta.url));
writeFileSync(out, xml);
console.log(`sitemap.xml: ${urls.length} URLs (${articles.length} docs articles)`);
