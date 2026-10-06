#!/usr/bin/env node
/**
 * Time-management E2E personas on the DEV database (W1-12, Phase C).
 *
 *   node playwright/time/seed-time-personas.mjs              seed one run
 *   node playwright/time/seed-time-personas.mjs --dry-run    print the plan and the target checks; no network
 *   node playwright/time/seed-time-personas.mjs --teardown   remove the run named by the manifest
 *   node playwright/time/seed-time-personas.mjs --self-test  offline checks of the guard, the dates and the plan
 *   node playwright/time/seed-time-personas.mjs --help
 *
 * Run from web/. It seeds the Phase C personas as `time-<persona>+<run>@proyekto-itest.invalid` users with
 * passwords (the persona setup logs in through the form), their workspaces and plan comps, two teams, six
 * "[QA] …" projects with roadmaps and tasks, a signed client agreement and talent agreement, one talent
 * assignment, and four weeks of time entries (Asia/Manila weeks starting Monday). Some timesheets are
 * submitted, approved or left waiting through the running backend, so every persona has something to act on.
 *
 * DEV ONLY. Every command except --help and --self-test refuses unless:
 *   - SUPABASE_URL's host is exactly vyiedlwasdwmjbztqznl.supabase.co (https), and a JWT-shaped service-role
 *     or anon key names that same project;
 *   - (seed) web/.env.development.local's VITE_SUPABASE_URL is that host too, since the personas log in
 *     through that web;
 *   - (seed) the backend API is on localhost (default http://localhost:8011, the Phase C PR-1 backend), and it
 *     accepts a dev session before anything else is written.
 *
 * Inputs (the environment wins over the files):
 *   --backend-env=<file>  or TIME_SEED_BACKEND_ENV   default <repo>/backend/.env.development.local
 *                         (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY)
 *   --web-env=<file>      or TIME_SEED_WEB_ENV       default web/.env.development.local (VITE_SUPABASE_URL)
 *   --api=<origin>        or TIME_SEED_API_URL       default http://localhost:8011 (no /api suffix)
 *   --manifest=<file>     or TIME_SEED_MANIFEST      default web/playwright/.auth/time-seed.json
 *   --only=<groups>       solo,pro,team,agreement (default: all four)
 *   --replace             tear down the manifest's run first, then seed
 *   --keep-on-failure     leave a failed run in place (default: tear it down)
 *   --orphans             with --teardown: also find time-*@proyekto-itest.invalid users the manifest lost
 *
 * The manifest holds the persona passwords. It lives in playwright/.auth/ (gitignored); never print or commit
 * it. Teardown calls time_test_cleanup per project (it refuses anything not titled "[QA] …"), deletes the
 * tracked rows newest first, cancels the two engagements, revokes the consultant enrolment, and deletes the
 * users. The engagement graph is append-only by design (engagement-assignments.integration-spec.ts), so the
 * signed contracts, the cancelled engagements and the three party profiles stay; those users are banned.
 */
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ─── constants ───────────────────────────────────────────────────────────────

export const DEV_REF = "vyiedlwasdwmjbztqznl";
export const DEV_HOST = `${DEV_REF}.supabase.co`;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(HERE, "..", "..");
const REPO_DIR = path.resolve(WEB_DIR, "..");
const AUTH_DIR = path.join(WEB_DIR, "playwright", ".auth");
export const DEFAULT_MANIFEST = path.join(AUTH_DIR, "time-seed.json");
const DEFAULT_API = "http://localhost:8011";

export const EMAIL_DOMAIN = "proyekto-itest.invalid";
export const PERSONA_EMAIL_RE = /^time-([a-z0-9]+)\+([0-9a-f]{8})@proyekto-itest\.invalid$/;
export const TIMEZONE = "Asia/Manila";
/** Asia/Manila is UTC+8 all year (no DST), so wall-clock maths needs no tz database. */
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const GROUPS = ["solo", "pro", "team", "agreement"];
/** Seeded names show in the UI, so they must not trip the native copy rules (ux.md › Mobile). */
const BANNED_WORDS = /\b(contracts?|rates?|payouts?|invoices?)\b/i;
const DASHBOARD_TOUR_KEY = "dashboard_v1";
const BAN_DURATION = "876000h";

class UsageError extends Error {}

// ─── arguments and environment ───────────────────────────────────────────────

export function parseArgs(argv) {
	const out = {
		dryRun: false,
		teardown: false,
		orphans: false,
		replace: false,
		keepOnFailure: false,
		selfTest: false,
		help: false,
		only: null,
		backendEnv: null,
		webEnv: null,
		api: null,
		manifest: null,
	};
	const valued = { "--only": "only", "--backend-env": "backendEnv", "--web-env": "webEnv", "--api": "api", "--manifest": "manifest" };
	const flags = {
		"--dry-run": "dryRun",
		"--teardown": "teardown",
		"--orphans": "orphans",
		"--replace": "replace",
		"--keep-on-failure": "keepOnFailure",
		"--self-test": "selfTest",
		"--help": "help",
		"-h": "help",
	};
	for (const raw of argv) {
		const eq = raw.indexOf("=");
		const flag = eq === -1 ? raw : raw.slice(0, eq);
		const value = eq === -1 ? null : raw.slice(eq + 1);
		if (Object.hasOwn(flags, flag) && value === null) {
			out[flags[flag]] = true;
		} else if (Object.hasOwn(valued, flag)) {
			if (!value) throw new UsageError(`${flag} needs a value (${flag}=…)`);
			out[valued[flag]] = value;
		} else {
			throw new UsageError(`Unknown option: ${raw}`);
		}
	}
	if (out.only !== null) {
		const groups = out.only.split(",").map((g) => g.trim()).filter(Boolean);
		for (const group of groups) {
			if (!GROUPS.includes(group)) throw new UsageError(`--only: unknown group "${group}" (use ${GROUPS.join(", ")})`);
		}
		if (groups.length === 0) throw new UsageError("--only needs at least one group");
		out.only = groups;
	}
	if (out.orphans && !out.teardown) throw new UsageError("--orphans only applies to --teardown");
	return out;
}

/** KEY=VALUE lines; quotes stripped the way dotenv does; comments and `export ` prefixes ignored. */
export function readEnvFile(file) {
	if (!file || !fs.existsSync(file)) return { found: false, values: {} };
	const values = {};
	for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const body = line.startsWith("export ") ? line.slice(7) : line;
		const eq = body.indexOf("=");
		if (eq <= 0) continue;
		const key = body.slice(0, eq).trim();
		let value = body.slice(eq + 1).trim();
		if (value.length >= 2 && /^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);
		values[key] = value;
	}
	return { found: true, values };
}

export function resolveConfig(args, env = process.env) {
	const backendFile = path.resolve(args.backendEnv ?? env.TIME_SEED_BACKEND_ENV ?? path.join(REPO_DIR, "backend", ".env.development.local"));
	const webFile = path.resolve(args.webEnv ?? env.TIME_SEED_WEB_ENV ?? path.join(WEB_DIR, ".env.development.local"));
	const backend = readEnvFile(backendFile);
	const web = readEnvFile(webFile);
	const sources = {};
	const pick = (key, file, label) => {
		if (env[key]) {
			sources[key] = "the environment";
			return env[key];
		}
		if (file.values[key]) {
			sources[key] = label;
			return file.values[key];
		}
		return "";
	};
	const serviceRoleKey = pick("SUPABASE_SERVICE_ROLE_KEY", backend, backendFile);
	const anonKey = pick("SUPABASE_ANON_KEY", backend, backendFile) || pick("VITE_SUPABASE_ANON_KEY", web, webFile);
	return {
		backendFile,
		backendFileFound: backend.found,
		webFile,
		webFileFound: web.found,
		supabaseUrl: pick("SUPABASE_URL", backend, backendFile).replace(/\/+$/, ""),
		serviceRoleKey,
		anonKey,
		webSupabaseUrl: pick("VITE_SUPABASE_URL", web, webFile).replace(/\/+$/, ""),
		apiUrl: normaliseApi(args.api ?? env.TIME_SEED_API_URL ?? DEFAULT_API),
		manifestPath: path.resolve(args.manifest ?? env.TIME_SEED_MANIFEST ?? DEFAULT_MANIFEST),
		sources,
	};
}

/** Callers append /api/…, so an origin with a trailing /api would double it. */
function normaliseApi(url) {
	return String(url).replace(/\/+$/, "").replace(/\/api$/, "");
}

// ─── the dev-only guard ──────────────────────────────────────────────────────

/** The URL's host, "" when it does not parse (so the guard refuses it). */
export function hostOf(url) {
	try {
		return new URL(url).hostname;
	} catch {
		return "";
	}
}

/** A JWT's payload claims, or null for anything that is not a three-part JWT. Never verified, only read. */
export function jwtPayload(token) {
	if (typeof token !== "string") return null;
	const parts = token.split(".");
	if (parts.length !== 3) return null;
	try {
		const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
		return claims && typeof claims === "object" ? claims : null;
	} catch {
		return null;
	}
}

function checkKey(label, value, expectedRole, problems, facts) {
	if (!value) {
		problems.push(`${label} is not set`);
		return;
	}
	const claims = jwtPayload(value);
	if (!claims) {
		facts.push(`${label}: set (not a JWT, so only the URL host is checked)`);
		return;
	}
	if (claims.ref && claims.ref !== DEV_REF) {
		problems.push(`${label} belongs to project ${claims.ref}, not the dev project ${DEV_REF}`);
	} else if (claims.role && claims.role !== expectedRole) {
		problems.push(`${label} has role ${claims.role}; expected ${expectedRole}`);
	} else {
		facts.push(`${label}: set (project ${claims.ref ?? "unknown"}, role ${claims.role ?? "unknown"})`);
	}
}

/**
 * Refuses every target that is not the dev project and a local backend. Pure: it reads the resolved config only,
 * so --self-test and --dry-run can run it without the network. Prints hosts and project refs, never key values.
 */
