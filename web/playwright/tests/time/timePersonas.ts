import {
	type Browser,
	type BrowserContext,
	expect,
	type Locator,
	type Page,
} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Shared helpers for the time persona specs (W1-12).
 *
 * The specs read the manifest that `playwright/time/seed-time-personas.mjs` writes
 * (`playwright/.auth/time-seed.json`) and the sessions `playwright/time/personas.setup.ts`
 * saves (`playwright/.auth/time-<persona>.json`). They run only under
 * `playwright/time/playwright.config.ts`, which sets PROYEKTO_TIME_E2E=1; under the default
 * config (`npm run pw:test`) every describe block skips itself, so the suite never fails for
 * want of seeded data.
 *
 * Run from web/ (paths resolve against the working directory, like playwright/auth.setup.ts).
 *
 * The specs are skeletons for Phase C: every string they look for comes from ux.md (Copy,
 * Plan copy, the persona table) or a W1 component's data-testid. Phase C drives them
 * adaptively and tightens selectors against the built W2 pages; a line marked SELECTOR is a
 * best guess at a control that did not exist when this file was written.
 */

export const DEV_SUPABASE_HOST = "vyiedlwasdwmjbztqznl.supabase.co";
export const TIME_E2E_ENV = "PROYEKTO_TIME_E2E";
export const TIME_TIMEZONE = "Asia/Manila";

export type TimePersonaKey =
	| "solo"
	| "pro"
	| "biz"
	| "lead"
	| "member"
	| "member2"
	| "viewer"
	| "consultant"
	| "talent"
	| "client";

export interface TimeSeedPersona {
	key: TimePersonaKey;
	id: string;
	email: string;
	/** Removed by --teardown. */
	password?: string;
	displayName: string;
	firstName: string;
	group: string;
	login: boolean;
	role: string;
	storageState: string;
}

export interface TimeSeedSheet {
	id: string;
	alias: string | null;
	persona: TimePersonaKey;
	week: string;
	contextKind: "team" | "workspace" | "assignment";
	status: "open" | "submitted" | "returned" | "approved" | string;
	entryIds: string[];
}

export interface TimeSeedProject {
	id: string;
	title: string;
	workspace: string;
	owner: TimePersonaKey;
	roadmapId: string | null;
	tasks: { id: string; title: string }[];
}

export interface TimeSeedManifest {
	version: 1;
	kind: "proyekto-time-e2e-seed";
	runId: string;
	status: "seeding" | "seeded" | "failed" | "torn_down";
	createdAt: string;
	seededAt: string | null;
	supabaseHost: string;
	apiUrl: string;
	timezone: string;
	groups: string[];
	weeks: Record<string, string>;
	personas: Partial<Record<TimePersonaKey, TimeSeedPersona>>;
	workspaces: Record<
		string,
		{ id: string; slug: string; name: string; plan: string; owner: string }
	>;
	teams: Record<
		string,
		{ id: string; name: string; workspace: string; owner: string }
	>;
	projects: Record<string, TimeSeedProject>;
	engagements: { client?: string; talent?: string };
	assignments: Record<string, string>;
	sheets: Record<string, TimeSeedSheet>;
	entries: Partial<Record<TimePersonaKey, string[]>>;
}

function webDir(): string {
	return process.env.TIME_E2E_WEB_DIR ?? process.cwd();
}

export function timeSeedPath(): string {
	return path.resolve(
		process.env.TIME_SEED_MANIFEST ??
			path.join(webDir(), "playwright", ".auth", "time-seed.json"),
	);
}

export function personaStatePath(key: TimePersonaKey): string {
	return path.join(webDir(), "playwright", ".auth", `time-${key}.json`);
}

let cached: TimeSeedManifest | null | undefined;

export function loadTimeSeed(): TimeSeedManifest | null {
	if (cached !== undefined) return cached;
	try {
		cached = JSON.parse(
			fs.readFileSync(timeSeedPath(), "utf8"),
		) as TimeSeedManifest;
	} catch {
		cached = null;
	}
	return cached;
}

