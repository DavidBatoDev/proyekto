/**
 * Supplementary capture for the public auth forms (/auth/login, /auth/signup).
 * The main capture runs authenticated, so those routes redirect to /dashboard.
 * This run uses a FRESH (no-auth) context so the actual forms render. Overwrites
 * the misleading dashboard-dupe screenshots in pw-audit/{mobile,desktop}.
 *
 * Run from web/:  node playwright/audit/capture-public.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE = (process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const OUT = path.resolve(process.cwd(), "pw-audit");
const PAGES = [
  { path: "/auth/login", slug: "auth_login" },
  { path: "/auth/signup", slug: "auth_signup" },
];
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, mobile: true },
  { name: "desktop", width: 1440, height: 900, mobile: false },
];

const browser = await chromium.launch({ headless: true });
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.mobile ? 2 : 1,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
  });
  for (const p of PAGES) {
    const page = await ctx.newPage();
    await page.goto(`${BASE}${p.path}`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 7000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const file = path.join(OUT, vp.name, `${p.slug}.png`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file, fullPage: true });
    console.log(`[${vp.name}] ${p.path} -> ${page.url().replace(BASE, "")}`);
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log("[public] done");