export function checkTargets(cfg, { needApi = true, needWeb = true, needAnon = true } = {}) {
	const problems = [];
	const facts = [];
	const from = (key) => (cfg.sources?.[key] ? ` (from ${cfg.sources[key]})` : "");

	if (!cfg.supabaseUrl) {
		problems.push(`SUPABASE_URL is not set (looked in the environment and ${cfg.backendFile ?? "the backend env file"})`);
	} else {
		const host = hostOf(cfg.supabaseUrl);
		if (host !== DEV_HOST) {
			problems.push(`SUPABASE_URL points at ${host || "an unparseable URL"}${from("SUPABASE_URL")}, not the dev project ${DEV_HOST}`);
		} else if (!cfg.supabaseUrl.startsWith("https://")) {
			problems.push("SUPABASE_URL must use https");
		} else {
			facts.push(`Supabase: ${host} (dev)${from("SUPABASE_URL")}`);
		}
	}

	checkKey("SUPABASE_SERVICE_ROLE_KEY", cfg.serviceRoleKey, "service_role", problems, facts);
	if (needAnon) checkKey("Supabase anon key", cfg.anonKey, "anon", problems, facts);

	if (needWeb) {
		const webHost = hostOf(cfg.webSupabaseUrl);
		if (!cfg.webSupabaseUrl) {
			problems.push(`VITE_SUPABASE_URL is not set (looked in the environment and ${cfg.webFile ?? "the web env file"}); the personas log in through that web`);
		} else if (webHost !== DEV_HOST) {
			problems.push(`The web's VITE_SUPABASE_URL points at ${webHost || "an unparseable URL"}${from("VITE_SUPABASE_URL")}, not ${DEV_HOST}; the personas could not log in`);
		} else {
			facts.push(`Web Supabase: ${webHost} (dev)`);
		}
	}

	if (needApi) {
		let api = null;
		try {
			api = new URL(cfg.apiUrl);
		} catch {
			api = null;
		}
		if (!api || !/^https?:$/.test(api.protocol)) {
			problems.push(`API URL "${cfg.apiUrl}" is not an http(s) URL`);
		} else if (!LOCAL_HOSTS.has(api.hostname)) {
			problems.push(`API URL host ${api.hostname} is not localhost; the seed only talks to a local backend`);
		} else if (api.pathname !== "/" || api.search || api.hash) {
			problems.push(`API URL "${cfg.apiUrl}" must be an origin only (callers append /api/…)`);
		} else {
			facts.push(`API: ${api.origin} (local)`);
		}
	}

	return { ok: problems.length === 0, problems, facts };
}

function printGuard(guard, heading) {
	console.log(heading);
	for (const fact of guard.facts) console.log(`  ok   ${fact}`);
	for (const problem of guard.problems) console.log(`  REFUSE ${problem}`);
}

// ─── dates (Asia/Manila, weeks start Monday) ─────────────────────────────────