/** True only under the time config, with a seeded run on the dev project. */
export const timeE2EEnabled =
	process.env[TIME_E2E_ENV] === "1" &&
	loadTimeSeed()?.status === "seeded" &&
	loadTimeSeed()?.supabaseHost === DEV_SUPABASE_HOST;

export const TIME_E2E_SKIP_REASON =
	"Time persona specs run only under playwright/time/playwright.config.ts, after node playwright/time/seed-time-personas.mjs.";

export function seed(): TimeSeedManifest {
	const manifest = loadTimeSeed();
	if (!manifest) {
		throw new Error(
			`No time seed manifest at ${timeSeedPath()}. Run node playwright/time/seed-time-personas.mjs first.`,
		);
	}
	return manifest;
}

export function hasPersona(key: TimePersonaKey): boolean {
	return Boolean(loadTimeSeed()?.personas[key]);
}

/** Skip a describe block unless the run is live and seeded the personas it needs. */
export function shouldSkip(...keys: TimePersonaKey[]): boolean {
	return !timeE2EEnabled || keys.some((key) => !hasPersona(key));
}

export function persona(key: TimePersonaKey): TimeSeedPersona {
	const found = seed().personas[key];
	if (!found) {
		throw new Error(`Persona ${key} was not seeded (see --only).`);
	}
	return found;
}

/**
 * For `test.use({ storageState })`. Outside a live run it returns an empty state, so the
 * skipped blocks never try to open a session file that does not exist.
 */
export function personaState(
	key: TimePersonaKey,
): string | { cookies: []; origins: [] } {
	return timeE2EEnabled
		? personaStatePath(key)
		: { cookies: [], origins: [] };
}

export function project(key: string): TimeSeedProject {
	const found = seed().projects[key];
	if (!found) throw new Error(`Project ${key} was not seeded.`);
	return found;
}

export function team(key: string): { id: string; name: string } {
	const found = seed().teams[key];
	if (!found) throw new Error(`Team ${key} was not seeded.`);
	return found;
}

export function workspace(key: string): { id: string; slug: string; name: string } {
	const found = seed().workspaces[key];
	if (!found) throw new Error(`Workspace ${key} was not seeded.`);
	return found;
}

/** A seeded timesheet by its alias (see buildPlan in the seed script). */
export function sheet(alias: string): TimeSeedSheet {
	const found = findSheet(alias);
	if (!found) throw new Error(`No seeded timesheet with alias ${alias}.`);
	return found;
}

export function findSheet(alias: string): TimeSeedSheet | null {
	return Object.values(seed().sheets).find((s) => s.alias === alias) ?? null;
}

/** The Monday (YYYY-MM-DD) of a seeded sheet's week, for `/time?week=`. */
export function sheetWeek(alias: string): string {
	const week = seed().weeks[sheet(alias).week];
	if (!week) throw new Error(`The manifest has no date for week ${sheet(alias).week}.`);
	return week;
}

/** Ticks every acknowledgement in SubmitSheetDialog (W1-4) so Submit can continue. */
export async function tickAcknowledgements(dialog: Locator): Promise<void> {
	// The checks render only once the sheet detail has loaded (the day list and its total), and the
	// over-limit ones once the policy read answers; ticking earlier misses boxes that appear later.
	await expect(dialog.getByTestId("submit-total")).toBeVisible();
	await expect(dialog.getByTestId("submit-limits-pending")).toHaveCount(0);
	const boxes = dialog.getByTestId("submit-warnings").getByRole("checkbox");
	for (const box of await boxes.all()) await box.check();
}

/**
 * Picks a task in W1-2's TaskPickerModal: four columns (Project, Epic, Feature, Task) of
 * aria-pressed buttons. "Start timer" (the start flow) starts from its footer button
 * ("Start timer" / "Start for <X>"); "Choose a task" (quick add, select mode) confirms with "Choose".
 * The search box narrows the tree to the task, so its epic and feature open on their own.
 */
