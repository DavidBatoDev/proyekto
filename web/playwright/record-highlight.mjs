/**
 * Records a fast in-app highlight tour as a .webm — for the homepage hero
 * background video. Four beats: Roadmap canvas → Roadmap + AI (send a prompt &
 * show the reply) → Work items kanban (drag cards between columns) → Chat
 * (send a message). Rendered at a smaller viewport but captured at 1080p to
 * "zoom" the UI. The final clip is sped up 3× in ffmpeg (see the encode step).
 *
 * WRITES (authorized): sends one #general chat message and moves 1–2 kanban
 * cards (status persists). The AI prompt is informational (no roadmap mutation).
 *
 * PRIVACY: the chat DM sidebar can't be toggled off in-app, so an init-script
 * MutationObserver hides the "Direct Messages" list before it can render.
 *
 * Run from web/:  node playwright/record-highlight.mjs
 * Env: BASE_URL, PROJECT_ID, ROADMAP_ID, CHAT_REF, VIEWPORT (e.g. 1280x720),
 *      OUT_DIR, STORAGE_STATE, HEADLESS.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = (process.env.BASE_URL || "https://www.proyekto.tech").replace(/\/$/, "");
const PROJECT_ID = process.env.PROJECT_ID || "69d405c9-1eee-4b0f-91b4-2e677ba10c23";
const ROADMAP_ID = process.env.ROADMAP_ID || "5ebdbb85-87a6-4685-aba4-fcf7f2283afe";
const CHAT_REF = process.env.CHAT_REF || "channel-general";
const OUT_DIR = process.env.OUT_DIR || "C:/tmp/pw-record";
const STORAGE_STATE = process.env.STORAGE_STATE || "playwright/.auth/user.json";
const HEADLESS = process.env.HEADLESS !== "0";
const [VPW, VPH] = (process.env.VIEWPORT || "1440x810").split("x").map(Number);
const RW = 1920;
const RH = 1080;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const roadmapUrl = `${BASE_URL}/project/${PROJECT_ID}/roadmap/${ROADMAP_ID}?view=roadmapView`;
const workItemsUrl = `${BASE_URL}/project/${PROJECT_ID}/work-items/${ROADMAP_ID}`;
const chatUrl = `${BASE_URL}/project/${PROJECT_ID}/chat/${CHAT_REF}`;

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: HEADLESS });
const context = await browser.newContext({
  storageState: STORAGE_STATE,
  viewport: { width: VPW, height: VPH },
  // Capture at the (zoomed) viewport size; ffmpeg upscales to 1080p. Must match
  // the viewport, else Playwright pads with gray instead of scaling.
  recordVideo: { dir: OUT_DIR, size: { width: VPW, height: VPH } },
  reducedMotion: "no-preference",
});

// Hide the chat "Direct Messages" list as soon as it renders — it contains real
// DMs (incl. offensive text) unfit for a public video. Channels stay visible.
await context.addInitScript(() => {
  const hide = () => {
    for (const p of document.querySelectorAll("aside p")) {
      if ((p.textContent || "").trim().toLowerCase() === "direct messages") {
        const box = p.parentElement;
        if (box) box.style.setProperty("display", "none", "important");
      }
    }
  };
  const start = () => {
    hide();
    new MutationObserver(hide).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
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
async function fitView() {
  const fit = page.locator(".react-flow__controls-fitview").first();
  if (await visible(fit)) {
    await fit.click();
    await sleep(1000);
  }
}

// ── Beat 1: Roadmap canvas ───────────────────────────────────────────────────
let readyAtMs = 0;
await step("roadmap: load", async () => {
  const t0 = Date.now();
  await page.goto(roadmapUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".react-flow").first().waitFor({ timeout: 45_000 });
  await page.locator(".react-flow__node").first().waitFor({ timeout: 45_000 });
  readyAtMs = Date.now() - t0;
  console.log(`[rec] canvas ready ~${readyAtMs}ms (trim hint)`);
  await sleep(1500);
});
await step("roadmap: ensure AI panel closed (clean canvas beat)", async () => {
  const panel = page.getByLabel("AI Assistant Panel");
  if (await visible(panel)) {
    await page.getByTitle("Toggle AI chat panel").click().catch(() => {});
    await sleep(700);
  }
});
await step("roadmap: fit + zoom + pan", async () => {
  await fitView();
  const zoomIn = page.locator(".react-flow__controls-zoomin").first();
  if (await visible(zoomIn)) {
    await zoomIn.click();
    await sleep(600);
    await zoomIn.click();
    await sleep(800);
  }
  const pane = page.locator(".react-flow__pane").first();
  const box = await pane.boundingBox().catch(() => null);
  if (box) {
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.55);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.46, { steps: 26 });
    await page.mouse.up();
    await sleep(900);
  }
  await fitView();
  await sleep(500);
});

// ── Beat 2: Roadmap with AI — send a prompt, show the reply ───────────────────
await step("AI: open + send prompt + reply", async () => {
  const toggle = page.getByTitle("Toggle AI chat panel");
  await toggle.waitFor({ timeout: 15_000 });
  await toggle.click();
  const panel = page.getByLabel("AI Assistant Panel");
  await panel.waitFor({ timeout: 15_000 });
  await sleep(1200);
  const composer = panel.getByPlaceholder("Chat or request roadmap edits...");
  if (await visible(composer)) {
    await composer.click();
    const prompt = "What should we prioritize next in this roadmap?";
    const respPromise = page
      .waitForResponse(
        (r) => /\/messages(\?|$)/.test(r.url()) && r.request().method() === "POST",
        { timeout: 60_000 },
      )
      .catch(() => null);
    try {
      await composer.pressSequentially(prompt, { delay: 32 });
    } catch {
      await composer.fill(prompt);
    }
    await sleep(400);
    await composer.press("Enter");
    await respPromise;
    // wait for the assistant to finish (the "Working / Gathering activity"
    // indicator clears once the reply has rendered); cap so the beat stays snappy
    await panel
      .getByText(/gathering activity|working/i)
      .first()
      .waitFor({ state: "hidden", timeout: 9000 })
      .catch(() => {});
    await sleep(2200);
    const pbox = await panel.boundingBox().catch(() => null);
    if (pbox) {
      await page.mouse.move(pbox.x + pbox.width / 2, pbox.y + pbox.height / 2);
      await page.mouse.wheel(0, 300);
      await sleep(1000);
    }
  }
});

// ── Beat 3: Work items — drag cards between columns ──────────────────────────
await step("work-items: drag cards", async () => {
  await page.goto(workItemsUrl, { waitUntil: "domcontentloaded" });
  const board = page.locator("div.flex.gap-2.p-2").first();
  await board.waitFor({ timeout: 45_000 });
  await sleep(2000);

  const columns = board.locator(":scope > div");
  const colCount = await columns.count();
  const cardSel = "div.bg-white.rounded-lg.p-3";

  // columns (with their card counts)
  const counts = [];
  for (let i = 0; i < colCount; i++) {
    counts.push(await columns.nth(i).locator(cardSel).count().catch(() => 0));
  }
  console.log(`[rec] kanban columns=${colCount} cardCounts=${counts.join(",")}`);

  async function dragFirstCard(fromI, toI) {
    const card = columns.nth(fromI).locator(cardSel).first();
    const drop = columns.nth(toI).locator("div.overflow-y-auto").first();
    const cb = await card.boundingBox();
    const db = await drop.boundingBox();
    if (!cb || !db) return false;
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await page.mouse.down();
    await page.mouse.move(cb.x + cb.width / 2 + 6, cb.y + cb.height / 2 + 2, { steps: 3 });
    await sleep(200);
    await page.mouse.move(db.x + db.width / 2, db.y + 60, { steps: 30 });
    await sleep(350);
    await page.mouse.up();
    await sleep(1400); // let the optimistic move settle + PATCH fire
    return true;
  }

  // Drag a card over to the next column, then bring one back — two visible
  // moves that leave the column counts net-zero (so repeated runs don't drift
  // the real board).
  const withCards = counts.map((c, i) => ({ c, i })).filter((x) => x.c > 0).map((x) => x.i);
  if (withCards.length) {
    const a = withCards[0];
    const b = a + 1 < colCount ? a + 1 : a - 1;
    if (b >= 0 && b !== a) {
      console.log(`[rec] drag card ${a} -> ${b}`);
      await dragFirstCard(a, b);
      await sleep(700);
      console.log(`[rec] drag card ${b} -> ${a} (return)`);
      await dragFirstCard(b, a);
    }
  } else {
    console.warn("[rec] no draggable cards found");
  }
});

// ── Beat 4: Chat — send a message (DM list hidden by init script) ─────────────
await step("chat: send a message", async () => {
  await page.goto(chatUrl, { waitUntil: "domcontentloaded" });
  const composer = page.locator('textarea[placeholder*="Message"]').first();
  await composer.waitFor({ timeout: 45_000 });
  await sleep(1200);
  // Hide the entire right "DETAILS" panel (it lists real collaborator names
  // under "Chat members"). Climb from the DETAILS header to the ~320px panel
  // container and hide it.
  await page
    .evaluate(() => {
      const norm = (s) => (s || "").trim().toLowerCase();
      for (const n of document.querySelectorAll("*")) {
        if (norm(n.textContent) === "details") {
          let el = n;
          for (let i = 0; i < 6 && el.parentElement; i++) {
            el = el.parentElement;
            const w = el.getBoundingClientRect().width;
            if (w > 240 && w < 560) {
              el.style.setProperty("display", "none", "important");
              return;
            }
          }
        }
      }
    })
    .catch(() => {});
  await sleep(600);
  await composer.click();
  const msg = "Hey team 👋 kicking off the launch sprint — roadmap's looking great!";
  try {
    await composer.pressSequentially(msg, { delay: 26 });
  } catch {
    await composer.fill(msg);
  }
  await sleep(500);
  await composer.press("Enter");
  // wait for it to appear in the thread
  await page
    .locator("[data-message-id]")
    .filter({ hasText: "launch sprint" })
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  await sleep(2200);
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
