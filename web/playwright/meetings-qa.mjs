/**
 * Automated QA driver for the Google-Calendar-style meetings redesign
 * (Phases 0–3). Drives the live app HEADED at slowMo=800ms so the UI/UX is
 * watchable, captures a per-step screenshot + a full .webm recording, and
 * self-verifies the correctness-critical bits (timezone/DST math, recurring
 * expansion, scoped edit/cancel) directly against the backend API.
 *
 * It exercises, end to end:
 *   Phase 1 — Day/Week/Month/Year views, toolbar navigation, agenda, slot-create.
 *   Phase 2 — one-off editor: title/type/date/time, a non-local TIMEZONE
 *             (Australia/Sydney) verified to land on the exact UTC instant,
 *             branded video-link paste (Detected: Zoom), edit + validation.
 *   Phase 3 — a weekly RRULE series (America/New_York) verified to keep 09:00
 *             wall-clock across the November DST boundary; a custom recurrence
 *             (every 2 weeks ×5); scoped edit "This event" (detach) + scoped
 *             cancel "This event" via the Google-style scope dialog.
 *
 * All test meetings are titled "[QA] …" and CANCELLED at the end (cleanup).
 * The run writes real rows to whatever DB the local backend points at.
 *
 * PREREQS (run from web/):
 *   - Vite dev server on :3000 and the (restarted) backend on :8001 with the
 *     Phase 2/3 build — the recurrence-create path + /details + /cancel scope
 *     only exist there.
 *   - A fresh auth session: `npm run pw:auth` (and `npm run pw:install` once).
 *
 * Run:  cd web && node playwright/meetings-qa.mjs
 * Env overrides: PLAYWRIGHT_BASE_URL, VITE_API_URL, HEADLESS=1, SLOWMO=800.
 */
import fs from "node:fs";
import path from "node:path";
import { differenceInCalendarDays, parse } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { chromium } from "@playwright/test";

// ── config ───────────────────────────────────────────────────────────────────
const APP = (process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const BACKEND = (process.env.VITE_API_URL || "http://localhost:8001").replace(/\/$/, "");
const STORAGE = "playwright/.auth/user.json";
const HEADLESS = process.env.HEADLESS === "1";
const SLOWMO = Number(process.env.SLOWMO || 800);
const VP = { width: 1600, height: 900 };
const OUT = "C:/tmp/meetings-qa";
const VIDEO_DIR = path.join(OUT, "video");
const PREFIX = "[QA]";
// Wide window so a list call captures every instance incl. the Nov DST one.
const WIDE = "?from=2026-01-01T00:00:00.000Z&to=2027-12-31T00:00:00.000Z";

// Deterministic test dates (system "today" is 2026-07-08 per the environment).
const D = {
	// one-off, non-local tz, on a NON-recurring day so its agenda is clean
	oneoff: "2026-07-24", // Friday
	oneoffTz: "Australia/Sydney",
	// weekly series anchor — Wednesday; instances Jul 15,22,29,… into Nov (DST)
	weekly: "2026-07-15", // Wednesday
	weeklyTz: "America/New_York",
	// custom every-2-weeks series anchor — Thursday, local tz
	custom: "2026-07-16", // Thursday
};

// ── output dirs ───────────────────────────────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(VIDEO_DIR, { recursive: true });
for (const f of fs.readdirSync(OUT)) {
	if (f.endsWith(".png") || f.endsWith(".md")) fs.rmSync(path.join(OUT, f), { force: true });
}

// ── run state ─────────────────────────────────────────────────────────────────
const results = []; // { name, ok, detail }
const created = []; // { id, title, series_id } for cleanup
let shotN = 0;

const slug = (s) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);

// ── browser ───────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: HEADLESS, slowMo: SLOWMO });
const context = await browser.newContext({
	storageState: STORAGE,
	viewport: VP,
	recordVideo: { dir: VIDEO_DIR, size: VP },
});
const page = await context.newPage();
page.setDefaultTimeout(20_000);

// ── helpers ───────────────────────────────────────────────────────────────────
async function shot(name) {
	shotN += 1;
	const file = path.join(OUT, `${String(shotN).padStart(2, "0")}-${slug(name)}.png`);
	await page.screenshot({ path: file }).catch(() => {});
	return file;
}