export async function pickTask(
	page: Page,
	opts: {
		title: "Start timer" | "Choose a task";
		task: string;
		project?: string;
	},
): Promise<Locator> {
	const picker = page.getByRole("dialog", { name: opts.title });
	await expect(picker).toBeVisible();
	if (opts.project) {
		const row = picker
			.getByRole("region", { name: "Project" })
			.getByRole("button", { name: opts.project });
		await expect(row).toBeVisible();
		if ((await row.getAttribute("aria-pressed")) !== "true") await row.click();
	}
	await picker.getByRole("searchbox", { name: "Find a task" }).fill(opts.task);
	const task = picker
		.getByRole("region", { name: "Task" })
		.getByRole("button", { name: opts.task, exact: true });
	await task.click();
	await expect(task).toHaveAttribute("aria-pressed", "true");
	return picker;
}

/** Start timer → pick the task → the footer's start button (one option: no For step). */
export async function startTimerOn(
	page: Page,
	opts: { task: string; project?: string },
): Promise<void> {
	await page.getByRole("button", { name: "Start timer" }).first().click();
	const picker = await pickTask(page, { title: "Start timer", ...opts });
	await picker.getByRole("button", { name: /^Start\b/ }).click();
	await expect(picker).toHaveCount(0);
	await expect(page.getByTestId("timer-clock").first()).toBeVisible();
}

/**
 * Clicks a timer's Stop (in `scope`, default the page) and waits for the server's
 * answer. The clock leaves the screen optimistically, before the request goes out,
 * so a test that ends on the clock alone can close its page first and leave the
 * timer running for the next spec and the next run.
 */
export async function stopTimer(page: Page, scope: Page | Locator = page): Promise<void> {
	const stopped = page.waitForResponse(
		(res) =>
			res.request().method() === "POST" &&
			/\/api\/time\/entries\/[^/]+\/stop$/.test(new URL(res.url()).pathname),
	);
	await scope.getByRole("button", { name: /^Stop\b/ }).first().click();
	expect((await stopped).ok()).toBe(true);
	await expect(page.getByTestId("timer-clock")).toHaveCount(0);
}

/** ux.md › For chip: labels are cut at 22 characters + "…". */
export function chipLabel(label: string): string {
	return label.length > 22 ? `${label.slice(0, 22)}…` : label;
}

/** A page signed in as another persona, for flows that hand over between two people. */
export async function personaPage(
	browser: Browser,
	key: TimePersonaKey,
	baseURL: string | undefined,
): Promise<{ context: BrowserContext; page: Page }> {
	const context = await browser.newContext({
		baseURL,
		storageState: personaStatePath(key),
		timezoneId: TIME_TIMEZONE,
		locale: "en-US",
	});
	await hideDevOverlays(context);
	return { context, page: await context.newPage() };
}

/**
 * The Vite dev server mounts the TanStack Devtools trigger bottom-right (`routes/__root.tsx`,
 * `import.meta.env.DEV` only). At 390 px it sits on the Time page's FAB and intercepts its taps;
 * production has no such button, so the harness hides it.
 */
export async function hideDevOverlays(target: Page | BrowserContext): Promise<void> {
	await target.addInitScript(() => {
		const add = () => {
			const style = document.createElement("style");
			style.textContent =
				'button[aria-label="Open TanStack Devtools"] { display: none !important; }';
			(document.head ?? document.documentElement).appendChild(style);
		};
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", add, { once: true });
		} else {
			add();
		}
	});
}

/** Opens /time and waits for the page shell. */
export async function gotoTime(page: Page, search = ""): Promise<void> {
	await page.goto(`/time${search}`);
	// SELECTOR: W2-1's TimePageHeader title.
	await expect(
		page.getByRole("heading", { name: "Time", exact: true }),
	).toBeVisible();
}

/** ux.md › Mobile: no horizontal page scroll. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth,
	);
	expect(overflow).toBeLessThanOrEqual(1);
}

/** Native and client-safe surfaces never show an amount ("PHP 6,885.00"). */
export const AMOUNT_PATTERN = /\b[A-Z]{3} \d{1,3}(,\d{3})*\.\d{2}\b/;

/** The sidebar's Time item (executionNavigation.ts). */
export function sidebarTimeLink(page: Page) {
	return page
		.getByRole("navigation")
		.getByRole("link", { name: /^Time\b/ });
}
