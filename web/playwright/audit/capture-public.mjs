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
const themeArgument = process.argv.find((argument) => argument.startsWith("--theme="));
const AUDIT_THEME = process.env.PLAYWRIGHT_AUDIT_THEME || themeArgument?.slice("--theme=".length) || null;
const DESKTOP_ONLY = process.argv.includes("--desktop-only");
const OUT = path.resolve(process.cwd(), AUDIT_THEME ? `pw-theme-audit-${AUDIT_THEME}` : "pw-audit");
const PAGES = [
  { path: "/", slug: "root" },
  { path: "/landing", slug: "landing" },
  { path: "/auth/login", slug: "auth_login" },
  { path: "/auth/signup", slug: "auth_signup" },
  { path: "/auth/forgot-password", slug: "auth_forgot-password" },
  { path: "/auth/verify", slug: "auth_verify" },
  { path: "/auth/callback", slug: "auth_callback" },
  { path: "/auth/admin/login", slug: "auth_admin_login" },
  { path: "/auth/admin/signin", slug: "auth_admin_signin" },
  { path: "/consultant", slug: "consultant" },
  { path: "/consultant/browse", slug: "consultant_browse" },
  { path: "/project/roadmap", slug: "project_roadmap" },
];
const VIEWPORTS = DESKTOP_ONLY
  ? [{ name: "desktop", width: 1440, height: 900, mobile: false }]
  : [
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
  if (AUDIT_THEME) {
    await ctx.addInitScript((theme) => {
      sessionStorage.setItem("proyekto.theme-audit", theme);
    }, AUDIT_THEME);
  }
  for (const p of PAGES) {
    const page = await ctx.newPage();
    await page.goto(`${BASE}${p.path}`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page
      .waitForLoadState("networkidle", { timeout: AUDIT_THEME ? 2500 : 7000 })
      .catch(() => {});
    await page.waitForTimeout(AUDIT_THEME ? 700 : 1200);
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