/** The Asia/Manila calendar date of an instant, YYYY-MM-DD. */
export function localDate(instantMs) {
	return new Date(instantMs + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(dateStr, days) {
	return new Date(Date.parse(`${dateStr}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The Monday (Asia/Manila) of the week holding the instant, shifted by whole weeks. */
export function weekStart(instantMs, offsetWeeks = 0) {
	const local = new Date(instantMs + TZ_OFFSET_MS);
	const sinceMonday = (local.getUTCDay() + 6) % 7;
	return addDays(local.toISOString().slice(0, 10), -sinceMonday + 7 * offsetWeeks);
}

/** A wall-clock time on an Asia/Manila date, as a UTC ISO instant. */
export function localToIso(dateStr, hour, minute) {
	return new Date(Date.parse(`${dateStr}T00:00:00.000Z`) + (hour * 60 + minute) * 60_000 - TZ_OFFSET_MS).toISOString();
}

// ─── the plan (pure, so dry-run and self-test can print and check it) ────────

const PERSONAS = [
	{ key: "solo", group: "solo", first: "Sol", last: "Reyes", login: true, role: "Solo Free owner (P1)" },
	{ key: "pro", group: "pro", first: "Pia", last: "Navarro", login: true, role: "Small Pro owner who logs (P2)" },
	{ key: "biz", group: "team", first: "Bea", last: "Mendoza", login: true, role: "Business workspace owner who never logs (P7)" },
	{ key: "lead", group: "team", first: "Lito", last: "Garcia", login: true, role: "Team lead, Business team override (P4)" },
	{ key: "member", group: "team", first: "Mia", last: "Santos", login: true, role: "Team member who logs (P3)" },
	{ key: "member2", group: "team", first: "Nico", last: "Bautista", login: false, role: "Second team member (fixture data only)" },
	{ key: "viewer", group: "team", first: "Vince", last: "Tan", login: true, role: "Internal viewer on the team project (P10)" },
	{ key: "consultant", group: "agreement", first: "Cora", last: "Villanueva", login: true, role: "Consultant who approves talent (P5)" },
	{ key: "talent", group: "agreement", first: "Theo", last: "Ramos", login: true, role: "Talent on an agreement (P6)" },
	{ key: "client", group: "agreement", first: "Cleo", last: "Aquino", login: true, role: "Client party (P8)" },
];

export function personaEmail(key, runId) {
	return `time-${key}+${runId}@${EMAIL_DOMAIN}`;
}

export function sheetKeyOf(entry) {
	return entry.context.kind === "personal" ? null : `${entry.persona}:${entry.week}:${entry.context.kind}:${entry.context.ref}`;
}

/**
 * Everything the seed writes, keyed by plan keys (the executor maps them to ids). Deterministic for a run id and
 * an instant. Entries land only on days before today (Asia/Manila), so none is in the future.
 */
export function buildPlan({ runId, nowMs, groups = GROUPS }) {
	const on = (group) => groups.includes(group);
	const R = runId;
	const today = localDate(nowMs);
	const weeks = {};
	for (const offset of [0, -1, -2, -3, -4]) weeks[`w${offset}`] = weekStart(nowMs, offset);
	const notes = [];

	const personas = PERSONAS.filter((p) => on(p.group)).map((p) => ({
		...p,
		displayName: `${p.first} ${p.last}`,
		email: personaEmail(p.key, R),
	}));
	const has = (key) => personas.some((p) => p.key === key);

	// Every persona owns a workspace, as every real account does ("every user lands in the workspace").
	const workspaces = [];
	const workspace = (key, owner, name, plan, members = []) =>
		workspaces.push({ key, owner, name, slug: `qa-time-${key}-${R}`.toLowerCase(), plan, members });
	if (on("solo")) workspace("solo", "solo", `QA Solo ${R}`, "free");
	if (on("pro")) workspace("pro", "pro", `QA Pro Studio ${R}`, "pro");
	if (on("team")) {
		for (const key of ["lead", "member", "member2", "viewer"]) {
			const p = personas.find((x) => x.key === key);
			workspace(`home-${key}`, key, `${p.first}'s workspace ${R}`, "free");
		}
		workspace("business", "biz", `QA Business ${R}`, "business", [
			{ persona: "lead", role: "member" },
			{ persona: "member", role: "member" },
			{ persona: "member2", role: "member" },
			{ persona: "viewer", role: "member" },
		]);
	}
	if (on("agreement")) {
		workspace("consulting", "consultant", `QA Consulting ${R}`, "pro");
		for (const key of ["talent", "client"]) {
			const p = personas.find((x) => x.key === key);
			workspace(`home-${key}`, key, `${p.first}'s workspace ${R}`, "free");
		}
	}

	const teams = [];
	if (on("team")) {
		teams.push({
			key: "delivery",
			owner: "lead",
			workspace: "business",
			name: `QA Delivery Team ${R}`,
			timeTracking: true,
			members: [
				{ persona: "member", role: "member" },
				{ persona: "member2", role: "member" },
			],
			// The Business override routes team sheets to the team's owners and admins (ux.md P4).
			policy: { approver_scope: "team" },
		});
	}
	if (on("agreement")) {
		teams.push({ key: "studio", owner: "consultant", workspace: "consulting", name: `QA Studio Team ${R}`, timeTracking: null, members: [], policy: null });
	}

	const projects = [];
	const project = (spec) => projects.push({ primaryTeam: null, teams: [], link: null, ...spec });
	if (on("solo")) {
		project({
			key: "solo",
			title: `[QA] Solo Side Project ${R}`,
			owner: "solo",
			workspace: "solo",
			access: [{ persona: "solo", role: "owner" }],
			tasks: [
				{ title: "Landing page copy", assignees: ["solo"] },
				{ title: "Fix login bug", assignees: ["solo"] },
				{ title: "Newsletter signup", assignees: ["solo"] },
			],
		});
	}
	if (on("pro")) {
		project({
			key: "pro",
			title: `[QA] Client Portal ${R}`,
			owner: "pro",
			workspace: "pro",
			access: [{ persona: "pro", role: "owner" }],
			tasks: [
				{ title: "Onboarding flow", assignees: ["pro"] },
				{ title: "Fix login bug", assignees: ["pro"] },
				{ title: "Weekly report export", assignees: ["pro"] },
			],
		});
	}
	if (on("team")) {
		project({
			key: "web",
			title: `[QA] Acme Website ${R}`,
			owner: "lead",
			workspace: "business",
			primaryTeam: "delivery",
			access: [
				{ persona: "lead", role: "owner" },
				{ persona: "member", role: "editor" },
				{ persona: "member2", role: "editor" },
				{ persona: "viewer", role: "viewer" },
			],
			teams: [{ team: "delivery", primary: true, curated: ["lead", "member", "member2"] }],
			tasks: [
				{ title: "Homepage layout", assignees: ["member"] },
				{ title: "Fix login bug", assignees: ["member", "member2"] },
				{ title: "Checkout API", assignees: ["member2"] },
				{ title: "QA pass", assignees: ["lead"] },
			],
		});
		// The lead cannot open this one, so their review grid merges its hours into "Projects you can't open" (L21).
		project({
			key: "ops",
			title: `[QA] Internal Ops ${R}`,
			owner: "biz",
			workspace: "business",
			access: [
				{ persona: "biz", role: "owner" },
				{ persona: "member", role: "editor" },
			],
			teams: [{ team: "delivery", primary: false, curated: ["member"] }],
			tasks: [
				{ title: "Hiring pipeline", assignees: ["member"] },
				{ title: "Office setup", assignees: [] },
			],
		});
	}
	if (on("agreement")) {
		// Linked to the client agreement (setUp attaches the studio team); the talent is placed here up front.
		project({
			key: "rebrand",
			title: `[QA] Acme Corp Rebrand ${R}`,
			owner: "consultant",
			workspace: "consulting",
			access: [
				{ persona: "consultant", role: "owner" },
				// setUp never grants the client access (engagement-project.service.ts), so the seed does.
				{ persona: "client", role: "viewer" },
			],
			link: "client",
			tasks: [
				{ title: "Brand guidelines", assignees: [] },
				{ title: "Logo concepts", assignees: [] },
				{ title: "Social templates", assignees: [] },
			],
		});
		// Left unassigned for the W1-13 "Assign to project" flow.
		project({
			key: "mobile",
			title: `[QA] Acme Corp Mobile App ${R}`,
			owner: "consultant",
			workspace: "consulting",
			access: [{ persona: "consultant", role: "owner" }],
			tasks: [
				{ title: "Wireframes", assignees: [] },
				{ title: "Design system", assignees: [] },
			],
		});
	}

	const agreementStart = addDays(today, -60);
	const contracts = [];
	const assignments = [];
	if (on("agreement")) {
		contracts.push(
			{
				key: "client",
				kind: "client_services",
				hirer: "client",
				hirerCapacity: "client",
				provider: "consultant",
				providerCapacity: "consultant",
				hirerTeam: null,
				providerTeam: "studio",
				hourlyRate: 120,
				approvalMode: "none",
				clientHoursLevel: "summary",
			},
			{
				key: "talent",
				kind: "talent_services",
				hirer: "consultant",
				hirerCapacity: "consultant",
				provider: "talent",
				providerCapacity: "talent",
				hirerTeam: "studio",
				providerTeam: null,
				hourlyRate: 40,
				approvalMode: "provider_submit_hirer_approve",
				// Talent agreements never show the hirer's client hours (TALENT_TIME_POLICY_INVALID).
				clientHoursLevel: "none",
			},
		);
		// Backdated so the talent's past weeks fall inside it (an entry never starts before its assignment).
		assignments.push({
			key: "talentRebrand",
			engagement: "talent",
			project: "rebrand",
			roleTitle: "Designer",
			startedAt: localToIso(addDays(today, -40), 9, 0),
		});
	}

	// ── entries ──
	const entries = [];
	const add = (persona, projectKey, context, week, day, hour, minute, minutes, extra = {}) => {
		const date = addDays(weeks[week], day);
		const start = localToIso(date, hour, minute);
		entries.push({
			persona,
			project: projectKey,
			context,
			week,
			date,
			start,
			end: new Date(Date.parse(start) + minutes * 60_000).toISOString(),
			minutes,
			task: extra.task ?? null,
			workItem: extra.workItem ?? null,
			note: extra.note ?? null,
		});
	};
	const pastDays = (week, days) => days.filter((day) => addDays(weeks[week], day) < today);
	const weekdays = [0, 1, 2, 3, 4];
	const personal = { kind: "personal", ref: null };
	const proWorkspace = { kind: "workspace", ref: "pro" };
	const delivery = { kind: "team", ref: "delivery" };
	const placed = { kind: "assignment", ref: "talentRebrand" };

	if (on("solo")) {
		add("solo", "solo", personal, "w-1", 0, 9, 0, 120, { task: 0, note: "Hero section and intro copy" });
		add("solo", "solo", personal, "w-1", 1, 13, 0, 90, { task: 1 });
		add("solo", "solo", personal, "w-1", 3, 10, 0, 45, { workItem: "admin" });
		for (const day of pastDays("w0", weekdays)) add("solo", "solo", personal, "w0", day, 9, 30, 60, { task: day % 3 });
	}
	if (on("pro")) {
		for (const day of [0, 1, 2, 3]) {
			add("pro", "pro", proWorkspace, "w-1", day, 9, 0, 180, { task: day % 3 });
			add("pro", "pro", proWorkspace, "w-1", day, 13, 0, 150, { task: (day + 1) % 3 });
		}
		for (const day of pastDays("w0", weekdays)) add("pro", "pro", proWorkspace, "w0", day, 9, 0, 180, { task: day % 3 });
	}
	if (on("team")) {
		for (const day of weekdays) {
			add("member", "web", delivery, "w-4", day, 9, 0, 240, { task: 0 });
			add("member", "web", delivery, "w-4", day, 13, 0, 240, { task: 1 });
			add("member", "web", delivery, "w-3", day, 9, 0, 240, { task: day % 4 });
			add("member", "web", delivery, "w-3", day, 13, 0, 240, { task: (day + 1) % 4 });
			add("member", "web", delivery, "w-2", day, 9, 0, 240, { task: day % 2 });
			add("member", "ops", delivery, "w-2", day, 14, 0, 210, { task: 0, note: "Interview loop" });
		}
		for (const day of [0, 1, 2, 3]) {
			add("member", "web", delivery, "w-1", day, 9, 0, 240, { task: 0 });
			add("member", "web", delivery, "w-1", day, 13, 30, 180, { task: 1 });
		}
		for (const day of pastDays("w0", weekdays)) add("member", "web", delivery, "w0", day, 9, 0, 180, { task: day % 2 });

		// 10h 30m: "Needs review", so this sheet cannot be bulk approved ("Has flags. Open it to review.").
		add("member2", "web", delivery, "w-1", 0, 8, 0, 630, { task: 2, note: "Launch-day firefighting" });
		add("member2", "web", delivery, "w-1", 1, 9, 0, 360, { task: 2 });
		add("member2", "web", delivery, "w-1", 2, 9, 0, 360, { task: 1 });

		// The lead logs a little, so they get the normal page with the Waiting pill, not approver mode (L36).
		add("lead", "web", delivery, "w-1", 1, 10, 0, 120, { workItem: "review" });
		add("lead", "web", delivery, "w-1", 3, 15, 0, 60, { workItem: "meeting" });
		for (const day of pastDays("w0", weekdays)) add("lead", "web", delivery, "w0", day, 14, 0, 60, { workItem: "meeting" });
	}
	if (on("agreement")) {
		for (const day of [0, 1, 2]) {
			add("talent", "rebrand", placed, "w-2", day, 9, 0, 360, { task: day % 3 });
			add("talent", "rebrand", placed, "w-1", day, 9, 0, 300, { task: day % 3 });
		}
		// The consultant logs nothing, so they land in approver mode (P5).
	}

	const safeEnd = nowMs - 5 * 60_000;
	const kept = entries.filter((entry) => Date.parse(entry.end) <= safeEnd);
	if (kept.length !== entries.length) notes.push(`${entries.length - kept.length} entries would end in the future and were dropped`);
	if (pastDays("w0", [0]).length === 0) notes.push("Today is Monday in Asia/Manila, so the current week has no seeded entries (add some in the UI if a flow needs them).");

	// ── sheet actions through the backend ──
	const submissions = [];
	const approvals = [];
	const aliases = {};
	const alias = (sheet, name) => {
		aliases[sheet] = name;
	};
	if (on("pro")) {
		alias("pro:w-1:workspace:pro", "proLastWeek");
		alias("pro:w0:workspace:pro", "proThisWeek");
	}
	if (on("team")) {
		submissions.push(
			{ sheet: "member:w-4:team:delivery", by: "member" },
			{ sheet: "member:w-3:team:delivery", by: "member" },
			{ sheet: "member:w-2:team:delivery", by: "member" },
			{ sheet: "member2:w-1:team:delivery", by: "member2" },
		);
		approvals.push({ sheet: "member:w-4:team:delivery", by: "lead" });
		alias("member:w-4:team:delivery", "memberApproved");
		alias("member:w-3:team:delivery", "memberWaiting");
		alias("member:w-2:team:delivery", "memberWaitingRedacted");
		alias("member:w-1:team:delivery", "memberLastWeek");
		alias("member:w0:team:delivery", "memberThisWeek");
		alias("member2:w-1:team:delivery", "member2Flagged");
		alias("lead:w-1:team:delivery", "leadLastWeek");
	}
	if (on("agreement")) {
		submissions.push({ sheet: "talent:w-2:assignment:talentRebrand", by: "talent" }, { sheet: "talent:w-1:assignment:talentRebrand", by: "talent" });
		approvals.push({ sheet: "talent:w-2:assignment:talentRebrand", by: "consultant" });
		alias("talent:w-2:assignment:talentRebrand", "talentApproved");
		alias("talent:w-1:assignment:talentRebrand", "talentWaiting");
	}

	return {
		runId,
		now: new Date(nowMs).toISOString(),
		today,
		timezone: TIMEZONE,
		groups: [...groups],
		weeks,
		personas,
		workspaces,
		teams,
		projects,
		contracts,
		agreementStart,
		agreementEnd: addDays(today, 180),
		signedAt: `${agreementStart}T02:00:00.000Z`,
		assignments,
		entries: kept,
		submissions,
		approvals,
		aliases,
		notes,
		apiPersonas: [...new Set([...teams.filter((t) => t.policy).map((t) => t.owner), ...submissions.map((s) => s.by), ...approvals.map((a) => a.by), ...(on("agreement") ? ["consultant"] : [])])].filter(has),
	};
}

/** Structural checks on a plan; returns problems (empty = sound). Used by --self-test and before a live seed. */
export function validatePlan(plan) {
	const problems = [];
	const persona = new Map(plan.personas.map((p) => [p.key, p]));
	const workspace = new Map(plan.workspaces.map((w) => [w.key, w]));
	const team = new Map(plan.teams.map((t) => [t.key, t]));
	const project = new Map(plan.projects.map((p) => [p.key, p]));
	const assignment = new Map(plan.assignments.map((a) => [a.key, a]));
	const writer = new Set(["owner", "admin", "editor"]);

	for (const p of plan.personas) {
		if (!PERSONA_EMAIL_RE.test(p.email)) problems.push(`email ${p.email} does not match the persona pattern`);
	}
	for (const w of plan.workspaces) {
		if (!persona.has(w.owner)) problems.push(`workspace ${w.key}: owner ${w.owner} is not seeded`);
		if (!/^[a-z0-9-]+$/.test(w.slug)) problems.push(`workspace ${w.key}: slug ${w.slug} is not slug-safe`);
		for (const m of w.members) if (!persona.has(m.persona)) problems.push(`workspace ${w.key}: member ${m.persona} is not seeded`);
	}
	for (const t of plan.teams) {
		if (!workspace.has(t.workspace)) problems.push(`team ${t.key}: workspace ${t.workspace} is not seeded`);
		const ws = workspace.get(t.workspace);
		for (const m of t.members) {
			if (ws && ws.owner !== m.persona && !ws.members.some((x) => x.persona === m.persona)) problems.push(`team ${t.key}: ${m.persona} has no seat in ${t.workspace}`);
		}
	}
	for (const p of plan.projects) {
		if (!p.title.startsWith("[QA] ")) problems.push(`project ${p.key}: title must start with "[QA] " (time_test_cleanup refuses anything else)`);
		if (!workspace.has(p.workspace)) problems.push(`project ${p.key}: workspace ${p.workspace} is not seeded`);
		if (!p.access.some((a) => a.persona === p.owner && a.role === "owner")) problems.push(`project ${p.key}: owner ${p.owner} has no owner access row`);
		for (const t of p.teams) {
			const tm = team.get(t.team);
			if (!tm) {
				problems.push(`project ${p.key}: team ${t.team} is not seeded`);
				continue;
			}
			for (const c of t.curated) {
				if (tm.owner !== c && !tm.members.some((m) => m.persona === c)) problems.push(`project ${p.key}: curated ${c} is not on team ${t.team}`);
			}
		}
	}
	const names = [
		...plan.workspaces.map((w) => w.name),
		...plan.teams.map((t) => t.name),
		...plan.projects.flatMap((p) => [p.title, ...p.tasks.map((t) => t.title)]),
		...plan.entries.map((e) => e.note ?? ""),
	];
	for (const name of names) if (BANNED_WORDS.test(name)) problems.push(`seeded text "${name}" uses a word native copy must never show`);

	const byMember = new Map();
	for (const e of plan.entries) {
		const p = project.get(e.project);
		if (!p) {
			problems.push(`entry on unknown project ${e.project}`);
			continue;
		}
		if (e.minutes <= 0) problems.push(`entry ${e.persona} ${e.start} has no duration`);
		if (e.task !== null && !p.tasks[e.task]) problems.push(`entry ${e.persona} ${e.start}: task ${e.task} is not on ${e.project}`);
		if (e.task === null && !e.workItem) problems.push(`entry ${e.persona} ${e.start}: needs a task or a preset`);
		const access = p.access.find((a) => a.persona === e.persona);
		if (e.context.kind === "assignment") {
			const a = assignment.get(e.context.ref);
			if (!a || a.project !== e.project) problems.push(`entry ${e.persona} ${e.start}: assignment ${e.context.ref} is not on ${e.project}`);
			else if (Date.parse(e.start) < Date.parse(a.startedAt)) problems.push(`entry ${e.persona} ${e.start} starts before its assignment`);
		} else if (!access || !writer.has(access.role)) {
			problems.push(`entry ${e.persona} on ${e.project}: no editor-or-above access`);
		}
		if (e.context.kind === "team") {
			const link = p.teams.find((t) => t.team === e.context.ref);
			if (!link || !link.curated.includes(e.persona)) problems.push(`entry ${e.persona} on ${e.project}: not curated for team ${e.context.ref}`);
		}
		if (e.context.kind === "workspace") {
			const ws = workspace.get(e.context.ref);
			if (p.workspace !== e.context.ref) problems.push(`entry ${e.persona} on ${e.project}: workspace context ${e.context.ref} is not the project's workspace`);
			else if (ws && ws.owner !== e.persona && !ws.members.some((m) => m.persona === e.persona)) problems.push(`entry ${e.persona}: no seat in ${e.context.ref}`);
			if (p.teams.length > 0) problems.push(`entry ${e.persona} on ${e.project}: a workspace context needs a project with no team`);
		}
		const list = byMember.get(e.persona) ?? [];
		list.push(e);
		byMember.set(e.persona, list);
	}
	for (const [member, list] of byMember) {
		const sorted = [...list].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
		for (let i = 1; i < sorted.length; i++) {
			if (Date.parse(sorted[i].start) < Date.parse(sorted[i - 1].end)) problems.push(`${member}: entries overlap at ${sorted[i].start}`);
		}
	}
	const sheets = new Set(plan.entries.map(sheetKeyOf).filter(Boolean));
	for (const s of [...plan.submissions, ...plan.approvals]) {
		if (!sheets.has(s.sheet)) problems.push(`sheet action on ${s.sheet}, which has no entries`);
		if (!persona.has(s.by)) problems.push(`sheet action by ${s.by}, who is not seeded`);
	}
	for (const a of plan.approvals) {
		if (!plan.submissions.some((s) => s.sheet === a.sheet)) problems.push(`approval of ${a.sheet} without a submission`);
	}
	return problems;
}

function printPlan(plan) {
	const count = (list) => list.length;
	console.log(`Plan for run ${plan.runId} (groups: ${plan.groups.join(", ")}; ${plan.timezone}; today ${plan.today})`);
	console.log(`  weeks: ${Object.entries(plan.weeks).map(([k, v]) => `${k}=${v}`).join("  ")}`);
	console.log("  personas:");
	for (const p of plan.personas) console.log(`    ${p.key.padEnd(11)} ${p.email.padEnd(50)} ${p.login ? "login" : "     "}  ${p.role}`);
	console.log(`  workspaces (${count(plan.workspaces)}): ${plan.workspaces.map((w) => `${w.key}[${w.plan}]`).join(", ")}`);
	console.log(`  teams (${count(plan.teams)}): ${plan.teams.map((t) => `${t.key}${t.policy ? " (team override)" : ""}`).join(", ") || "none"}`);
	console.log(`  projects (${count(plan.projects)}): ${plan.projects.map((p) => p.title).join(" | ") || "none"}`);
	if (plan.contracts.length) console.log(`  agreements: ${plan.contracts.map((c) => c.kind).join(", ")}; assignments: ${plan.assignments.map((a) => `${a.key} on ${a.project}`).join(", ")}`);
	const perPersona = {};
	for (const e of plan.entries) perPersona[e.persona] = (perPersona[e.persona] ?? 0) + 1;
	console.log(`  entries (${count(plan.entries)}): ${Object.entries(perPersona).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
	console.log(`  submit: ${plan.submissions.map((s) => s.sheet).join(", ") || "none"}`);
	console.log(`  approve: ${plan.approvals.map((a) => `${a.sheet} by ${a.by}`).join(", ") || "none"}`);
	console.log(`  backend sign-ins: ${plan.apiPersonas.join(", ") || "none"}`);
	for (const note of plan.notes) console.log(`  note: ${note}`);
}

// ─── the manifest ────────────────────────────────────────────────────────────

export function readManifest(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}

function writeManifest(file, manifest) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	fs.renameSync(tmp, file);
}

function newManifest(plan, cfg) {
	return {
		version: 1,
		kind: "proyekto-time-e2e-seed",
		runId: plan.runId,
		status: "seeding",
		createdAt: new Date().toISOString(),
		seededAt: null,
		supabaseHost: hostOf(cfg.supabaseUrl),
		apiUrl: cfg.apiUrl,
		timezone: plan.timezone,
		groups: plan.groups,
		weeks: plan.weeks,
		personas: {},
		users: [],
		workspaces: {},
		teams: {},
		projects: {},
		contracts: [],
		engagements: {},
		assignments: {},
		consultantProfiles: [],
		sheets: {},
		entries: {},
		tracked: [],
		notes: [...plan.notes],
		error: null,
	};
}

// ─── live helpers ────────────────────────────────────────────────────────────

function errorText(error) {
	if (!error) return "unknown error";
	if (error instanceof Error) return error.message;
	if (typeof error === "object") return [error.code, error.message, error.details, error.hint].filter(Boolean).join(" · ") || JSON.stringify(error);
	return String(error);
}

function log(step, detail = "") {
	console.log(`• ${step}${detail ? ` — ${detail}` : ""}`);
}

class Session {
	constructor({ cfg, plan, admin, createClient, manifest }) {
		this.cfg = cfg;
		this.plan = plan;
		this.admin = admin;
		this.createClient = createClient;
		this.m = manifest;
		this.ids = { personas: {}, workspaces: {}, teams: {}, projects: {}, tasks: {}, assignments: {}, engagements: {} };
		this.tokens = new Map();
		this.sheetIds = {};
	}

	save() {
		writeManifest(this.cfg.manifestPath, this.m);
	}

	track(table, id) {
		this.m.tracked.push({ table, id });
		this.save();
		return id;
	}

	trackMatch(table, match) {
		this.m.tracked.push({ table, match });
		this.save();
	}

	async insert(table, row, { track = true } = {}) {
		const { data, error } = await this.admin.from(table).insert(row).select("id").single();
		if (error || !data) throw new Error(`insert into ${table} failed: ${errorText(error) || "no row returned"}`);
		if (track) this.track(table, data.id);
		return data.id;
	}

	async insertKeyed(table, row, match) {
		const { error } = await this.admin.from(table).insert(row);
		if (error) throw new Error(`insert into ${table} failed: ${errorText(error)}`);
		if (match) this.trackMatch(table, match);
	}

	async update(table, patch, column, value) {
		const { error } = await this.admin.from(table).update(patch).eq(column, value);
		if (error) throw new Error(`update ${table} failed: ${errorText(error)}`);
	}

	persona(key) {
		const p = this.m.personas[key];
		if (!p) throw new Error(`persona ${key} was not created`);
		return p;
	}

	async token(key) {
		if (this.tokens.has(key)) return this.tokens.get(key);
		const p = this.persona(key);
		const client = this.createClient(this.cfg.supabaseUrl, this.cfg.anonKey, {
			auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
		});
		const { data, error } = await client.auth.signInWithPassword({ email: p.email, password: p.password });
		if (error || !data?.session?.access_token) throw new Error(`sign-in as ${key} failed: ${errorText(error) || "no session"}`);
		this.tokens.set(key, data.session.access_token);
		return data.session.access_token;
	}

	/** One backend call as a persona; unwraps the {data} envelope; errors carry the code, never the token. */
	async api(key, method, apiPath, body) {
		const token = await this.token(key);
		const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
		if (body !== undefined) headers["Content-Type"] = "application/json";
		let res;
		try {
			res = await fetch(`${this.cfg.apiUrl}/api${apiPath}`, {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(60_000),
			});
		} catch (error) {
			throw new Error(`${method} /api${apiPath} as ${key}: the backend at ${this.cfg.apiUrl} did not answer (${errorText(error)})`);
		}
		const text = await res.text();
		let json = null;
		try {
			json = text ? JSON.parse(text) : null;
		} catch {
			json = null;
		}
		if (!res.ok) {
			const e = json?.error ?? json ?? {};
			const message = Array.isArray(e.message) ? e.message.join("; ") : e.message;
			throw new Error(`${method} /api${apiPath} as ${key}: ${res.status} ${e.code ?? ""} ${message ?? text.slice(0, 200)}`.replace(/\s+/g, " ").trim());
		}
		return json && typeof json === "object" && "data" in json ? json.data : json;
	}
}

// ─── seed steps ──────────────────────────────────────────────────────────────

async function createUsers(s) {
	for (const p of s.plan.personas) {
		const password = `Pw-${randomUUID()}`;
		const { data, error } = await s.admin.auth.admin.createUser({
			email: p.email,
			password,
			email_confirm: true,
			user_metadata: { first_name: p.first, last_name: p.last, full_name: p.displayName },
		});
		if (error || !data?.user) throw new Error(`create user ${p.key} failed: ${errorText(error)}`);
		const id = data.user.id;
		s.ids.personas[p.key] = id;
		s.m.users.push(id);
		s.m.personas[p.key] = {
			key: p.key,
			id,
			email: p.email,
			password,
			displayName: p.displayName,
			firstName: p.first,
			group: p.group,
			login: p.login,
			role: p.role,
			storageState: `playwright/.auth/time-${p.key}.json`,
		};
		s.save();

		// No auth trigger is relied on: upsert the profile the login form reads (verified, onboarded).
		const { error: profileError } = await s.admin.from("profiles").upsert(
			{
				id,
				email: p.email,
				display_name: p.displayName,
				first_name: p.first,
				last_name: p.last,
				is_email_verified: true,
				has_completed_onboarding: true,
			},
			{ onConflict: "id" },
		);
		if (profileError) throw new Error(`profile for ${p.key} failed: ${errorText(profileError)}`);

		// The dashboard tour auto-runs when no progress row exists; its overlay would cover every spec.
		await s.insertKeyed(
			"user_tour_progress",
			{ user_id: id, tour_key: DASHBOARD_TOUR_KEY, scope_type: "global", scope_id: null, status: "skipped", last_step: 0 },
			{ user_id: id, tour_key: DASHBOARD_TOUR_KEY },
		);

		// The workspace policy row takes the earliest owner's timezone (time_ensure_workspace_policy), and the
		// overview's day strip reads the member's; both are Asia/Manila so the seeded weeks line up.
		const { error: prefsError } = await s.admin
			.from("user_time_preferences")
			.upsert({ user_id: id, timezone: TIMEZONE, week_start: 1 }, { onConflict: "user_id" });
		if (prefsError) throw new Error(`time preferences for ${p.key} failed: ${errorText(prefsError)}`);
		s.trackMatch("user_time_preferences", { user_id: id });
	}
	log("users", `${s.plan.personas.length} personas`);
}

async function probeBackend(s) {
	const first = s.plan.apiPersonas[0] ?? s.plan.personas[0]?.key;
	if (!first) return;
	try {
		await s.api(first, "GET", "/time/me/running");
	} catch (error) {
		throw new Error(
			`The backend at ${s.cfg.apiUrl} refused a dev session (${errorText(error)}). It must be the PR-1 build running against ${DEV_HOST}; nothing past the users was written.`,
		);
	}
	log("backend", `${s.cfg.apiUrl} accepts dev sessions and serves /api/time`);
}

async function createWorkspaces(s) {
	for (const w of s.plan.workspaces) {
		const owner = s.ids.personas[w.owner];
		const id = await s.insert("workspaces", { name: w.name, slug: w.slug, created_by: owner });
		s.ids.workspaces[w.key] = id;
		s.m.workspaces[w.key] = { id, slug: w.slug, name: w.name, plan: w.plan, owner: w.owner };
		s.save();
		await s.insert("workspace_members", { workspace_id: id, user_id: owner, role: "owner" });
		for (const m of w.members) await s.insert("workspace_members", { workspace_id: id, user_id: s.ids.personas[m.persona], role: m.role });
		if (w.plan !== "free") {
			// The complimentary columns workspace_plan_state reads (harness.ts compWorkspace), before any lookup.
			await s.update(
				"workspaces",
				{ is_discounted_free: true, discounted_plan: w.plan, discounted_at: new Date().toISOString(), discounted_until: null },
				"id",
				id,
			);
		}
	}
	log("workspaces", s.plan.workspaces.map((w) => `${w.key}[${w.plan}]`).join(", "));
}

async function enrolConsultant(s) {
	if (!s.plan.groups.includes("agreement")) return;
	const id = s.ids.personas.consultant;
	const { error } = await s.admin.from("consultant_profiles").upsert({ user_id: id, status: "verified" }, { onConflict: "user_id" });
	if (error) throw new Error(`consultant enrolment failed: ${errorText(error)}`);
	s.m.consultantProfiles.push(id);
	s.save();
	log("consultant", "enrolment verified");
}

async function createTeams(s) {
	for (const t of s.plan.teams) {
		const owner = s.ids.personas[t.owner];
		const id = await s.insert("teams", { owner_id: owner, name: t.name, workspace_id: s.ids.workspaces[t.workspace] });
		s.ids.teams[t.key] = id;
		s.m.teams[t.key] = { id, name: t.name, workspace: t.workspace, owner: t.owner };
		s.save();
		// TeamsService.create seats the owner too; the time-entry trigger checks team_members. Not tracked: it
		// cascades with the team (tg_team_members_block_owner_delete stands down once the team row is gone).
		await s.insert("team_members", { team_id: id, user_id: owner, role: "owner" }, { track: false });
		for (const m of t.members) await s.insert("team_members", { team_id: id, user_id: s.ids.personas[m.persona], role: m.role });
		if (t.timeTracking !== null) await s.update("teams", { time_tracking_enabled: t.timeTracking }, "id", id);
	}
	if (s.plan.teams.length) log("teams", s.plan.teams.map((t) => t.key).join(", "));
}

async function createProjects(s) {
	for (const p of s.plan.projects) {
		const row = {
			title: p.title,
			owner_id: s.ids.personas[p.owner],
			workspace_id: s.ids.workspaces[p.workspace],
			status: "active",
		};
		if (p.primaryTeam) row.primary_team_id = s.ids.teams[p.primaryTeam];
		const projectId = await s.insert("projects", row);
		s.ids.projects[p.key] = projectId;
		s.m.projects[p.key] = { id: projectId, title: p.title, workspace: p.workspace, owner: p.owner, roadmapId: null, tasks: [] };
		s.save();

		for (const a of p.access) {
			await s.insert("project_access", {
				project_id: projectId,
				user_id: s.ids.personas[a.persona],
				role: a.role,
				origin: "direct",
				capabilities: {},
				// Every direct project_access writer must set this (team-detach owner lockout fix).
				has_direct_grant: true,
			});
		}
		for (const link of p.teams) {
			const teamId = s.ids.teams[link.team];
			await s.insertKeyed("project_teams", { project_id: projectId, team_id: teamId, is_primary: link.primary }, { project_id: projectId, team_id: teamId });
			for (const c of link.curated) {
				const userId = s.ids.personas[c];
				await s.insertKeyed(
					"project_team_members",
					{ project_id: projectId, team_id: teamId, user_id: userId },
					{ project_id: projectId, team_id: teamId, user_id: userId },
				);
			}
		}

		const roadmapId = await s.insert("roadmaps", { name: `${p.title} roadmap`, owner_id: s.ids.personas[p.owner], project_id: projectId, preview_url: "" });
		const epicId = await s.insert("roadmap_epics", { roadmap_id: roadmapId, title: "Delivery", position: 0 });
		const featureId = await s.insert("roadmap_features", { epic_id: epicId, roadmap_id: roadmapId, title: "This sprint", position: 0 });
		const taskIds = [];
		for (const [index, task] of p.tasks.entries()) {
			const taskId = await s.insert("roadmap_tasks", { feature_id: featureId, title: task.title, position: index, status: index === 0 ? "in_progress" : "todo" });
			taskIds.push(taskId);
			for (const assignee of task.assignees) {
				const { error } = await s.admin.from("roadmap_task_assignees").insert({ task_id: taskId, assignee_id: s.ids.personas[assignee] });
				if (error) throw new Error(`task assignee on ${p.key} failed: ${errorText(error)}`);
			}
		}
		s.ids.tasks[p.key] = taskIds;
		s.m.projects[p.key].roadmapId = roadmapId;
		s.m.projects[p.key].tasks = p.tasks.map((task, index) => ({ id: taskIds[index], title: task.title }));
		s.save();
	}
	log("projects", s.plan.projects.map((p) => p.key).join(", "));
}

async function writeTeamPolicies(s) {
	for (const t of s.plan.teams.filter((x) => x.policy)) {
		// Through the backend (owner-only field, time_team_rules on the team's workspace), before any entry, so the
		// team's sheets are created at team scope.
		await s.api(t.owner, "PUT", `/time/policies/teams/${s.ids.teams[t.key]}`, t.policy);
		log("team policy", `${t.key}: ${JSON.stringify(t.policy)}`);
	}
}

async function createAgreements(s) {
	for (const c of s.plan.contracts) {
		const hirer = s.ids.personas[c.hirer];
		const provider = s.ids.personas[c.provider];
		const consultant = s.ids.personas.consultant;
		const contractId = await s.insert(
			"contracts",
			{
				project_id: null,
				created_by: consultant,
				consultant_user_id: consultant,
				client_user_id: c.kind === "client_services" ? hirer : null,
				relationship_kind: c.kind,
				scope_mode: "flexible",
				contract_family_id: randomUUID(),
				version: 1,
				status: "draft",
				currency: "USD",
				billing_mode: "time_based",
				client_hourly_rate: c.hourlyRate,
				service_start_date: s.plan.agreementStart,
				service_end_date: s.plan.agreementEnd,
				time_tracking_mode: "optional",
				time_approval_mode: c.approvalMode,
				client_hours_detail_level: c.clientHoursLevel,
			},
			{ track: false },
		);
		const record = { key: c.key, id: contractId, engagementId: null };
		s.m.contracts.push(record);
		s.save();

		const teamName = (key) => (key ? s.m.teams[key]?.name ?? null : null);
		const position = (side, userKey, capacity, teamKey) => ({
			contract_id: contractId,
			position: side,
			user_id: s.ids.personas[userKey],
			capacity,
			display_name_snapshot: s.m.personas[userKey].displayName,
			email_snapshot: s.m.personas[userKey].email,
			team_id: teamKey ? s.ids.teams[teamKey] : null,
			team_name_snapshot: teamName(teamKey),
		});
		const { error: positionsError } = await s.admin
			.from("contract_positions")
			.insert([position("hirer", c.hirer, c.hirerCapacity, c.hirerTeam), position("provider", c.provider, c.providerCapacity, c.providerTeam)]);
		if (positionsError) throw new Error(`contract positions (${c.key}) failed: ${errorText(positionsError)}`);

		for (const side of ["provider", "hirer"]) {
			// The RPC refuses a stale revision; each signature bumps it.
			const { data: current, error: revisionError } = await s.admin.from("contracts").select("revision").eq("id", contractId).single();
			if (revisionError) throw new Error(`contract revision (${c.key}) failed: ${errorText(revisionError)}`);
			const signer = side === "hirer" ? c.hirer : c.provider;
			const { error: signError } = await s.admin.rpc("sign_contract_position_and_activate", {
				p_contract_id: contractId,
				p_position: side,
				p_signer_name: s.m.personas[signer].displayName,
				p_signature_url: null,
				p_scale: 1,
				p_offset_x: 0,
				p_offset_y: 0,
				p_signed_at: s.plan.signedAt,
				p_expected_revision: current.revision,
			});
			if (signError) throw new Error(`signing ${c.key} as ${side} failed: ${errorText(signError)}`);
		}
		const { data: signed, error: signedError } = await s.admin.from("contracts").select("engagement_id").eq("id", contractId).single();
		if (signedError || !signed?.engagement_id) throw new Error(`contract ${c.key} did not activate an engagement: ${errorText(signedError)}`);
		record.engagementId = signed.engagement_id;
		s.ids.engagements[c.key] = signed.engagement_id;
		s.m.engagements[c.key] = signed.engagement_id;
		s.save();
	}
	if (s.plan.contracts.length) log("agreements", s.plan.contracts.map((c) => `${c.key} → ${s.ids.engagements[c.key]}`).join(", "));
}

async function placeAgreements(s) {
	for (const p of s.plan.projects.filter((x) => x.link)) {
		// The step after signing: attaches the provider team, links the project, gives the consultant their own
		// assignment (engagement-project.service.ts setUp).
		await s.api("consultant", "POST", `/engagements/${s.ids.engagements[p.link]}/project`, { mode: "link", project_id: s.ids.projects[p.key] });
		log("agreement project", `${p.key} linked to the ${p.link} agreement`);
	}
	for (const a of s.plan.assignments) {
		const view = await s.api("consultant", "POST", `/engagements/${s.ids.engagements[a.engagement]}/assignments`, {
			project_id: s.ids.projects[a.project],
			role_title: a.roleTitle,
			started_at: a.startedAt,
		});
		if (!view?.id) throw new Error(`assignment ${a.key} came back without an id`);
		s.ids.assignments[a.key] = view.id;
		s.m.assignments[a.key] = view.id;
		s.save();
		log("assignment", `${a.key} (${view.client_engagement_id ? "billed through the client agreement" : "talent only"})`);
	}
}

function entryRow(s, e) {
	const ref =
		e.context.kind === "team"
			? s.ids.teams[e.context.ref]
			: e.context.kind === "workspace"
				? s.ids.workspaces[e.context.ref]
				: e.context.kind === "assignment"
					? s.ids.assignments[e.context.ref]
					: null;
	const row = {
		project_id: s.ids.projects[e.project],
		member_user_id: s.ids.personas[e.persona],
		context_kind: e.context.kind,
		context_ref: ref,
		team_id: e.context.kind === "team" ? ref : null,
		workspace_id: e.context.kind === "workspace" ? ref : null,
		engagement_assignment_id: e.context.kind === "assignment" ? ref : null,
		started_at: e.start,
		ended_at: e.end,
		duration_seconds: e.minutes * 60,
		break_seconds: 0,
		break_minutes: 0,
		source: "manual",
	};
	if (e.task !== null) row.task_id = s.ids.tasks[e.project][e.task];
	if (e.workItem) row.work_item = e.workItem;
	if (e.note) row.note = e.note;
	return row;
}

async function insertEntries(s) {
	const byPersona = new Map();
	for (const e of s.plan.entries) byPersona.set(e.persona, [...(byPersona.get(e.persona) ?? []), e]);
	for (const [persona, list] of byPersona) {
		// One batch per member; the base triggers validate access and place each entry on its timesheet.
		const { data, error } = await s.admin.from("time_entries").insert(list.map((e) => entryRow(s, e))).select("id, timesheet_id, started_at");
		if (error || !data) throw new Error(`time entries for ${persona} failed: ${errorText(error)}`);
		const byStart = new Map(data.map((row) => [Date.parse(row.started_at), row]));
		s.m.entries[persona] = data.map((row) => row.id);
		for (const e of list) {
			const row = byStart.get(Date.parse(e.start));
			const key = sheetKeyOf(e);
			if (!row || !key) continue;
			if (!row.timesheet_id) throw new Error(`entry ${persona} ${e.start} has no timesheet (context ${e.context.kind})`);
			if (s.sheetIds[key] && s.sheetIds[key] !== row.timesheet_id) throw new Error(`sheet ${key} split across two timesheets`);
			s.sheetIds[key] = row.timesheet_id;
			const [, week, contextKind] = key.split(":");
			const sheet = (s.m.sheets[key] ??= { id: row.timesheet_id, alias: s.plan.aliases[key] ?? null, persona, week, contextKind, status: "open", entryIds: [] });
			sheet.entryIds.push(row.id);
		}
		s.save();
	}
	log("entries", `${s.plan.entries.length} across ${Object.keys(s.m.sheets).length} timesheets`);
}

async function sheetRevision(s, key, sheetId) {
	const detail = await s.api(key, "GET", `/time/timesheets/${sheetId}`);
	const revision = detail?.sheet?.revision;
	if (typeof revision !== "number") throw new Error(`timesheet ${sheetId} came back without a revision`);
	return revision;
}

async function actOnSheets(s) {
	for (const sub of s.plan.submissions) {
		const id = s.sheetIds[sub.sheet];
		if (!id) throw new Error(`no timesheet for ${sub.sheet}`);
		const revision = await sheetRevision(s, sub.by, id);
		await s.api(sub.by, "POST", `/time/timesheets/${id}/submit`, { expected_revision: revision });
	}
	for (const a of s.plan.approvals) {
		const id = s.sheetIds[a.sheet];
		const revision = await sheetRevision(s, a.by, id);
		await s.api(a.by, "POST", `/time/timesheets/${id}/approve`, { expected_revision: revision });
	}
	const ids = Object.values(s.m.sheets).map((x) => x.id);
	if (ids.length) {
		const { data, error } = await s.admin.from("timesheets").select("id, status").in("id", ids);
		if (error) throw new Error(`reading timesheet states failed: ${errorText(error)}`);
		const status = new Map((data ?? []).map((row) => [row.id, row.status]));
		for (const sheet of Object.values(s.m.sheets)) sheet.status = status.get(sheet.id) ?? sheet.status;
		s.save();
	}
	log("timesheets", `${s.plan.submissions.length} submitted, ${s.plan.approvals.length} approved`);
}

async function seedCommand(cfg, args) {
	const existing = readManifest(cfg.manifestPath);
	if (existing && existing.status !== "torn_down") {
		if (!args.replace) {
			console.error(`A ${existing.status} run (${existing.runId}) is recorded in ${cfg.manifestPath}. Run --teardown first, or pass --replace.`);
			return 1;
		}
		console.log(`Replacing run ${existing.runId}: tearing it down first.`);
		const code = await teardownCommand(cfg, { ...args, orphans: false });
		if (code !== 0) return code;
	}

	const runId = randomBytes(4).toString("hex");
	const plan = buildPlan({ runId, nowMs: Date.now(), groups: args.only ?? GROUPS });
	const planProblems = validatePlan(plan);
	if (planProblems.length) {
		console.error(`The plan is unsound:\n  ${planProblems.join("\n  ")}`);
		return 1;
	}

	const { createClient } = await import("@supabase/supabase-js");
	const admin = createClient(cfg.supabaseUrl, cfg.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
	const manifest = newManifest(plan, cfg);
	const s = new Session({ cfg, plan, admin, createClient, manifest });
	s.save();
	console.log(`Seeding run ${runId} on ${DEV_HOST} (groups: ${plan.groups.join(", ")})`);
	try {
		await createUsers(s);
		await probeBackend(s);
		await createWorkspaces(s);
		await enrolConsultant(s);
		await createTeams(s);
		await createProjects(s);
		await writeTeamPolicies(s);
		await createAgreements(s);
		await placeAgreements(s);
		await insertEntries(s);
		await actOnSheets(s);
		manifest.status = "seeded";
		manifest.seededAt = new Date().toISOString();
		s.save();
	} catch (error) {
		manifest.status = "failed";
		manifest.error = errorText(error);
		s.save();
		console.error(`\nSeeding failed: ${manifest.error}`);
		if (args.keepOnFailure) {
			console.error(`Left in place (--keep-on-failure). Remove it with: node playwright/time/seed-time-personas.mjs --teardown`);
			return 1;
		}
		console.error("Tearing the partial run down…");
		await teardownCommand(cfg, { ...args, orphans: false });
		return 1;
	}

	console.log(`\nSeeded run ${runId}. Personas (passwords are only in the manifest):`);
	for (const p of Object.values(manifest.personas)) console.log(`  ${p.key.padEnd(11)} ${p.email.padEnd(50)} ${p.login ? "login" : "     "}  ${p.role}`);
	console.log("Timesheets:");
	for (const [key, sheet] of Object.entries(manifest.sheets)) console.log(`  ${(sheet.alias ?? "").padEnd(22)} ${key.padEnd(40)} ${sheet.status}`);
	console.log(`\nManifest: ${cfg.manifestPath} (gitignored; holds passwords; do not print or commit it)`);
	console.log("Next, from web/ with the Phase C web on :3107 and backend on :8011:");
	console.log("  npx playwright test -c playwright/time/playwright.config.ts");
	console.log("Afterwards: node playwright/time/seed-time-personas.mjs --teardown");
	return 0;
}

// ─── teardown ────────────────────────────────────────────────────────────────

async function findOrphanUsers(admin) {
	const found = [];
	for (let page = 1; page <= 50; page++) {
		const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
		if (error) throw new Error(`listing users failed: ${errorText(error)}`);
		const users = data?.users ?? [];
		for (const user of users) if (user.email && PERSONA_EMAIL_RE.test(user.email)) found.push(user.id);
		if (users.length < 200) break;
	}
	return found;
}

/** Only ids whose auth user really is a seeded persona feed the "owned by" sweeps. */
async function confirmPersonaUsers(admin, ids, problems) {
	const confirmed = [];
	for (const id of ids) {
		const { data, error } = await admin.auth.admin.getUserById(id);
		if (error || !data?.user) {
			if (error && !/not.?found/i.test(errorText(error))) problems.push(`user ${id}: ${errorText(error)}`);
			continue;
		}
		if (data.user.email && PERSONA_EMAIL_RE.test(data.user.email)) confirmed.push(id);
		else problems.push(`user ${id} is not a seeded persona (${data.user.email ?? "no email"}); skipped`);
	}
	return confirmed;
}

/** A foreign key or an append-only guard still holds the row: expected for the engagement graph. */
function isPinned(error) {
	const text = errorText(error);
	return error?.code === "23503" || /DELETE_FORBIDDEN|violates foreign key|still referenced/i.test(text);
}

async function selectIds(admin, table, column, values) {
	if (values.length === 0) return [];
	const { data, error } = await admin.from(table).select("id").in(column, values);
	if (error) throw new Error(`reading ${table} failed: ${errorText(error)}`);
	return (data ?? []).map((row) => row.id);
}

async function teardownCommand(cfg, args) {
	const manifest = readManifest(cfg.manifestPath);
	if (manifest && manifest.kind !== "proyekto-time-e2e-seed") {
		console.error(`REFUSING: ${cfg.manifestPath} is not a time E2E seed manifest`);
		return 2;
	}
	if (manifest && manifest.supabaseHost !== DEV_HOST) {
		console.error(`REFUSING: the manifest was written for ${manifest.supabaseHost ?? "an unknown host"}, not ${DEV_HOST}`);
		return 2;
	}
	if ((!manifest || manifest.status === "torn_down") && !args.orphans) {
		console.log(manifest ? `Run ${manifest.runId} is already torn down.` : `No manifest at ${cfg.manifestPath}; nothing to tear down (use --orphans to search).`);
		return 0;
	}

	const { createClient } = await import("@supabase/supabase-js");
	const admin = createClient(cfg.supabaseUrl, cfg.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
	const problems = [];
	const leftovers = [];
	const tracked = manifest && manifest.status !== "torn_down" ? (manifest.tracked ?? []) : [];
	const trackedIds = (table) => tracked.filter((r) => r.table === table && r.id).map((r) => r.id);

	let userIds = manifest && manifest.status !== "torn_down" ? [...(manifest.users ?? [])] : [];
	if (args.orphans) {
		const orphans = await findOrphanUsers(admin);
		userIds = [...new Set([...userIds, ...orphans])];
		console.log(`Found ${orphans.length} time persona users by email.`);
	}
	const personas = await confirmPersonaUsers(admin, userIds, problems);
	console.log(`Tearing down ${manifest?.runId ? `run ${manifest.runId}` : "orphans"}: ${personas.length} persona users, ${tracked.length} tracked rows.`);

	// Everything the personas own, including rows the specs created (a project made in the UI, a workspace the
	// app provisioned). Tracked first, then the sweep; each list is de-duplicated.
	const ownedProjects = await selectIds(admin, "projects", "owner_id", personas).catch((error) => (problems.push(errorText(error)), []));
	const ownedTeams = await selectIds(admin, "teams", "owner_id", personas).catch((error) => (problems.push(errorText(error)), []));
	const ownedWorkspaces = await selectIds(admin, "workspaces", "created_by", personas).catch((error) => (problems.push(errorText(error)), []));
	const projectIds = [...new Set([...trackedIds("projects"), ...ownedProjects])];

	// 1. Time first: locked entries and their sheets cannot go through PostgREST (no app.time_maintenance).
	for (const projectId of projectIds) {
		const { error } = await admin.rpc("time_test_cleanup", { p_project_id: projectId });
		if (error) {
			const text = errorText(error);
			if (text.includes("TIME_TEST_CLEANUP_FORBIDDEN")) leftovers.push(`project ${projectId} is not titled "[QA] …", so its time entries were left`);
			else problems.push(`time_test_cleanup(${projectId}): ${text}`);
		}
	}

	// 2. Notifications the flows sent to the personas.
	if (personas.length) {
		const { error } = await admin.from("notifications").delete().in("user_id", personas);
		if (error) problems.push(`notifications: ${errorText(error)}`);
	}

	// 3. Tracked rows, newest first. A row something permanent still references (the studio team, pinned by the
	// engagement parties) is a leftover, not a failure.
	for (let i = tracked.length - 1; i >= 0; i--) {
		const row = tracked[i];
		const query = admin.from(row.table).delete();
		const { error } = row.id ? await query.eq("id", row.id) : await query.match(row.match);
		if (!error) continue;
		const label = `${row.table} ${row.id ?? JSON.stringify(row.match)}: ${errorText(error)}`;
		if (isPinned(error)) leftovers.push(label);
		else problems.push(label);
	}

	// 4. Anything else the personas own.
	const done = new Set(tracked.map((r) => r.id).filter(Boolean));
	for (const [table, ids] of [
		["projects", ownedProjects],
		["teams", ownedTeams],
		["workspaces", ownedWorkspaces],
	]) {
		for (const id of ids.filter((x) => !done.has(x))) {
			const { error } = await admin.from(table).delete().eq("id", id);
			if (error) leftovers.push(`${table} ${id}: ${errorText(error)}`);
		}
	}

	// 5. Policy audit rows outlive their policy (D23: policy_id becomes NULL).
	const teamIds = [...new Set([...trackedIds("teams"), ...ownedTeams])];
	const workspaceIds = [...new Set([...trackedIds("workspaces"), ...ownedWorkspaces])];
	for (const [column, ids] of [
		["team_id", teamIds],
		["workspace_id", workspaceIds],
	]) {
		if (!ids.length) continue;
		const { error } = await admin.from("time_policy_events").delete().is("policy_id", null).in(column, ids);
		if (error) problems.push(`time_policy_events (${column}): ${errorText(error)}`);
	}

	// 6. The engagement graph is append-only: cancel (the only transition the guard allows), never delete.
	for (const contract of manifest?.contracts ?? []) {
		if (contract.engagementId) {
			const { error } = await admin
				.from("engagements")
				.update({ status: "cancelled", cancelled_at: new Date().toISOString(), status_reason: "time E2E fixture" })
				.eq("id", contract.engagementId)
				.eq("status", "active");
			if (error) problems.push(`cancel engagement ${contract.engagementId}: ${errorText(error)}`);
			leftovers.push(`engagement ${contract.engagementId} and contract ${contract.id} stay (append-only by design)`);
		} else {
			// Never signed: a draft contract can still go.
			await admin.from("contract_positions").delete().eq("contract_id", contract.id);
			const { error } = await admin.from("contracts").delete().eq("id", contract.id);
			if (error) leftovers.push(`draft contract ${contract.id}: ${errorText(error)}`);
		}
	}
	for (const userId of manifest?.consultantProfiles ?? []) {
		const { error } = await admin
			.from("consultant_profiles")
			.update({ status: "revoked", revoked_at: new Date().toISOString(), status_reason: "time E2E fixture" })
			.eq("user_id", userId);
		if (error) problems.push(`revoke enrolment ${userId}: ${errorText(error)}`);
	}

	// 7. Users. The agreement parties are pinned by the engagement graph; ban those so the known passwords die.
	for (const id of personas) {
		const { error } = await admin.auth.admin.deleteUser(id);
		if (!error) continue;
		const { error: banError } = await admin.auth.admin.updateUserById(id, { ban_duration: BAN_DURATION });
		leftovers.push(`user ${id} kept (${errorText(error)})${banError ? `; ban failed: ${errorText(banError)}` : "; banned"}`);
	}

	// 8. Sessions saved by the persona setup.
	for (const key of Object.keys(manifest?.personas ?? {})) fs.rmSync(path.join(AUTH_DIR, `time-${key}.json`), { force: true });

	if (manifest && manifest.status !== "torn_down") {
		for (const p of Object.values(manifest.personas ?? {})) delete p.password;
		manifest.status = "torn_down";
		manifest.tornDownAt = new Date().toISOString();
		manifest.tracked = [];
		manifest.leftovers = leftovers;
		manifest.teardownProblems = problems;
		writeManifest(cfg.manifestPath, manifest);
	}

	for (const item of leftovers) console.log(`  kept: ${item}`);
	for (const item of problems) console.log(`  problem: ${item}`);
	console.log(problems.length ? `Teardown finished with ${problems.length} problem(s).` : "Teardown finished.");
	return problems.length ? 1 : 0;
}

// ─── self-test (offline) ─────────────────────────────────────────────────────

function fakeJwt(claims) {
	const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${part({ alg: "HS256", typ: "JWT" })}.${part(claims)}.signature`;
}

export function selfTest() {
	const failures = [];
	const check = (name, condition) => {
		if (!condition) failures.push(name);
	};
	const good = {
		supabaseUrl: `https://${DEV_HOST}`,
		serviceRoleKey: fakeJwt({ ref: DEV_REF, role: "service_role" }),
		anonKey: fakeJwt({ ref: DEV_REF, role: "anon" }),
		webSupabaseUrl: `https://${DEV_HOST}`,
		apiUrl: "http://localhost:8011",
	};
	const refused = (patch, options) => !checkTargets({ ...good, ...patch }, options).ok;

	check("dev + localhost passes", checkTargets(good).ok);
	check("127.0.0.1 passes", !refused({ apiUrl: "http://127.0.0.1:8011" }));
	check("[::1] passes", !refused({ apiUrl: "http://[::1]:8011" }));
	check("an sb_secret key passes on the dev host", !refused({ serviceRoleKey: "sb_secret_abc" }));
	check("prod URL refused", refused({ supabaseUrl: "https://byvbnkpiselvvulsvxgo.supabase.co" }));
	check("look-alike host refused", refused({ supabaseUrl: `https://${DEV_HOST}.evil.example` }));
	check("ref in the path refused", refused({ supabaseUrl: `https://evil.example/${DEV_HOST}` }));
	check("http Supabase refused", refused({ supabaseUrl: `http://${DEV_HOST}` }));
	check("missing URL refused", refused({ supabaseUrl: "" }));
	check("prod service key refused", refused({ serviceRoleKey: fakeJwt({ ref: "byvbnkpiselvvulsvxgo", role: "service_role" }) }));
	check("anon key as the service key refused", refused({ serviceRoleKey: fakeJwt({ ref: DEV_REF, role: "anon" }) }));
	check("missing service key refused", refused({ serviceRoleKey: "" }));
	check("prod anon key refused", refused({ anonKey: fakeJwt({ ref: "byvbnkpiselvvulsvxgo", role: "anon" }) }));
	check("prod web refused", refused({ webSupabaseUrl: "https://byvbnkpiselvvulsvxgo.supabase.co" }));
	check("remote API refused", refused({ apiUrl: "https://api.proyekto.tech" }));
	check("localhost look-alike API refused", refused({ apiUrl: "http://localhost.evil.example:8011" }));
	check("API with a path refused", refused({ apiUrl: "http://localhost:8011/v2" }));
	check("teardown skips the API and web checks", checkTargets({ ...good, apiUrl: "https://api.proyekto.tech", webSupabaseUrl: "" }, { needApi: false, needWeb: false, needAnon: false }).ok);
	check("teardown still refuses prod", refused({ supabaseUrl: "https://byvbnkpiselvvulsvxgo.supabase.co" }, { needApi: false, needWeb: false, needAnon: false }));
	check("/api suffix is stripped", normaliseApi("http://localhost:8011/api/") === "http://localhost:8011");

	check("parseArgs rejects unknown flags", (() => {
		try {
			parseArgs(["--prod"]);
			return false;
		} catch (error) {
			return error instanceof UsageError;
		}
	})());
	check("parseArgs rejects unknown groups", (() => {
		try {
			parseArgs(["--only=solo,nope"]);
			return false;
		} catch (error) {
			return error instanceof UsageError;
		}
	})());
	check("parseArgs reads groups", JSON.stringify(parseArgs(["--only=solo,team"]).only) === '["solo","team"]');

	// Dates: Manila is UTC+8.
	check("Tue 11:00 Manila → week of Mon Oct 5", weekStart(Date.parse("2026-10-06T03:00:00Z")) === "2026-10-05");
	check("Mon 01:00 Manila (Sun 17:00Z) → Oct 5", weekStart(Date.parse("2026-10-04T17:00:00Z")) === "2026-10-05");
	check("Sun 23:59 Manila → Sep 28", weekStart(Date.parse("2026-10-04T15:59:00Z")) === "2026-09-28");
	check("one week back", weekStart(Date.parse("2026-10-06T03:00:00Z"), -1) === "2026-09-28");
	check("09:00 Manila is 01:00Z", localToIso("2026-10-05", 9, 0) === "2026-10-05T01:00:00.000Z");
	check("00:30 Manila is the previous UTC day", localToIso("2026-10-05", 0, 30) === "2026-10-04T16:30:00.000Z");
	check("addDays crosses months", addDays("2026-09-28", 7) === "2026-10-05");

	// Plans at awkward instants: every group, each group alone, Monday just after midnight, Sunday night.
	const instants = ["2026-10-06T03:00:00Z", "2026-10-04T16:05:00Z", "2026-10-11T15:50:00Z", "2026-12-31T20:00:00Z"].map(Date.parse);
	for (const nowMs of instants) {
		for (const groups of [GROUPS, ["solo"], ["pro"], ["team"], ["agreement"]]) {
			const plan = buildPlan({ runId: "a1b2c3d4", nowMs, groups });
			const problems = validatePlan(plan);
			check(`plan ${groups.join("+")} @ ${new Date(nowMs).toISOString()} is sound${problems.length ? `: ${problems.join("; ")}` : ""}`, problems.length === 0);
			check(`plan ${groups.join("+")} @ ${new Date(nowMs).toISOString()} has nothing in the future`, plan.entries.every((e) => Date.parse(e.end) <= nowMs));
		}
	}
	const full = buildPlan({ runId: "a1b2c3d4", nowMs: instants[0], groups: GROUPS });
	check("10 personas, 9 log in", full.personas.length === 10 && full.personas.filter((p) => p.login).length === 9);
	check("every persona owns a workspace", full.personas.every((p) => full.workspaces.some((w) => w.owner === p.key)));
	check("a flagged sheet exists", full.entries.some((e) => e.minutes >= 600));
	check("the lead cannot open the ops project", !full.projects.find((p) => p.key === "ops").access.some((a) => a.persona === "lead"));
	check("the consultant logs nothing (approver mode)", !full.entries.some((e) => e.persona === "consultant"));
	check("sheet keys", sheetKeyOf(full.entries.find((e) => e.persona === "member")) === "member:w-4:team:delivery");
	check("personal entries have no sheet", sheetKeyOf(full.entries.find((e) => e.persona === "solo")) === null);

	// The manifest scrub and the printed plan never carry a password.
	const printed = [];
	const original = console.log;
	console.log = (...parts) => printed.push(parts.join(" "));
	try {
		printPlan(full);
	} finally {
		console.log = original;
	}
	check("the printed plan has no password", !printed.join("\n").includes("Pw-"));

	if (failures.length) {
		console.error(`self-test: ${failures.length} failure(s)\n  ${failures.join("\n  ")}`);
		return 1;
	}
	console.log("self-test: all checks passed");
	return 0;
}

// ─── main ────────────────────────────────────────────────────────────────────

const HELP = `Usage: node playwright/time/seed-time-personas.mjs [--dry-run] [--teardown [--orphans]] [--only=solo,pro,team,agreement]
       [--replace] [--keep-on-failure] [--backend-env=<file>] [--web-env=<file>] [--api=<origin>] [--manifest=<file>]
       node playwright/time/seed-time-personas.mjs --self-test
Seeds the time E2E personas on the DEV Supabase project only (see the header of this file).`;

export async function main(argv) {
	let args;
	try {
		args = parseArgs(argv);
	} catch (error) {
		if (error instanceof UsageError) {
			console.error(`${error.message}\n\n${HELP}`);
			return 1;
		}
		throw error;
	}
	if (args.help) {
		console.log(HELP);
		return 0;
	}
	if (args.selfTest) return selfTest();

	const cfg = resolveConfig(args);
	const seeding = !args.teardown;
	const guard = checkTargets(cfg, { needApi: seeding, needWeb: seeding, needAnon: seeding });

	if (args.dryRun) {
		console.log("DRY RUN: no network calls, nothing written.\n");
		console.log(`  backend env: ${cfg.backendFile}${cfg.backendFileFound ? "" : " (not found)"}`);
		console.log(`  web env:     ${cfg.webFile}${cfg.webFileFound ? "" : " (not found)"}`);
		console.log(`  manifest:    ${cfg.manifestPath}`);
		printGuard(guard, "\nTarget checks:");
		const existing = readManifest(cfg.manifestPath);
		console.log(`\nManifest: ${existing ? `run ${existing.runId}, ${existing.status}, ${existing.tracked?.length ?? 0} tracked rows, ${existing.users?.length ?? 0} users` : "none"}`);
		if (args.teardown) {
			console.log(existing && existing.status !== "torn_down" ? "Teardown would remove the run above (time_test_cleanup per project, tracked rows newest first, users)." : "Teardown would have nothing to remove from the manifest.");
		} else {
			// A sample id; a live run picks its own.
			const plan = buildPlan({ runId: randomBytes(4).toString("hex"), nowMs: Date.now(), groups: args.only ?? GROUPS });
			console.log("");
			printPlan(plan);
			const problems = validatePlan(plan);
			console.log(problems.length ? `\nPlan problems:\n  ${problems.join("\n  ")}` : "\nPlan checks: sound");
			if (problems.length) return 1;
		}
		console.log(guard.ok ? "\nA live run would proceed." : "\nA live run would be REFUSED.");
		return guard.ok ? 0 : 2;
	}

	if (!guard.ok) {
		printGuard(guard, "REFUSING: this script only runs against the dev Supabase project and a local backend.");
		return 2;
	}
	return args.teardown ? teardownCommand(cfg, args) : seedCommand(cfg, args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main(process.argv.slice(2)).then(
		(code) => {
			process.exitCode = code;
		},
		(error) => {
			console.error(errorText(error));
			process.exitCode = 1;
		},
	);
}
