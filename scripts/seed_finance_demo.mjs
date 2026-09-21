#!/usr/bin/env node
/**
 * Seed a complete marketplace-finance scenario, end to end, through the real API.
 *
 * WHY THROUGH THE API: the engagement graph is written by exactly one thing —
 * the `sign_contract_position_and_activate` RPC, fired when the second party
 * signs a contract that carries two `contract_positions` rows. Inserting
 * engagements with SQL would produce rows that look right and prove nothing.
 * This script signs the contracts for real, as each party, and lets the database
 * open the engagements the way production does.
 *
 * PUBLIC EXPOSURE: none. The seeded client and talent accounts get NO
 * `consultant_profiles` and NO `talent_profiles` row, so they never appear
 * in the public consultant directory or the Find-work board. A private talent
 * contract does not require a public talent listing (see
 * docs/11-domains/marketplace/README.md), so the scenario is complete without
 * one. The consultant seat is your existing verified account.
 *
 * Everything it creates is tagged: demo accounts live on DEMO_EMAIL_DOMAIN and
 * the project title starts with DEMO_TAG. `--teardown` removes exactly that set.
 *
 *   node scripts/seed_finance_demo.mjs            # create
 *   node scripts/seed_finance_demo.mjs --teardown # remove
 *
 * Requires the backend running (default http://localhost:8000) and, in the env,
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY plus the
 * consultant's own login as SEED_CONSULTANT_EMAIL / SEED_CONSULTANT_PASSWORD
 * (PLAYWRIGHT_EMAIL / PLAYWRIGHT_PASSWORD are accepted as a fallback).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

const DEMO_TAG = "[DEMO]";
const DEMO_EMAIL_DOMAIN = "demo.proyekto.test";
const DEMO_PASSWORD = "DemoSeed!2026";

/* ── env ──────────────────────────────────────────────────────────────────── */

function loadEnvFile(file) {
	if (!fs.existsSync(file)) return;
	for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq === -1) continue;
		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		// First value wins, matching the other repo scripts.
		if (process.env[key] === undefined) process.env[key] = value;
	}
}

for (const file of [
	path.join(REPO, "scripts", ".env"),
	path.join(REPO, ".env"),
	path.join(REPO, "backend", ".env"),
	path.join(REPO, "web", ".env"),
]) {
	loadEnvFile(file);
}

const SUPABASE_URL = must("SUPABASE_URL");
const SERVICE_KEY = must("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = must("SUPABASE_ANON_KEY");
const API = process.env.SEED_API_URL ?? "http://localhost:8000";
const CONSULTANT_EMAIL =
	process.env.SEED_CONSULTANT_EMAIL ?? process.env.PLAYWRIGHT_EMAIL;
const CONSULTANT_PASSWORD =
	process.env.SEED_CONSULTANT_PASSWORD ?? process.env.PLAYWRIGHT_PASSWORD;

/**
 * The Client seat. Point this at a REAL Proyekto account and the scenario's
 * outbound mail — the signature-link invitation and every issued invoice —
 * lands in a real inbox, which is the only way to check what the other side
 * actually receives. Falls back to the unreachable demo client if the address
 * has no account.
 */
const CLIENT_ACCOUNT_EMAIL =
	process.env.SEED_CLIENT_EMAIL ?? "juancarlos.gan@prodigitality.net";

function must(name) {
	const value = process.env[name];
	if (!value) {
		console.error(`Missing ${name}. Looked in scripts/.env, .env, backend/.env.`);
		process.exit(1);
	}
	return value;
}

/* ── tiny clients ─────────────────────────────────────────────────────────── */

async function rest(pathname, init = {}) {
	const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
		...init,
		headers: {
			apikey: SERVICE_KEY,
			Authorization: `Bearer ${SERVICE_KEY}`,
			"Content-Type": "application/json",
			Prefer: "return=representation",
			...(init.headers ?? {}),
		},
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`REST ${pathname} → ${res.status} ${text}`);
	return text ? JSON.parse(text) : null;
}