async function step(name, fn) {
	console.log(`\n▶ ${name}`);
	try {
		await closeAnyModal(); // never let a prior failure's open modal block this step
		const detail = await fn();
		results.push({ name, ok: true, detail: detail || "" });
		console.log(`  ✅ PASS${detail ? ` — ${detail}` : ""}`);
	} catch (e) {
		const detail = String(e?.message || e).slice(0, 400);
		results.push({ name, ok: false, detail });
		console.log(`  ❌ FAIL — ${detail}`);
	} finally {
		await shot(name);
	}
}

function assert(cond, msg) {
	if (!cond) throw new Error(msg);
}

async function authToken() {
	return page.evaluate(() => {
		for (const k of Object.keys(localStorage)) {
			if (k.startsWith("sb-") && k.endsWith("-auth-token")) {
				try {
					return JSON.parse(localStorage.getItem(k))?.access_token ?? null;
				} catch {
					return null;
				}
			}
		}
		return null;
	});
}

async function api(method, p, body) {
	const token = await authToken();
	const opts = {
		method,
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
	};
	if (body !== undefined) opts.data = body;
	const r = await page.request.fetch(`${BACKEND}${p}`, opts);
	const json = await r.json().catch(() => null);
	return { status: r.status(), body: json };
}

async function listQA(status) {
	const { body } = await api("GET", `/api/meetings${WIDE}`);
	const arr = Array.isArray(body?.data) ? body.data : [];
	return arr.filter((m) => (m.title || "").startsWith(PREFIX) && (!status || m.status === status));
}

