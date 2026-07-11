/**
 * Mobile-responsiveness audit capture.
 *
 * Drives a logged-in browser (reusing playwright/.auth/user.json) over every
 * reachable page at mobile + desktop viewports (plus a 320px narrow-stress pass
 * for known offenders), saving a full-page screenshot per (route × viewport)
 * and a manifest that accounts for EVERY route — captured, skipped (no entity),
 * redirected (account lacks access), or error. Read-only navigation.
 *
 * Prereqs (run from web/):
 *   1. dev server up on :3000 with VITE_API_URL pointed at prod (.env.local)
 *   2. npm run pw:auth   (mints playwright/.auth/user.json)
 * Run:  node playwright/audit/capture.mjs
 *
 * Output: web/pw-audit/{mobile,desktop,narrow}/<slug>.png
 *         web/pw-audit/manifest.json   + index.html (side-by-side viewer)
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { STATIC_ROUTES, DYNAMIC_ROUTES, NARROW_STRESS } from "./routes.mjs";

const BASE = (process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const STORAGE = path.resolve(process.cwd(), "playwright", ".auth", "user.json");
const themeArgument = process.argv.find((argument) => argument.startsWith("--theme="));
const AUDIT_THEME = process.env.PLAYWRIGHT_AUDIT_THEME || themeArgument?.slice("--theme=".length) || null;
const DESKTOP_ONLY = process.argv.includes("--desktop-only");
const OUT = path.resolve(process.cwd(), AUDIT_THEME ? `pw-theme-audit-${AUDIT_THEME}` : "pw-audit");

const THEME_DEFAULTS = {
  light: { background: "#FFFFFF", accent: "#6D78D5", contrast: 30 },
  "classic-dark": { background: "#1E1F21", accent: "#6D78D5", contrast: 30 },
  "magic-blue": { background: "#171925", accent: "#6D78D5", contrast: 30 },
  dark: { background: "#0E0F0F", accent: "#6D78D5", contrast: 30 },
  custom: { background: "#FFFFFF", accent: "#6D78D5", contrast: 30 },
};

async function installTheme(context) {
  if (!AUDIT_THEME || !THEME_DEFAULTS[AUDIT_THEME]) return;
  await context.addInitScript((theme) => {
    sessionStorage.setItem("proyekto.theme-audit", theme);
  }, AUDIT_THEME);
}

// Known dev-account ids (from playwright/drive.mjs) used as discovery fallbacks.
const FALLBACK = {
  projectId: "69d405c9-1eee-4b0f-91b4-2e677ba10c23",
  roadmapId: "5ebdbb85-87a6-4685-aba4-fcf7f2283afe",
  // Every project has a "general" channel (CHANNEL_GENERAL_REF in chatRef.ts),
  // so this ref always resolves even when no chat anchor is scraped.
  chatRef: "channel-general",
};

const VIEWPORTS = DESKTOP_ONLY
  ? [{ name: "desktop", width: 1440, height: 900 }]
  : [
      { name: "mobile", width: 390, height: 844 },
      { name: "desktop", width: 1440, height: 900 },
    ];
const NARROW = { name: "narrow", width: 320, height: 844 };

const slug = (p) =>
  p.replace(/^\//, "").replace(/[/:]/g, "_").replace(/_+$/, "") || "root";

const fill = (tpl, ids) => tpl.replace(/:(\w+)/g, (_, k) => ids[k] ?? `:${k}`);

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

async function settle(page) {
  // The dev server still talks to a local agent/realtime that isn't running, so
  // background sockets never go idle — cap the wait and fall through.
  await page
    .waitForLoadState("networkidle", { timeout: AUDIT_THEME ? 2500 : 7000 })
    .catch(() => {});
  await page.waitForTimeout(AUDIT_THEME ? 700 : 1300);
}

async function readProfileId(page) {
  return page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("sb-") && k.endsWith("-auth-token")) {
        try {
          return JSON.parse(localStorage.getItem(k))?.user?.id ?? null;
        } catch {
          return null;
        }
      }
    }
    return null;
  });
}

async function firstHref(page, selector) {
  return page
    .locator(selector)
    .first()
    .getAttribute("href", { timeout: 4000 })
    .catch(() => null);
}

/** Discover real entity ids by scraping list-page anchors after login. */
async function discoverIds(context) {
  const page = await context.newPage();
  const ids = {};

  // projectId — first project card on the dashboard.
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await settle(page);
  ids.profileId = await readProfileId(page);
  ids.userId = ids.profileId;
  const projHref = await firstHref(page, 'a[href*="/project/"]');
  const projMatch = projHref?.match(/\/project\/([^/?#]+)/);
  ids.projectId = projMatch?.[1] || FALLBACK.projectId;

  // roadmapId + chatRef — from inside the project.
  await page
    .goto(`${BASE}/project/${ids.projectId}/roadmap`, { waitUntil: "domcontentloaded" })
    .catch(() => {});
  await settle(page);
  const rmHref = await firstHref(page, 'a[href*="/roadmap/"]');
  const rmMatch = rmHref?.match(/\/roadmap\/([0-9a-f-]{8,})/i);
  ids.roadmapId = rmMatch?.[1] || FALLBACK.roadmapId;

  const chatHref = await firstHref(page, 'a[href*="/chat/"]');
  ids.chatRef = chatHref?.match(/\/chat\/([^/?#]+)/)?.[1] || FALLBACK.chatRef;

  // teamId — first real team (skip the /teams/me alias).
  await page.goto(`${BASE}/teams`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await settle(page);
  const teamHrefs = await page.locator('a[href*="/teams/"]').evaluateAll((as) =>
    as.map((a) => a.getAttribute("href")).filter(Boolean),
  );
  const teamHref = teamHrefs.find((h) => /\/teams\/(?!me\b)[^/?#]+/.test(h));
  ids.teamId = teamHref?.match(/\/teams\/([^/?#]+)/)?.[1] || null;

  if (ids.teamId) {
    await page
      .goto(`${BASE}/teams/${ids.teamId}/time/my-logs`, { waitUntil: "domcontentloaded" })
      .catch(() => {});
    await settle(page);
    const logHref = await firstHref(page, 'a[href*="/time/log/"]');
    ids.logId = logHref?.match(/\/time\/log\/([^/?#]+)/)?.[1] || null;
  }

  // share token — first roadmap shared with me, if any.
  await page
    .goto(`${BASE}/roadmap/shared-with-me`, { waitUntil: "domcontentloaded" })
    .catch(() => {});
  await settle(page);
  const shareHref = await firstHref(page, 'a[href*="/roadmap/shared/"]');
  ids.token = shareHref?.match(/\/roadmap\/shared\/([^/?#]+)/)?.[1] || null;

  await page.close();
  return ids;
}

/** Resolve the full route list (static + dynamic) for a given id set. */
function resolveRoutes(ids) {
  const out = [];
  for (const r of STATIC_ROUTES) {
    out.push({ template: r.path, url: r.path, group: r.group, auth: r.auth, status: "ready" });
  }
  for (const r of DYNAMIC_ROUTES) {
    const missing = r.needs.filter((k) => !ids[k]);
    if (missing.length) {
      out.push({
        template: r.tpl,
        url: null,
        group: r.group,
        auth: r.auth,
        status: "skipped",
        reason: `missing id: ${missing.join(", ")}`,
      });
    } else {
      out.push({
        template: r.tpl,
        url: fill(r.tpl, ids),
        group: r.group,
        auth: r.auth,
        status: "ready",
      });
    }
  }
  return out;
}

async function capture(context, viewport, route) {
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && consoleErrors.length < 6) consoleErrors.push(m.text().slice(0, 160));
  });
  page.on("pageerror", (e) => {
    if (consoleErrors.length < 6) consoleErrors.push(`pageerror: ${String(e.message).slice(0, 160)}`);
  });

  const rel = `${viewport.name}/${slug(route.template)}.png`;
  const file = path.join(OUT, rel);
  let status = "captured";
  let reason;
  let finalUrl;

  try {
    await page.goto(`${BASE}${route.url}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle(page);
    finalUrl = page.url();
    // An authed route bounced to /auth/login => the account can't reach it.
    if (route.auth && /\/auth\/(login|signin)/.test(finalUrl) && !/\/auth\//.test(route.url)) {
      status = "redirected";
      reason = "bounced to login (no access)";
    }
    ensureDir(path.dirname(file));
    await page.screenshot({ path: file, fullPage: true });
  } catch (err) {
    status = "error";
    reason = String(err?.message || err).slice(0, 200);
    try {
      ensureDir(path.dirname(file));
      await page.screenshot({ path: file, fullPage: false });
    } catch {}
  }

  await page.close();
  return { ...route, viewport: viewport.name, file: rel, finalUrl, status, reason, consoleErrors };
}

function writeIndexHtml(rows) {
  const byTemplate = new Map();
  for (const r of rows) {
    if (!byTemplate.has(r.template)) byTemplate.set(r.template, {});
    byTemplate.get(r.template)[r.viewport] = r;
  }
  const cell = (r) => {
    if (!r) return "<td><em>—</em></td>";
    if (r.status === "skipped" || r.status === "redirected" || r.status === "error")
      return `<td><span class="bad">${r.status}</span><br><small>${r.reason || ""}</small></td>`;
    return `<td><a href="${r.file}" target="_blank"><img src="${r.file}" loading="lazy"></a></td>`;
  };
  const rowsHtml = [...byTemplate.entries()]
    .map(
      ([tpl, v]) =>
        `<tr><th>${tpl}<br><small>${v.mobile?.finalUrl || v.desktop?.finalUrl || ""}</small></th>${cell(v.mobile)}${cell(v.desktop)}${cell(v.narrow)}</tr>`,
    )
    .join("\n");
  const html = `<!doctype html><meta charset=utf8><title>Mobile audit</title>
<style>body{font:13px system-ui;margin:16px;background:#0b0b0c;color:#ddd}
table{border-collapse:collapse}th,td{border:1px solid #333;padding:6px;vertical-align:top}
img{width:240px;display:block;border:1px solid #222}th{text-align:left;max-width:260px}
.bad{color:#f87171;font-weight:600}small{color:#888}thead th{position:sticky;top:0;background:#111}</style>
<h1>Mobile-responsiveness audit</h1>
<table><thead><tr><th>Route</th><th>mobile 390</th><th>desktop 1440</th><th>narrow 320</th></tr></thead>
<tbody>${rowsHtml}</tbody></table>`;
  fs.writeFileSync(path.join(OUT, "index.html"), html);
}

async function main() {
  if (!fs.existsSync(STORAGE)) {
    console.error(`No auth state at ${STORAGE}. Run \`npm run pw:auth\` first.`);
    process.exit(1);
  }
  ensureDir(OUT);
  const browser = await chromium.launch({ headless: true });

  // Discover ids in a desktop context first.
  const discoCtx = await browser.newContext({ storageState: STORAGE, viewport: { width: 1440, height: 900 } });
  await installTheme(discoCtx);
  const ids = await discoverIds(discoCtx);
  await discoCtx.close();
  console.log("[audit] discovered ids:", ids);

  const routes = resolveRoutes(ids);
  const rows = [];

  for (const viewport of VIEWPORTS) {
    const ctx = await browser.newContext({
      storageState: STORAGE,
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.name === "mobile" ? 2 : 1,
      isMobile: viewport.name === "mobile",
      hasTouch: viewport.name === "mobile",
    });
    await installTheme(ctx);
    for (const route of routes) {
      if (route.status === "skipped") {
        rows.push({ ...route, viewport: viewport.name, file: null, consoleErrors: [] });
        continue;
      }
      const res = await capture(ctx, viewport, route);
      rows.push(res);
      console.log(`[${viewport.name}] ${res.status.padEnd(10)} ${route.template}`);
    }
    await ctx.close();
  }

  // 320px narrow-stress pass for known offenders only.
  const narrowSet = new Set(DESKTOP_ONLY ? [] : NARROW_STRESS);
  const narrowRoutes = routes.filter((r) => narrowSet.has(r.template) && r.status === "ready");
  if (narrowRoutes.length) {
    const ctx = await browser.newContext({
      storageState: STORAGE,
      viewport: { width: NARROW.width, height: NARROW.height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await installTheme(ctx);
    for (const route of narrowRoutes) {
      const res = await capture(ctx, NARROW, route);
      rows.push(res);
      console.log(`[narrow]   ${res.status.padEnd(10)} ${route.template}`);
    }
    await ctx.close();
  }

  await browser.close();

  const manifest = {
    capturedAt: new Date().toISOString(),
    base: BASE,
    theme: AUDIT_THEME,
    ids,
    viewports: [...VIEWPORTS, NARROW],
    counts: rows.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {}),
    rows,
  };
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeIndexHtml(rows);
  console.log("\n[audit] done:", manifest.counts);
  console.log(`[audit] open ${path.join(OUT, "index.html")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