async function adminAuth(pathname, init = {}) {
	const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/${pathname}`, {
		...init,
		headers: {
			apikey: SERVICE_KEY,
			Authorization: `Bearer ${SERVICE_KEY}`,
			"Content-Type": "application/json",
			...(init.headers ?? {}),
		},
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`ADMIN ${pathname} → ${res.status} ${text}`);
	return text ? JSON.parse(text) : null;
}

async function signIn(email, password) {
	const res = await fetch(
		`${SUPABASE_URL}/auth/v1/token?grant_type=password`,
		{
			method: "POST",
			headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
			body: JSON.stringify({ email, password }),
		},
	);
	const body = await res.json();
	if (!res.ok) {
		throw new Error(`Sign-in failed for ${email}: ${JSON.stringify(body)}`);
	}
	return { token: body.access_token, userId: body.user.id };
}

async function api(token, method, pathname, body) {
	const res = await fetch(`${API}${pathname}`, {
		method,
		headers: {
			// `null` is the public, token-bearer case (the client signing route).
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			"Content-Type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await res.text();
	if (!res.ok) {
		throw new Error(`${method} ${pathname} → ${res.status} ${text}`);
	}
	const parsed = text ? JSON.parse(text) : null;
	// The global ResponseInterceptor wraps everything in { data: … }.
	return parsed && typeof parsed === "object" && "data" in parsed
		? parsed.data
		: parsed;
}

const log = (...args) => console.log(...args);

/* ── the cast ─────────────────────────────────────────────────────────────── */

const PEOPLE = [
	{
		key: "client",
		email: `demo.client.aurora@${DEMO_EMAIL_DOMAIN}`,
		name: "Alina Reyes",
		company: "Aurora Retail Group",
	},
	{
		key: "designer",
		email: `demo.talent.mika@${DEMO_EMAIL_DOMAIN}`,
		name: "Mika Villanueva",
	},
	{
		key: "developer",
		email: `demo.talent.noel@${DEMO_EMAIL_DOMAIN}`,
		name: "Noel Santos",
	},
];

/* ── teardown ─────────────────────────────────────────────────────────────── */

/**
 * Remove everything the seed created.
 *
 * Driven from the demo ACCOUNTS, not from the demo project: the client
 * engagement is raised on a `flexible` contract, which by definition carries no
 * project_id. An earlier project-only sweep left those contracts and their
 * engagements behind, and the orphans then blocked the user delete on
 * engagement_parties_user_id_fkey.
 */
async function teardown() {
	log("Tearing down demo data…");

	const users = await adminAuth("users?per_page=200");
	const demoUsers = (users.users ?? []).filter((u) =>
		String(u.email ?? "").endsWith(`@${DEMO_EMAIL_DOMAIN}`),
	);
	const userIds = demoUsers.map((u) => u.id);
	const inList = (ids) => `(${ids.join(",")})`;

	const projects = await rest(
		`projects?select=id&title=like.${encodeURIComponent(`${DEMO_TAG}%`)}`,
	);
	const projectIds = projects.map((p) => p.id);

	// Every contract a demo account holds a seat on, plus anything scoped to a
	// demo project.
	const contractIds = new Set();
	if (userIds.length > 0) {
		const positions = await rest(
			`contract_positions?select=contract_id&user_id=in.${inList(userIds)}`,
		);
		for (const row of positions) contractIds.add(row.contract_id);
	}
	for (const id of projectIds) {
		const rows = await rest(`contracts?select=id&project_id=eq.${id}`);
		for (const row of rows) contractIds.add(row.id);
	}

	const engagementIds = new Set();
	if (userIds.length > 0) {
		const parties = await rest(
			`engagement_parties?select=engagement_id&user_id=in.${inList(userIds)}`,
		);
		for (const row of parties) engagementIds.add(row.engagement_id);
	}

	log(
		`  ${projectIds.length} project(s) · ${contractIds.size} contract(s) · ${engagementIds.size} engagement(s) · ${demoUsers.length} account(s)`,
	);

	for (const id of projectIds) {
		await rest(`invoices?project_id=eq.${id}`, { method: "DELETE" });
		await rest(`task_time_logs?project_id=eq.${id}`, { method: "DELETE" });
	}
	for (const id of contractIds) {
		await rest(`invoices?contract_id=eq.${id}`, { method: "DELETE" });
	}

	for (const eid of engagementIds) {
		for (const table of [
			"engagement_time_rates",
			"engagement_time_settings",
			"engagement_project_links",
			"engagement_assignments",
		]) {
			await rest(`${table}?engagement_id=eq.${eid}`, { method: "DELETE" });
		}
	}
	// engagements RESTRICT their activating contract, and contracts point back at
	// the engagement: break the back-reference before dropping either side.
	for (const id of contractIds) {
		await rest(`contracts?id=eq.${id}`, {
			method: "PATCH",
			body: JSON.stringify({ engagement_id: null }),
		});
	}
	for (const eid of engagementIds) {
		await rest(`engagement_parties?engagement_id=eq.${eid}`, {
			method: "DELETE",
		});
		await rest(`engagements?id=eq.${eid}`, { method: "DELETE" });
	}
	for (const id of contractIds) {
		await rest(`contracts?id=eq.${id}`, { method: "DELETE" });
	}
	for (const id of projectIds) {
		await rest(`projects?id=eq.${id}`, { method: "DELETE" });
	}
	for (const user of demoUsers) {
		await rest(`profiles?id=eq.${user.id}`, { method: "DELETE" });
		await adminAuth(`users/${user.id}`, { method: "DELETE" });
	}
	log("Teardown complete.");
}

/* ── seed ─────────────────────────────────────────────────────────────────── */

async function ensureUser(person) {
	const existing = await rest(
		`profiles?select=id&email=eq.${encodeURIComponent(person.email)}`,
	);
	if (existing.length > 0) return existing[0].id;

	const created = await adminAuth("users", {
		method: "POST",
		body: JSON.stringify({
			email: person.email,
			password: DEMO_PASSWORD,
			email_confirm: true,
			user_metadata: { full_name: person.name },
		}),
	});
	// `profiles` is NOT written by a trigger on auth.users — the app materialises
	// it during first sign-in. Every identity snapshot on a contract and an
	// engagement is copied from this row, so the seed must create it up front or
	// contract creation fails with "Proyekto account not found".
	const [first, ...surname] = person.name.split(" ");
	await rest("profiles", {
		method: "POST",
		headers: { Prefer: "resolution=merge-duplicates,return=representation" },
		body: JSON.stringify({
			id: created.id,
			email: person.email,
			display_name: person.name,
			first_name: first,
			last_name: surname.join(" ") || null,
			is_email_verified: true,
			has_completed_onboarding: true,
		}),
	});
	return created.id;
}

/** ISO date for the first day of a month N months before this one. */
function monthStart(monthsAgo) {
	const now = new Date();
	const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
	return d.toISOString().slice(0, 10);
}

function monthEnd(monthsAgo) {
	const now = new Date();
	const d = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo + 1, 0),
	);
	return d.toISOString().slice(0, 10);
}

function addDays(iso, days) {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

async function seed() {
	if (!CONSULTANT_EMAIL || !CONSULTANT_PASSWORD) {
		console.error(
			"Set SEED_CONSULTANT_EMAIL / SEED_CONSULTANT_PASSWORD (or PLAYWRIGHT_EMAIL / PLAYWRIGHT_PASSWORD).",
		);
		process.exit(1);
	}

	log("1/7  Signing in as the consultant…");
	const consultant = await signIn(CONSULTANT_EMAIL, CONSULTANT_PASSWORD);

	log("2/7  Creating demo accounts (no marketplace enrollment)…");
	const ids = {};
	for (const person of PEOPLE) {
		ids[person.key] = await ensureUser(person);
		log(`     ${person.name} <${person.email}>`);
	}
	const sessions = {};
	for (const person of PEOPLE) {
		sessions[person.key] = await signIn(person.email, DEMO_PASSWORD);
	}

	// Prefer a real account for the Client seat so the emails are checkable.
	const realClient = await rest(
		`profiles?select=id,email,display_name&email=eq.${encodeURIComponent(CLIENT_ACCOUNT_EMAIL)}`,
	);
	const clientIsReal = realClient.length > 0;
	const clientId = clientIsReal ? realClient[0].id : ids.client;
	const clientEmail = clientIsReal ? realClient[0].email : PEOPLE[0].email;
	const clientName = clientIsReal
		? (realClient[0].display_name ?? "Aurora Retail Group")
		: PEOPLE[0].name;
	log(
		clientIsReal
			? `     Client seat → ${clientEmail} (real account; mail will be delivered)`
			: `     Client seat → ${clientEmail} (demo account; mail cannot be delivered)`,
	);

	log("3/7  Creating the project…");
	// Consultant mode only accepts `draft` at creation; activation is a
	// separate transition, so the seed makes it the same way a person would.
	const created = await api(consultant.token, "POST", "/api/projects", {
		creation_mode: "consultant",
		title: `${DEMO_TAG} Aurora Retail — Commerce Replatform`,
		description:
			"Demo scenario: one client engagement funding two talent engagements.",
		currency: "PHP",
	});
	// This endpoint nests its payload one level deeper than the rest.
	const project = created.project ?? created;
	await api(consultant.token, "PATCH", `/api/projects/${project.id}`, {
		status: "active",
	});
	log(`     ${project.title} (${project.id})`);

	// Project-scoped, which is the shape that gives the project its own signed
	// agreement: it puts a contract_scope link on the engagement (so the project
	// filter finds it) and lets invoices draw provenance from the contract.
	// The talent agreements below stay flexible on purpose — one specialist
	// working across several projects is the case that shape exists for.
	log("4/7  Client engagement — contract, terms, two signatures…");
	const clientContract = await api(consultant.token, "POST", "/api/contracts", {
		project_id: project.id,
		relationship_kind: "client_services",
		scope_mode: "project_specific",
		counterparty_user_id: clientId,
	});
	await api(consultant.token, "PATCH", `/api/contracts/${clientContract.id}`, {
		currency: "PHP",
		billing_mode: "retainer",
		recurring_fee: 120000,
		invoice_cadence: "monthly",
		billing_timing: "arrears",
		due_days: 15,
		invoice_number_prefix: "AUR",
		service_start_date: monthStart(5),
		term_count: 12,
		term_unit: "month",
		client_name: "Aurora Retail Group",
		client_contact_name: clientName,
		client_email: clientEmail,
		client_address: "12F One Bonifacio High Street, Taguig",
		payment_method: "Bank transfer",
		service_description: "Commerce replatform — retained delivery team",
		time_tracking_mode: "required",
		// Timesheet approval is a TALENT-side control: the provider submits and
		// the hirer approves. A client contract is rejected if it carries one.
		time_approval_mode: "none",
		client_hours_detail_level: "summary",
	});
	// The consultant signs in the app; the CLIENT signs the way a real client
	// does — through a tokenized link mailed to them. That exercises the whole
	// send-for-signature path instead of faking the counterparty's session, and
	// it is the only route available when the Client seat is an account whose
	// password the seed does not hold.
	await api(consultant.token, "POST", `/api/contracts/${clientContract.id}/sign`, {
		position: "provider",
		signer_name: "Juan Carlos Gan",
	});
	const signingLink = await api(
		consultant.token,
		"POST",
		`/api/contracts/${clientContract.id}/signature-link`,
		{ recipient_email: clientEmail, send_email: true, expires_in_days: 14 },
	);
	log(`     sent for signature → ${clientEmail}`);
	if (signingLink?.email_delivery) {
		log(
			`       mail: ${signingLink.email_delivery.sent ? "delivered" : `NOT sent — ${signingLink.email_delivery.reason ?? "unknown"}`}`,
		);
	}
	// The summary returns the signing URL, never the bare token — the token is
	// the credential, so it is only ever handed out inside the link itself.
	const signingToken = String(signingLink.url).split("/").pop();
	await api(null, "POST", `/api/contracts/sign/${signingToken}`, {
		signer_name: clientName,
	});
	log("     client signed via link → engagement opened");

	log("5/7  Talent engagements — two contracts, four signatures…");
	const talent = [
		{
			key: "designer",
			name: "Mika Villanueva",
			rate: 900,
			role: "Product designer",
		},
		{
			key: "developer",
			name: "Noel Santos",
			rate: 1250,
			role: "Senior engineer",
		},
	];
	for (const person of talent) {
		const contract = await api(consultant.token, "POST", "/api/contracts", {
			relationship_kind: "talent_services",
			scope_mode: "flexible",
			counterparty_user_id: ids[person.key],
		});
		await api(consultant.token, "PATCH", `/api/contracts/${contract.id}`, {
			currency: "PHP",
			// `time_based` is the hourly mode; the RPC reads client_hourly_rate for
			// it and projects a `cost` rate onto the Talent provider.
			billing_mode: "time_based",
			client_hourly_rate: person.rate,
			service_start_date: monthStart(5),
			term_count: 12,
			term_unit: "month",
			service_description: person.role,
			provider_name: person.name,
			time_tracking_mode: "required",
			time_approval_mode: "provider_submit_hirer_approve",
			client_hours_detail_level: "none",
		});
		// talent_services: hirer = Consultant, provider = Talent.
		await signBoth(contract.id, consultant, sessions[person.key], {
			consultantPosition: "hirer",
			consultantName: "Juan Carlos Gan",
			counterpartyPosition: "provider",
			counterpartyName: person.name,
		});
		log(`     ${person.name} @ PHP ${person.rate}/hr → engagement opened`);
	}

	log("5b/7 A second client agreement, left awaiting signature…");
	// One contract deliberately stops at "sent". It gives the Contracts tab a
	// non-terminal row to look at, and it leaves a live signing link in the
	// client's inbox that can actually be clicked.
	const pendingContract = await api(consultant.token, "POST", "/api/contracts", {
		relationship_kind: "client_services",
		scope_mode: "flexible",
		counterparty_user_id: clientId,
	});
	// Flexible on purpose: a second agreement that covers the relationship
	// rather than this one project, so the list shows both scopes side by side.
	await api(consultant.token, "PATCH", `/api/contracts/${pendingContract.id}`, {
		currency: "PHP",
		billing_mode: "fixed",
		fixed_fee: 480000,
		service_start_date: monthStart(-1),
		term_count: 6,
		term_unit: "month",
		client_name: "Aurora Retail Group",
		client_contact_name: clientName,
		client_email: clientEmail,
		service_description: "Phase 2 — loyalty programme build",
		time_tracking_mode: "optional",
		time_approval_mode: "none",
		client_hours_detail_level: "none",
	});
	// The provider signs first, then sends. That is the real order, and it is
	// also what moves the contract to `sent` — creating a signature link on its
	// own leaves it reading "Draft" in the list while the client already has it.
	await api(consultant.token, "POST", `/api/contracts/${pendingContract.id}/sign`, {
		position: "provider",
		signer_name: "Juan Carlos Gan",
	});
	const pendingLink = await api(
		consultant.token,
		"POST",
		`/api/contracts/${pendingContract.id}/signature-link`,
		{ recipient_email: clientEmail, send_email: true, expires_in_days: 14 },
	);
	log(`     Phase 2 sent for signature → ${clientEmail}`);
	if (pendingLink?.email_delivery) {
		log(
			`       mail: ${pendingLink.email_delivery.sent ? "delivered" : `NOT sent — ${pendingLink.email_delivery.reason ?? "unknown"}`}`,
		);
	}

	log("6/7  Six months of delivery cost (approved time logs)…");
	const teamRows = await rest(
		`project_teams?select=team_id&project_id=eq.${project.id}`,
	);
	const teamId = teamRows[0]?.team_id ?? null;
	const logs = [];
	for (let m = 5; m >= 0; m--) {
		for (const person of talent) {
			// Sized so delivery cost lands around 55-65% of the 120k monthly
			// retainer — a believable agency margin. Varied per month so the chart
			// has a shape rather than a plateau.
			const hours = 22 + ((m * 5 + person.rate) % 13);
			// A log is a real window: ended_at must actually follow started_at, so
			// spread the month's hours forward from the first of the month.
			const startedAt = new Date(`${monthStart(m)}T09:00:00Z`);
			const endedAt = new Date(startedAt.getTime() + hours * 3600 * 1000);
			logs.push({
				project_id: project.id,
				team_id: teamId,
				member_user_id: ids[person.key],
				member_display_name_snapshot: person.name,
				started_at: startedAt.toISOString(),
				ended_at: endedAt.toISOString(),
				duration_seconds: hours * 3600,
				status: "approved",
				source: "manual",
				reviewed_by: consultant.userId,
				reviewed_at: `${monthEnd(m)}T12:00:00Z`,
				rate_snapshot: person.rate,
				currency_snapshot: "PHP",
				work_type_snapshot: "real_work",
				rate_type_snapshot: "hourly",
			});
		}
	}
	await rest("task_time_logs", {
		method: "POST",
		body: JSON.stringify(logs),
	});
	log(`     ${logs.length} approved logs`);

	log("7/7  Six months of client invoices, with real payment history…");
	const invoices = [];
	for (let m = 5; m >= 0; m--) {
		const periodStart = monthStart(m);
		const periodEnd = monthEnd(m);
		const issueDate = addDays(periodEnd, 1);
		const invoice = await api(consultant.token, "POST", "/api/invoices", {
			project_id: project.id,
			currency: "PHP",
			// An invoice cannot be issued without someone to reach. The client is a
			// real Proyekto account, so link it rather than relying on loose
			// bill-to text. (The demo domain is a reserved TLD, so the delivery
			// attempt fails harmlessly and never reaches a real inbox.)
			recipient_user_id: clientId,
			issue_date: issueDate,
			due_date: addDays(issueDate, 15),
			period_start: periodStart,
			period_end: periodEnd,
			notes: "Thank you for your business.",
			line_items: [
				{
					description: `Retained delivery — ${periodStart} to ${periodEnd}`,
					quantity: 1,
					unit_rate: 120000,
				},
			],
		});
		invoices.push({ ...invoice, monthsAgo: m });
	}

	// Issue everything but the newest, then settle the history: the three oldest
	// paid in full, the fourth part-paid, the fifth left to go overdue. That
	// gives the ageing bands, the collection rate and the overdue banner
	// something true to render.
	let mailed = 0;
	let mailFailure = null;
	for (const invoice of invoices) {
		if (invoice.monthsAgo === 0) continue;
		const issued = await api(
			consultant.token,
			"POST",
			`/api/invoices/${invoice.id}/issue`,
			{},
		);
		// Issuing is best-effort about email: the invoice is already issued by the
		// time delivery runs, and the outcome rides back on the response.
		if (issued?.email_delivery?.sent) mailed += 1;
		else if (issued?.email_delivery?.reason) {
			mailFailure = issued.email_delivery.reason;
		}
	}
	let partialBlocked = false;
	for (const invoice of invoices) {
		const { monthsAgo } = invoice;
		if (monthsAgo >= 3) {
			await api(
				consultant.token,
				"POST",
				`/api/invoices/${invoice.id}/payments`,
				{
					amount: 120000,
					payment_date: addDays(monthEnd(monthsAgo), 10),
					payment_method: "Bank transfer",
					reference: `TT-${monthsAgo}`,
				},
			);
		} else if (monthsAgo === 2) {
			// A PARTIAL payment drives the invoice to `partially_paid`, which the
			// production CHECK on invoices.status still rejects (see migration
			// 20260818120000_align_invoice_status_check.sql). Until that is
			// applied, note it and carry on rather than failing the whole seed.
			try {
				await api(
					consultant.token,
					"POST",
					`/api/invoices/${invoice.id}/payments`,
					{
						amount: 45000,
						payment_date: addDays(monthEnd(monthsAgo), 12),
						payment_method: "Bank transfer",
						reference: "TT-partial",
					},
				);
			} catch (error) {
				if (!String(error.message).includes("invoices_status_check")) throw error;
				partialBlocked = true;
			}
		}
	}
	log(
		`     ${invoices.length} invoices · 3 paid · ${partialBlocked ? "0" : "1"} part-paid · 1 overdue · 1 draft`,
	);
	log(
		`     ${mailed} invoice email(s) delivered to ${clientEmail}` +
			(mailFailure ? ` · last failure: ${mailFailure}` : ""),
	);
	if (partialBlocked) {
		log("");
		log("     ! Partial payment REJECTED by the database.");
		log("       invoices.status still forbids 'partially_paid' here. Apply");
		log("       supabase/migrations/20260818120000_align_invoice_status_check.sql");
		log("       then re-seed to get the part-paid invoice.");
	}

	log("");
	log("Done. Open:");
	log(`  ${process.env.CLIENT_URL ?? "http://localhost:3000"}/engagements/finance`);
	log(`  …?tab=overview&projectId=${project.id}`);
	log("");
	log(`Demo logins: <name>@${DEMO_EMAIL_DOMAIN} / ${DEMO_PASSWORD}`);
	log("Remove everything with: node scripts/seed_finance_demo.mjs --teardown");
}

/**
 * Both signatures, in order. The engagement is written by the SECOND one — the
 * RPC only builds the graph once every position on the contract is signed.
 */
async function signBoth(contractId, consultant, counterparty, names) {
	// A positioned contract needs to be told WHICH seat is signing — the caller's
	// identity alone is not taken as the answer.
	await api(consultant.token, "POST", `/api/contracts/${contractId}/sign`, {
		position: names.consultantPosition,
		signer_name: names.consultantName,
	});
	await api(counterparty.token, "POST", `/api/contracts/${contractId}/sign`, {
		position: names.counterpartyPosition,
		signer_name: names.counterpartyName,
	});
}

/* ── main ─────────────────────────────────────────────────────────────────── */

const wantsTeardown = process.argv.includes("--teardown");
try {
	if (wantsTeardown) await teardown();
	else await seed();
} catch (error) {
	console.error(`\n${error.message}`);
	process.exit(1);
}