// wall-clock (in a chosen IANA zone) → UTC — mirrors web/src/lib/datetime.ts.
const wallToUtc = (date, time, tz) => fromZonedTime(`${date}T${time}:00`, tz).toISOString();
const sameInstant = (a, b) => Date.parse(a) === Date.parse(b);
const localDateOf = (iso) => {
	const d = new Date(iso);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

// ── editor + calendar locators ────────────────────────────────────────────────
const editor = () => page.locator("div.max-w-xl").filter({ has: page.getByPlaceholder("Add title") });
const titleInput = () => page.getByPlaceholder("Add title");

async function openCreate() {
	// Ensure no stale modal is mid-unmount before opening a fresh one, else its
	// detaching nodes get interacted with and later clicks hit detached elements.
	await titleInput().waitFor({ state: "hidden", timeout: 4000 }).catch(() => {});
	// exact: true — otherwise "Create" substring-matches all the
	// "Create meeting at <hour>" time-grid slot buttons (169 total).
	await page.getByRole("button", { name: "Create", exact: true }).click();
	await titleInput().waitFor({ state: "visible", timeout: 8000 });
}

async function clickView(label) {
	await page.getByRole("button", { name: label, exact: true }).click();
	await page.waitForTimeout(400);
}

const h2 = () => page.getByRole("heading", { level: 2 }).first();

async function setType(label) {
	await editor().locator("select").first().selectOption({ label });
}
async function setReminder(label) {
	await editor().locator("select").nth(1).selectOption({ label });
}

async function pickDate(ariaDay /* e.g. "July 24, 2026" */) {
	// The DatePickerField trigger has NO aria-label (its name is the formatted
	// date); the "Meeting date" aria-label lives on the popover. Target the
	// trigger by its calendar icon instead.
	await editor()
		.locator("button")
		.filter({ has: page.locator("svg.lucide-calendar") })
		.first()
		.click();
	const pop = page.getByRole("dialog", { name: "Meeting date" });
	await pop.waitFor({ timeout: 5000 });
	const cell = pop.getByRole("button", { name: ariaDay, exact: true });
	for (let i = 0; i < 24 && (await cell.count()) === 0; i += 1) {
		await pop.getByRole("button", { name: "Next month" }).click();
		await page.waitForTimeout(120);
	}
	await cell.click();
}

async function setTime(label /* "Start time"|"End time" */, value /* "9:00 AM" */) {
	// role=textbox — getByLabel also matches the picker's role=dialog popover,
	// which shares the same aria-label.
	const inp = page.getByRole("textbox", { name: label });
	await inp.click();
	await inp.fill(value);
	await inp.press("Enter");
	await page.waitForTimeout(150);
}

async function pickTimezone(searchTerm, clickRe) {
	await editor().getByRole("button", { name: /GMT/ }).first().click();
	const pop = page.getByRole("dialog", { name: "Select a timezone" });
	await pop.waitFor({ timeout: 5000 });
	await pop.getByPlaceholder("Search timezones…").fill(searchTerm);
	await page.waitForTimeout(250);
	await pop.getByRole("button", { name: clickRe }).first().click();
}

async function pickRepeat(nameRe) {
	await editor().getByRole("button", { name: "Does not repeat" }).click();
	const pop = page.getByRole("dialog", { name: "Repeat options" });
	await pop.waitFor({ timeout: 5000 });
	await pop.getByRole("button", { name: nameRe }).first().click();
}

async function pasteVideoLink(url) {
	await editor().getByRole("button", { name: /Paste a meeting link/ }).click();
	await page.getByPlaceholder("https://meet.google.com/…").fill(url);
}

/** Click Schedule, capture the POST /api/meetings response, return the Meeting. */
async function submitCreate() {
	const respP = page.waitForResponse(
		(r) => /\/api\/meetings$/.test(r.url()) && r.request().method() === "POST",
		{ timeout: 25_000 },
	);
	await editor().getByRole("button", { name: "Schedule" }).click();
	const resp = await respP;
	const json = await resp.json().catch(() => null);
	if (resp.status() >= 300) {
		throw new Error(`create failed ${resp.status()}: ${JSON.stringify(json)?.slice(0, 200)}`);
	}
	await titleInput().waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
	const m = json?.data;
	if (m?.id) created.push({ id: m.id, title: m.title, series_id: m.series_id });
	return m;
}

async function cancelEditor() {
	await editor().getByRole("button", { name: "Cancel" }).click();
	await titleInput().waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
}

/** Dismiss any popover/editor/dialog left open by a prior (possibly failed) step. */
async function closeAnyModal() {
	for (let i = 0; i < 4; i += 1) {
		const editorOpen = await titleInput().isVisible().catch(() => false);
		const dialogOpen = await page
			.getByText(/recurring event|Custom recurrence/)
			.first()
			.isVisible()
			.catch(() => false);
		if (!editorOpen && !dialogOpen) break;
		await page.keyboard.press("Escape").catch(() => {});
		if (editorOpen) {
			await editor().getByRole("button", { name: "Cancel" }).click({ timeout: 2000 }).catch(() => {});
		} else if (dialogOpen) {
			await page.getByRole("button", { name: "Cancel" }).last().click({ timeout: 2000 }).catch(() => {});
		}
		await page.waitForTimeout(300);
	}
	// wait for the dimming backdrop to actually leave the DOM
	await page
		.locator("div.bg-black\\/50")
		.first()
		.waitFor({ state: "hidden", timeout: 3000 })
		.catch(() => {});
}

/** Switch to Day view and page Prev/Next until the title date matches target. */
async function goToDay(targetLocalDate) {
	await clickView("Day");
	for (let i = 0; i < 400; i += 1) {
		const text = (await h2().innerText()).trim();
		const cur = parse(text, "EEEE, MMMM d, yyyy", new Date());
		const diff = differenceInCalendarDays(targetLocalDate, cur);
		if (diff === 0) return;
		await page
			.getByRole("button", { name: diff > 0 ? "Next" : "Previous", exact: true })
			.click();
		await page.waitForTimeout(200);
	}
	throw new Error("could not navigate Day view to target date");
}

const agendaRow = (title) => page.locator("div.rounded-xl").filter({ hasText: title }).first();

/** Switch to Month view and page to the given "MMMM yyyy" month. */
async function goToMonth(label) {
	await clickView("Month");
	const tgt = parse(label, "MMMM yyyy", new Date());
	for (let i = 0; i < 24; i += 1) {
		const text = (await h2().innerText()).trim();
		if (text === label) return;
		const cur = parse(text, "MMMM yyyy", new Date());
		await page
			.getByRole("button", { name: tgt > cur ? "Next" : "Previous", exact: true })
			.click();
		await page.waitForTimeout(200);
	}
	throw new Error(`could not navigate Month view to ${label}`);
}

// A month event CHIP — a button nested INSIDE a day-cell button (getByRole name
// alone would also match the outer cell, whose name includes the chip text).
const monthChip = (titleRe) => page.locator("button button").filter({ hasText: titleRe });
// The month day-CELL (button) that contains such a chip.
const monthCellWithChip = (titleRe) =>
	page.locator("button").filter({ has: page.getByRole("button", { name: titleRe }) });

// ── the run ───────────────────────────────────────────────────────────────────
try {
	// Preflight ----------------------------------------------------------------
	await step("Load /meetings (auth + calendar shell)", async () => {
		await page.goto(`${APP}/meetings`, { waitUntil: "domcontentloaded" });
		if (page.url().includes("/auth/login")) {
			throw new Error("redirected to login — stale session; run `npm run pw:auth`");
		}
		await page
			.getByRole("button", { name: "Create", exact: true })
			.waitFor({ timeout: 45_000 });
		await page.waitForTimeout(800);
	});

	await step("Preflight: backend reachable + auth token valid", async () => {
		const { status, body } = await api("GET", `/api/meetings${WIDE}`);
		assert(status === 200, `GET /api/meetings returned ${status}`);
		return `${(body?.data ?? []).length} meetings visible; backend ${BACKEND}`;
	});

	// ── Phase 1 — views & navigation ──────────────────────────────────────────
	await step("Phase 1: Week view is the default landing", async () => {
		await clickView("Week");
		assert(await page.getByRole("button", { name: "Today" }).isVisible(), "no Today button");
		for (const v of ["Day", "Week", "Month", "Year"]) {
			assert(
				await page.getByRole("button", { name: v, exact: true }).isVisible(),
				`view toggle missing: ${v}`,
			);
		}
	});

	await step("Phase 1: Day view — time grid + slot buttons", async () => {
		await clickView("Day");
		assert(
			(await page.getByRole("button", { name: "Create meeting at 9 AM" }).count()) > 0,
			"no 9 AM slot button (TimeGrid)",
		);
	});

	await step("Phase 1: slot click opens a prefilled create editor", async () => {
		await page.getByRole("button", { name: "Create meeting at 10 AM" }).first().click();
		await titleInput().waitFor({ timeout: 6000 });
		await cancelEditor(); // demo only — create nothing
	});

	await step("Phase 1: Week view — day columns + slots", async () => {
		await clickView("Week");
		assert(
			(await page.getByRole("button", { name: /^Create meeting at/ }).count()) > 0,
			"no week slot buttons",
		);
	});

	await step("Phase 1: Month view — weekday header row", async () => {
		await clickView("Month");
		for (const d of ["Sun", "Sat"]) {
			assert(
				(await page.getByText(d, { exact: true }).count()) > 0,
				`month weekday header missing: ${d}`,
			);
		}
	});

	await step("Phase 1: Year view — 12 mini-months", async () => {
		await clickView("Year");
		for (const m of ["January", "December"]) {
			assert((await page.getByText(m, { exact: true }).count()) > 0, `year month missing: ${m}`);
		}
	});

	await step("Phase 1: toolbar Today / Next / Previous navigation", async () => {
		await clickView("Week");
		const start = (await h2().innerText()).trim();
		await page.getByRole("button", { name: "Next" }).click();
		await page.waitForTimeout(200);
		await page.getByRole("button", { name: "Next" }).click();
		await page.waitForTimeout(200);
		const moved = (await h2().innerText()).trim();
		assert(moved !== start, "Next did not change the range");
		await page.getByRole("button", { name: "Previous" }).click();
		await page.getByRole("button", { name: "Previous" }).click();
		await page.waitForTimeout(200);
		const back = (await h2().innerText()).trim();
		assert(back === start, `Prev×2 did not return (${back} != ${start})`);
		return `range navigated: "${start}" → "${moved}" → back`;
	});

	// ── Phase 2 — one-off editor ───────────────────────────────────────────────
	await step("Phase 2: validation — empty title & end-before-start", async () => {
		await openCreate();
		await editor().getByRole("button", { name: "Schedule" }).click();
		await page.getByText("Give the meeting a title.").waitFor({ timeout: 4000 });
		// end-before-start: the End picker refuses any value ≤ start, so set a
		// small start, a valid end, then push start PAST the end (start has no min).
		await titleInput().fill(`${PREFIX} validation probe`);
		await setTime("Start time", "8:00 AM");
		await setTime("End time", "9:00 AM");
		await setTime("Start time", "10:00 AM");
		await editor().getByRole("button", { name: "Schedule" }).click();
		await page.getByText("The end time must be after the start time.").waitFor({ timeout: 4000 });
		await cancelEditor();
	});

	let oneoff = null;
	await step("Phase 2: create one-off in Australia/Sydney + branded video link", async () => {
		await openCreate();
		await titleInput().fill(`${PREFIX} One-off Sydney 9AM`);
		await setType("Status sync");
		await pickDate("July 24, 2026");
		await setTime("Start time", "9:00 AM");
		await setTime("End time", "9:30 AM");
		await pickTimezone("Sydney", /Sydney/);
		await pasteVideoLink("https://zoom.us/j/123456789");
		await page.getByText("Detected: Zoom").waitFor({ timeout: 4000 });
		await editor().locator('input[placeholder="Add location"]').fill("Level 3, Sydney office");
		await setReminder("30 minutes before");
		await editor().locator("textarea").fill("QA one-off in a non-local timezone.");
		await shot("phase2-oneoff-filled");
		oneoff = await submitCreate();
		assert(oneoff?.id, "create returned no meeting");
		return `id=${oneoff.id}`;
	});

	await step("Phase 2: VERIFY one-off UTC instant is DST-correct", async () => {
		assert(oneoff?.id, "no one-off created");
		const expected = wallToUtc(D.oneoff, "09:00", D.oneoffTz); // 2026-07-23T23:00:00Z (AEST)
		const { body } = await api("GET", `/api/meetings/${oneoff.id}`);
		const got = body?.data?.scheduled_at;
		assert(sameInstant(got, expected), `scheduled_at ${got} != expected ${expected}`);
		assert(body?.data?.video_provider === "external_link", "video_provider not external_link");
		assert(body?.data?.reminder_minutes === 30, "reminder_minutes not persisted");
		return `9:00 Sydney → ${expected} ✓`;
	});

	await step("Phase 2: one-off renders on the calendar (Month view)", async () => {
		await clickView("Month");
		const chip = page.getByRole("button", { name: /\[QA\] One-off Sydney/ });
		await chip.first().waitFor({ timeout: 6000 });
		return `${await chip.count()} chip(s) found`;
	});

	await step("Phase 2: edit the one-off (general edit, no scope)", async () => {
		// Click the event chip directly (opens the editor); the agenda is bound to
		// selectedDay, which toolbar nav doesn't move, so we don't use it here.
		await goToMonth("July 2026");
		await monthChip(/\[QA\] One-off Sydney 9AM/).first().click();
		await titleInput().waitFor({ timeout: 6000 });
		await titleInput().fill(`${PREFIX} One-off Sydney EDITED`);
		const respP = page.waitForResponse(
			(r) => /\/api\/meetings\/.+\/details$/.test(r.url()) && r.request().method() === "PATCH",
			{ timeout: 20_000 },
		);
		await editor().getByRole("button", { name: "Save" }).click();
		const resp = await respP;
		assert(resp.status() < 300, `PATCH /details failed ${resp.status()}`);
		await titleInput().waitFor({ state: "hidden", timeout: 6000 }).catch(() => {});
		const { body } = await api("GET", `/api/meetings/${oneoff.id}`);
		assert(body?.data?.title === `${PREFIX} One-off Sydney EDITED`, "title not updated");
	});

	// ── Phase 3 — recurring series ─────────────────────────────────────────────
	let weekly = null;
	let weeklyInstances = [];
	await step("Phase 3: create a WEEKLY series (America/New_York)", async () => {
		await clickView("Week");
		await openCreate();
		await titleInput().fill(`${PREFIX} Weekly Standup`);
		await setType("Status sync");
		await pickDate("July 15, 2026");
		await setTime("Start time", "9:00 AM");
		await setTime("End time", "9:30 AM");
		await pickTimezone("York", /New York/);
		await pickRepeat(/^Weekly on /);
		await shot("phase3-weekly-repeat-picked");
		weekly = await submitCreate();
		assert(weekly?.series_id, "series create returned no series_id");
		return `series_id=${weekly.series_id}`;
	});

	await step("Phase 3: VERIFY series materialized (shared series_id, distinct slots)", async () => {
		assert(weekly?.series_id, "no series");
		weeklyInstances = (await listQA("scheduled")).filter((m) => m.series_id === weekly.series_id);
		assert(weeklyInstances.length >= 4, `expected ≥4 instances, got ${weeklyInstances.length}`);
		const rids = new Set(weeklyInstances.map((m) => m.recurrence_id));
		assert(rids.size === weeklyInstances.length, "recurrence_ids not distinct");
		return `${weeklyInstances.length} instances`;
	});

	await step("Phase 3: VERIFY DST — 09:00 wall-clock held across the Nov boundary", async () => {
		for (const m of weeklyInstances) {
			const wall = formatInTimeZone(m.scheduled_at, D.weeklyTz, "HH:mm");
			assert(wall === "09:00", `instance ${m.scheduled_at} is ${wall} NY, expected 09:00`);
		}
		const utcHours = new Set(weeklyInstances.map((m) => new Date(m.scheduled_at).getUTCHours()));
		assert(
			utcHours.has(13) && utcHours.has(14),
			`expected both EDT(13:00Z) & EST(14:00Z) UTC hours, saw ${[...utcHours].join(",")}`,
		);
		return "summer=13:00Z / winter=14:00Z, both 09:00 NY ✓";
	});

	await step("Phase 3: recurring events show the ⟳ badge (Week view)", async () => {
		await goToDay(localDateOf(weekly.scheduled_at));
		await clickView("Week");
		const block = page.getByRole("button", { name: /\[QA\] Weekly Standup/ }).first();
		await block.waitFor({ timeout: 6000 });
		const hasBadge = (await block.locator("svg.lucide-repeat").count()) > 0;
		assert(hasBadge, "no lucide-repeat badge on the recurring event block");
	});

	await step("Phase 3: custom recurrence — every 2 weeks, ends after 5", async () => {
		await clickView("Week");
		await openCreate();
		await titleInput().fill(`${PREFIX} Biweekly Custom`);
		await setType("Status sync");
		await pickDate("July 16, 2026");
		await setTime("Start time", "10:00 AM");
		await setTime("End time", "10:30 AM");
		// open the custom builder
		await editor().getByRole("button", { name: "Does not repeat" }).click();
		await page
			.getByRole("dialog", { name: "Repeat options" })
			.getByRole("button", { name: /^Custom/ })
			.click();
		const dlg = page.locator("div.max-w-sm").filter({ hasText: "Custom recurrence" });
		await dlg.waitFor({ timeout: 5000 });
		await dlg.getByRole("spinbutton").first().fill("2"); // repeat every 2 (weeks)
		// "After" is a bare text node inside its label — select the 3rd radio
		// (Never / On / After) which enables the count field.
		await dlg.getByRole("radio").nth(2).click();
		await dlg.getByRole("spinbutton").nth(1).fill("5"); // 5 occurrences
		await shot("phase3-custom-builder");
		await dlg.getByRole("button", { name: "Done" }).click();
		const custom = await submitCreate();
		assert(custom?.series_id, "custom series create returned no series_id");
		const inst = (await listQA("scheduled")).filter((m) => m.series_id === custom.series_id);
		assert(inst.length === 5, `expected exactly 5 custom occurrences, got ${inst.length}`);
		return `${inst.length} occurrences`;
	});

	await step("Phase 3: scoped EDIT 'This event' detaches one occurrence", async () => {
		assert(weeklyInstances.length >= 3, "need ≥3 weekly instances for the scope test");
		// Click the 2nd July occurrence's chip directly (chips render in date
		// order: Jul 15=nth0, Jul 22=nth1, Jul 29=nth2).
		await goToMonth("July 2026");
		await monthChip(/\[QA\] Weekly Standup/).nth(1).click();
		await titleInput().waitFor({ timeout: 6000 });
		await titleInput().fill(`${PREFIX} Weekly EDITED`);
		await editor().getByRole("button", { name: "Save" }).click();
		await page.getByRole("heading", { name: "Edit recurring event" }).waitFor({ timeout: 5000 });
		await shot("phase3-scope-edit-dialog");
		const respP = page.waitForResponse(
			(r) => /\/api\/meetings\/.+\/details$/.test(r.url()) && r.request().method() === "PATCH",
			{ timeout: 20_000 },
		);
		await page.getByRole("button", { name: "This event" }).click();
		await respP;
		await titleInput().waitFor({ state: "hidden", timeout: 6000 }).catch(() => {});
		const after = (await listQA()).filter((m) => m.series_id === weekly.series_id);
		const edited = after.filter((m) => m.title === `${PREFIX} Weekly EDITED`);
		assert(
			edited.length === 1 && edited[0].is_exception === true,
			`expected exactly 1 detached exception, got ${edited.length} (is_exception=${edited[0]?.is_exception})`,
		);
		const untouched = after.filter(
			(m) => m.title === `${PREFIX} Weekly Standup` && m.status === "scheduled",
		);
		assert(untouched.length >= 3, `siblings changed unexpectedly (${untouched.length} left)`);
		return `1 detached, ${untouched.length} siblings intact`;
	});

	await step("Phase 3: scoped CANCEL 'This event' drops one, series continues", async () => {
		const beforeActive = (await listQA("scheduled")).filter(
			(m) => m.series_id === weekly.series_id,
		).length;
		// Cancel is only reachable via the agenda, which shows selectedDay. In
		// Month view, click the earliest still-"Standup" day CELL (top-left, on the
		// date number — not the chip) to set selectedDay → its agenda row appears.
		await goToMonth("July 2026");
		await monthCellWithChip(/\[QA\] Weekly Standup/)
			.first()
			.click({ position: { x: 8, y: 8 } });
		await agendaRow(`${PREFIX} Weekly Standup`).getByRole("button", { name: "Cancel" }).click();
		await page.getByRole("heading", { name: "Delete recurring event" }).waitFor({ timeout: 5000 });
		await shot("phase3-scope-cancel-dialog");
		const respP = page.waitForResponse(
			(r) => /\/api\/meetings\/.+\/cancel$/.test(r.url()) && r.request().method() === "POST",
			{ timeout: 20_000 },
		);
		await page.getByRole("button", { name: "This event" }).click();
		await respP;
		await page.waitForTimeout(800);
		const { body } = await api("GET", `/api/meetings/${weekly.id}`);
		assert(body?.data?.status === "cancelled", `Jul 15 instance not cancelled (${body?.data?.status})`);
		const afterActive = (await listQA("scheduled")).filter(
			(m) => m.series_id === weekly.series_id,
		).length;
		assert(afterActive === beforeActive - 1, `active count ${afterActive} != ${beforeActive - 1}`);
		return `active ${beforeActive} → ${afterActive}, series continues`;
	});
} catch (fatal) {
	console.error("FATAL:", fatal);
	results.push({ name: "run", ok: false, detail: String(fatal?.message || fatal).slice(0, 400) });
}

// ── cleanup ───────────────────────────────────────────────────────────────────
await step("Cleanup: cancel every [QA] meeting/series", async () => {
	const active = await listQA("scheduled");
	const seenSeries = new Set();
	let n = 0;
	for (const m of active) {
		if (m.series_id) {
			if (seenSeries.has(m.series_id)) continue;
			seenSeries.add(m.series_id);
			await api("POST", `/api/meetings/${m.id}/cancel`, { scope: "all" });
		} else {
			await api("POST", `/api/meetings/${m.id}/cancel`, {});
		}
		n += 1;
	}
	const leftover = await listQA("scheduled");
	assert(leftover.length === 0, `${leftover.length} active [QA] meeting(s) remain after cleanup`);
	return `cancelled ${n} meeting(s)/series; 0 active [QA] left`;
});

// ── report ────────────────────────────────────────────────────────────────────
await context.close(); // flush the .webm
await browser.close();

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
const webm = fs
	.readdirSync(VIDEO_DIR)
	.filter((f) => f.endsWith(".webm"))
	.map((f) => path.join(VIDEO_DIR, f))
	.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];

const lines = [
	"# Meetings QA — Phases 0–3",
	"",
	`**Result:** ${failed === 0 ? "✅ ALL PASS" : `❌ ${failed} FAILED`}  ·  ${passed}/${results.length} steps`,
	`**Backend:** ${BACKEND}  ·  **App:** ${APP}`,
	`**Video:** ${webm || "(none)"}  ·  **Screenshots:** ${OUT}`,
	"",
	"| # | Step | Result | Detail |",
	"| - | ---- | ------ | ------ |",
	...results.map((r, i) => `| ${i + 1} | ${r.name} | ${r.ok ? "✅" : "❌"} | ${r.detail.replace(/\|/g, "\\|")} |`),
	"",
];
fs.writeFileSync(path.join(OUT, "summary.md"), lines.join("\n"));

console.log(`\n${"═".repeat(60)}`);
console.log(`RESULT: ${passed}/${results.length} passed, ${failed} failed`);
console.log(`Summary: ${path.join(OUT, "summary.md")}`);
console.log(`Video:   ${webm || "(none)"}`);
console.log("═".repeat(60));
process.exitCode = failed === 0 ? 0 : 1;
