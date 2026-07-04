/**
 * Records a portrait (phone-ratio) in-app highlight tour as a .webm — for the
 * homepage hero background video on MOBILE. Four beats, mirroring the desktop
 * recorder but using the app's responsive mobile UI:
 *   1. Roadmap — the mobile "Roadmap Structure" list; expand features to reveal tasks.
 *   2. AI — the full-screen AI Assistant overlay; send a prompt & show the reply.
 *   3. Work items — the mobile status-grouped task list; smooth scroll.
 *   4. Chat — deep-link straight into the #general channel thread & send a message.
 *
 * Captured at a mobile viewport (540×1170, 9:19.5) and upscaled 2× to 1080×2340
 * in ffmpeg (see the encode step in the shell). recordVideo.size MUST equal the
 * viewport, else Playwright pads with gray instead of scaling.
 *
 * WRITES (authorized): sends one #general chat message + one AI prompt (no
 * roadmap mutation). PRIVACY: chat is reached by deep-linking to the channel
 * thread UUID, which bypasses the mobile DM list (the only screen showing real
 * collaborator names); an init-script also hides any DM/members surface as a
 * safety net. The channel thread itself shows only the authenticated user's own
 * message ("You"), never another member's name.
 *
 * Run from web/:  node playwright/record-highlight-mobile.mjs
 * Env: BASE_URL, PROJECT_ID, ROADMAP_ID, CHAT_THREAD_ID, VIEWPORT (e.g. 540x1170),
 *      OUT_DIR, STORAGE_STATE, HEADLESS.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = (process.env.BASE_URL || "https://www.proyekto.tech").replace(/\/$/, "");
const PROJECT_ID = process.env.PROJECT_ID || "69d405c9-1eee-4b0f-91b4-2e677ba10c23";
const ROADMAP_ID = process.env.ROADMAP_ID || "5ebdbb85-87a6-4685-aba4-fcf7f2283afe";
// The #general channel ("Client Project Room") thread UUID — deep-linking here
// opens the thread directly on mobile, skipping the DM-name list.
const CHAT_THREAD_ID = process.env.CHAT_THREAD_ID || "8387d0b5-451d-44cf-b75d-e07d7e256fa7";
const OUT_DIR = process.env.OUT_DIR || "C:/tmp/pw-record-mobile";
const STORAGE_STATE = process.env.STORAGE_STATE || "playwright/.auth/user.json";
const HEADLESS = process.env.HEADLESS !== "0";
const [VPW, VPH] = (process.env.VIEWPORT || "540x1170").split("x").map(Number);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const roadmapUrl = `${BASE_URL}/project/${PROJECT_ID}/roadmap/${ROADMAP_ID}?view=roadmapView`;
const workItemsUrl = `${BASE_URL}/project/${PROJECT_ID}/work-items/${ROADMAP_ID}`;
const chatUrl = `${BASE_URL}/project/${PROJECT_ID}/chat/${CHAT_THREAD_ID}`;

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: HEADLESS });
const context = await browser.newContext({
  storageState: STORAGE_STATE,
  viewport: { width: VPW, height: VPH },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  recordVideo: { dir: OUT_DIR, size: { width: VPW, height: VPH } },
  reducedMotion: "no-preference",
});

// Safety net: keep real collaborator names off camera. We deep-link past the DM
// list, but if any DM list / members-details surface renders, hide it. Deferred
// to DOMContentLoaded — at document_start documentElement can be null.
await context.addInitScript(() => {
  const norm = (s) => (s || "").trim().toLowerCase();
  const hideMembersAsides = () => {
    // desktop-style right members panel, harmless if absent on mobile
    for (const a of document.querySelectorAll("aside.max-w-\\[92vw\\]")) {
      a.style.setProperty("display", "none", "important");
    }
  };
  const hideDMSections = () => {
    // Hide any "Direct Messages" section header + the name rows that follow it,
    // without nuking the whole chat screen. Matches the small section heading.
    for (const el of document.querySelectorAll("p, h2, h3, div, span")) {
      const t = norm(el.textContent);
      if (t === "direct messages" && el.children.length === 0) {
        // hide the heading and its following siblings (the DM name rows)
        let node = el.parentElement || el;
        node.style.setProperty("display", "none", "important");
      }
    }
  };
  const run = () => {
    hideMembersAsides();
    hideDMSections();
  };
  const start = () => {
    run();
    new MutationObserver(run).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
});

const page = await context.newPage();
page.setDefaultTimeout(30_000);

async function step(name, fn) {
  try {
    console.log(`[rec] ${name}`);
    await fn();
  } catch (e) {
    console.warn(`[rec] ${name} — skipped: ${String(e?.message || e).slice(0, 200)}`);
  }
}
const visible = (loc) => loc.isVisible().catch(() => false);

// ── Beat 1: Roadmap structure (mobile) — expand features to reveal tasks ─────
let readyAtMs = 0;
await step("roadmap: load", async () => {
  const t0 = Date.now();
  await page.goto(roadmapUrl, { waitUntil: "domcontentloaded" });
  await page.getByText("Roadmap Structure", { exact: false }).first().waitFor({ timeout: 45_000 });
  readyAtMs = Date.now() - t0;
  console.log(`[rec] roadmap ready ~${readyAtMs}ms (trim hint)`);
  await sleep(1600);
});
await step("roadmap: expand a couple of features", async () => {
  const expanders = page.locator('[aria-label="Expand feature"]');
  const n = await expanders.count();
  console.log(`[rec] expandable features: ${n}`);
  for (let i = 0; i < Math.min(3, n); i++) {
    // list re-renders after each expand, so always take the first still-collapsed one
    const btn = page.locator('[aria-label="Expand feature"]').first();
    if (await visible(btn)) {
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.click().catch(() => {});
      await sleep(900);
    }
  }
  await sleep(800);
});
await step("roadmap: gentle scroll", async () => {
  await page.mouse.wheel(0, 380);
  await sleep(1100);
  await page.mouse.wheel(0, 360);
  await sleep(1200);
});

// ── Beat 2: AI Assistant (mobile) — send a prompt, show the reply ────────────
await step("AI: open + send prompt + reply", async () => {
  const toggle = page.locator('[aria-label="Toggle AI assistant"]').first();
  await toggle.waitFor({ timeout: 15_000 });
  await toggle.click();
  const composer = page.getByPlaceholder("Chat or request roadmap edits...");
  await composer.waitFor({ timeout: 15_000 });
  await sleep(1200);
  await composer.click();
  const prompt = "What should we prioritize next in this roadmap?";
  const respPromise = page
    .waitForResponse(
      (r) => /\/messages(\?|$)/.test(r.url()) && r.request().method() === "POST",
      { timeout: 60_000 },
    )
    .catch(() => null);
  try {
    await composer.pressSequentially(prompt, { delay: 30 });
  } catch {
    await composer.fill(prompt);
  }
  await sleep(400);
  await composer.press("Enter");
  await respPromise;
  await page
    .getByText(/gathering activity|working/i)
    .first()
    .waitFor({ state: "hidden", timeout: 9000 })
    .catch(() => {});
  await sleep(2600);
  // let the reply settle in view
  await page.mouse.wheel(0, 260);
  await sleep(1200);
});

// ── Beat 3: Work items (mobile) — smooth scroll the task list ────────────────
await step("work-items: scroll the list", async () => {
  await page.goto(workItemsUrl, { waitUntil: "domcontentloaded" });
  await page.getByText(/^To do$/i).first().waitFor({ timeout: 45_000 }).catch(() => {});
  await sleep(1800);
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 300);
    await sleep(700);
  }
  await sleep(700);
  await page.mouse.wheel(0, -520);
  await sleep(1000);
});

// ── Beat 4: Chat (mobile thread) — send a message ────────────────────────────
await step("chat: open thread + send a message", async () => {
  await page.goto(chatUrl, { waitUntil: "domcontentloaded" });
  // Mobile chat is master→detail: the channel LIST shows first (DM names already
  // hidden by the init script). Tap the channel to push into its thread.
  const chan = page.getByText("Client Project Room", { exact: false }).first();
  await chan.waitFor({ timeout: 45_000 });
  await sleep(1000);
  await chan.click().catch(() => {});
  const composer = page.locator('textarea[placeholder*="Message"]').first();
  await composer.waitFor({ state: "visible", timeout: 20_000 });
  await sleep(1200);
  await composer.click();
  const msg = "On it — shipping the next milestone this week 🚀";
  try {
    await composer.pressSequentially(msg, { delay: 26 });
  } catch {
    await composer.fill(msg);
  }
  await sleep(500);
  await composer.press("Enter");
  await page
    .getByText("shipping the next milestone", { exact: false })
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  await sleep(2400);
});

await sleep(600);
await context.close(); // flushes the .webm
await browser.close();

const webms = fs
  .readdirSync(OUT_DIR)
  .filter((f) => f.endsWith(".webm"))
  .map((f) => path.join(OUT_DIR, f))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
console.log(`[rec] done. trimHintMs=${readyAtMs} video=${webms[0] ?? "(none)"}`);
