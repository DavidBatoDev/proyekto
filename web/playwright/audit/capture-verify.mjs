/**
 * Focused re-capture of the pages fixed in the mobile-responsive sweep, to
 * confirm the fixes visually. Authenticated context (reuses .auth/user.json).
 * Output: web/pw-audit/verify/<slug>.png
 *
 * Run from web/:  node playwright/audit/capture-verify.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE = (process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const STORAGE = path.resolve(process.cwd(), "playwright", ".auth", "user.json");
const OUT = path.resolve(process.cwd(), "pw-audit", "verify");
const PROJECT_ID = "69d405c9-1eee-4b0f-91b4-2e677ba10c23";

// [path, slug, viewportWidth]
const PAGES = [
  ["/consultant", "consultant", 390],
  ["/landing", "landing", 390],
  ["/project-posting", "project-posting", 390],
  ["/auth/verify", "auth_verify", 390],
  ["/dashboard", "dashboard", 390],
  ["/dashboard", "dashboard@320", 320],
  ["/inbox", "inbox", 390],
  [`/project/${PROJECT_ID}/settings/permissions`, "permissions", 390],
];

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });

for (const [route, slug, width] of PAGES) {
  const ctx = await browser.newContext({
    storageState: fs.existsSync(STORAGE) ? STORAGE : undefined,
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 7000 }).catch(() => {});
  await page.waitForTimeout(1400);
  await page.screenshot({ path: path.join(OUT, `${slug}.png`), fullPage: true });
  console.log(`[${width}] ${route} -> ${page.url().replace(BASE, "")}`);
  await ctx.close();
}

await browser.close();
console.log("[verify] done");
