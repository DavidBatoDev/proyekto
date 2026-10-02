#!/usr/bin/env node
/**
 * Idempotent DEV seed: one project with project finance and realistic data.
 *
 *   node scripts/seed_dev_project_finance.mjs
 *
 * Creates (or refreshes) under the demo team "JC Studio" (owner
 * consultant@demo.proyekto.test):
 *   - project "Harbor Coffee — Rebrand (seed)", attached to the team
 *   - a signed client_services retainer contract with Alina Reyes (client)
 *   - a project finance book under JC Studio's team book
 *   - invoices: paid, partially paid, overdue, draft, and one imported
 *     (origin 'imported', backed by an uploaded document)
 *   - imported documents (an invoice PDF and a bank proof of payment), uploaded
 *     through the running backend so the bytes land in the private bucket
 *   - three weeks of time logs for the owner and Mika (approved and pending)
 *   - project expenses (a monthly subscription, a contractor, fees)
 *
 * DEV ONLY. Reads backend/.env.development.local and web/.env.development.local
 * and refuses unless SUPABASE_URL is the dev project. Every row has a fixed id
 * and is upserted, so re-running converges instead of duplicating. Documents
 * are matched by file name. If the backend (http://localhost:8001 by default,
 * override with SEED_API_URL) is not running, documents and the imported
 * invoice are skipped with a warning.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEV_REF = "vyiedlwasdwmjbztqznl";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "backend", "package.json"));
const { Client } = require("pg");

function readEnv(file) {
	return Object.fromEntries(
		readFileSync(file, "utf8")
			.split(/\r?\n/)
			.filter((line) => /^[A-Z_]+=/.test(line))
			.map((line) => {
				const index = line.indexOf("=");
				return [
					line.slice(0, index),
					line.slice(index + 1).replace(/^["']|["']$/g, ""),
				];
			}),
	);
}

const backendEnv = readEnv(path.join(root, "backend", ".env.development.local"));
const webEnv = readEnv(path.join(root, "web", ".env.development.local"));
if (!backendEnv.SUPABASE_URL?.includes(DEV_REF)) {
	console.error("REFUSING: backend/.env.development.local is not the DEV project");
	process.exit(2);
}
if (!webEnv.VITE_SUPABASE_URL?.includes(DEV_REF)) {
	console.error("REFUSING: web/.env.development.local is not the DEV project");
	process.exit(2);
}

// ─── fixed identities (DEV) ────────────────────────────────────────────────
const OWNER = "36e5b231-086a-458b-8911-ab8d4eb4781d"; // consultant@demo (Dev Consultant)
const OWNER_EMAIL = "consultant@demo.proyekto.test";
const OWNER_PASSWORD = process.env.SEED_PASSWORD ?? "DemoSeed!2026";
const CLIENT = "31150e25-1c7f-4fe9-b6d3-a0b076bce2d2"; // Alina Reyes
const MIKA = "34a192cd-f1ea-4eda-93d5-48b73387d08e"; // Mika Villanueva (JC member)
const TEAM = "801465b6-be13-4dd4-949f-c6b88204645f"; // JC Studio
const TEAM_BOOK = "eff1d0d4-f854-49eb-8936-36bcb21c0b82";
const WORKSPACE = "a75b5cc6-70f0-4c42-b20e-5f463d6c628b";

// Seed-owned rows: a fixed prefix so they are recognisable and stable.
const id = (suffix) => `5eed0000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const PROJECT = id("1");
const CONTRACT = id("2");
const PROJECT_BOOK = id("3");
const PROJECT_TITLE = "Harbor Coffee — Rebrand (seed)";
const CURRENCY = "PHP";

const today = new Date();
const isoDate = (offsetDays) => {
	const date = new Date(today);
	date.setUTCDate(date.getUTCDate() + offsetDays);
	return date.toISOString().slice(0, 10);
};
const isoAt = (offsetDays, hour) => `${isoDate(offsetDays)}T${String(hour).padStart(2, "0")}:00:00Z`;

async function main() {
	const db = new Client({
		host: "aws-0-ap-southeast-1.pooler.supabase.com",
		port: 5432,
		user: `postgres.${DEV_REF}`,
		password: backendEnv.SUPABASE_DB_PASSWORD,
		database: "postgres",
		ssl: { rejectUnauthorized: false },
	});
	await db.connect();
	try {
		await db.query("begin");
		await seedCore(db);
		await db.query("commit");
		console.log("core rows seeded");
	} catch (error) {
		await db.query("rollback");
		throw error;
	}

	const documents = await seedDocuments().catch((error) => {
		console.warn(`documents skipped: ${error.message}`);
		return null;
	});
	if (documents) {
		await seedImportedInvoice(db, documents);
		console.log("imported invoice seeded");
	}
	await db.end();
	console.log(
		`done — open /engagements/finance/team/${TEAM}/project/${PROJECT_BOOK} as ${OWNER_EMAIL}`,
	);
}

async function seedCore(db) {
	await db.query(
		`insert into projects (id, title, status, owner_id, workspace_id, primary_team_id, currency)
		 values ($1, $2, 'active', $3, $4, $5, $6)
		 on conflict (id) do update set title = excluded.title, currency = excluded.currency`,
		[PROJECT, PROJECT_TITLE, OWNER, WORKSPACE, TEAM, CURRENCY],
	);
	await db.query(
		`insert into project_teams (project_id, team_id, is_primary, attached_by)
		 values ($1, $2, true, $3) on conflict do nothing`,
		[PROJECT, TEAM, OWNER],
	);
	await db.query(
		`insert into project_access (project_id, user_id, role, origin, has_direct_grant, granted_by)
		 select $1, $2, 'owner', 'direct', true, $2
		 where not exists (select 1 from project_access where project_id = $1 and user_id = $2)`,
		[PROJECT, OWNER],
	);
	// Mika logs time below. The database refuses a time log from someone with
	// no access to the project (time rebuild M1), so grant it and curate Mika
	// onto the team for this project.
	await db.query(
		`insert into project_access (project_id, user_id, role, origin, has_direct_grant, granted_by)
		 select $1, $2, 'editor', 'direct', true, $3
		 where not exists (select 1 from project_access where project_id = $1 and user_id = $2)`,
		[PROJECT, MIKA, OWNER],
	);
	await db.query(
		`insert into project_team_members (project_id, team_id, user_id, added_by)
		 select $1, $2, $3, $4
		 where exists (select 1 from team_members where team_id = $2 and user_id = $3)
		 on conflict do nothing`,
		[PROJECT, TEAM, MIKA, OWNER],
	);

	// A signed monthly retainer: PHP 85,000 for 40 hours, PHP 2,400/h overage.
	await db.query(
		`insert into contracts (
		   id, project_id, version, contract_number, status, relationship_kind,
		   provider_kind, provider_name, provider_email, client_kind, client_name,
		   client_contact_name, client_email, client_user_id, consultant_user_id,
		   currency, billing_mode, billing_timing, recurring_fee, client_hourly_rate,
		   included_hours, invoice_cadence, period_source, due_days,
		   invoice_number_prefix, service_description, payment_method,
		   service_start_date, term_count, term_unit, scope_mode,
		   time_tracking_mode, client_hours_detail_level, document_title,
		   project_title_snapshot, created_by, workspace_id, revision
		 ) values (
		   $1, $2, 1, 'SEED-CTR-001', 'signed', 'client_services',
		   'agency', 'JC Studio', 'consultant@demo.proyekto.test', 'company', 'Harbor Coffee Co.',
		   'Alina Reyes', 'demo.client.aurora@demo.proyekto.test', $3, $4,
		   $5, 'retainer', 'arrears', 85000, 2400,
		   40, 'monthly', 'contract', 15,
		   'HCR', 'Brand identity refresh, packaging system, and launch site.', 'Bank transfer',
		   $6, 6, 'month', 'project_specific',
		   'required', 'summary', 'Harbor Coffee — Services Agreement',
		   $7, $4, $8, 1
		 )
		 on conflict (id) do update set status = 'signed', project_id = excluded.project_id`,
		[CONTRACT, PROJECT, CLIENT, OWNER, CURRENCY, isoDate(-75), PROJECT_TITLE, WORKSPACE],
	);
	for (const [position, capacity, userId, name, email] of [
		["provider", "consultant", OWNER, "Dev Consultant", OWNER_EMAIL],
		["hirer", "client", CLIENT, "Alina Reyes", "demo.client.aurora@demo.proyekto.test"],
	]) {
		await db.query(
			`insert into contract_positions (contract_id, position, user_id, capacity,
			   display_name_snapshot, email_snapshot, signer_name, signed_at, signed_revision)
			 select $1, $2, $3, $4, $5, $6, $5, $7, 1
			 where not exists (select 1 from contract_positions where contract_id = $1 and position = $2)`,
			[CONTRACT, position, userId, capacity, name, email, `${isoDate(-76)}T09:00:00Z`],
		);
	}

	await db.query(
		`insert into finance_books (id, kind, owner_kind, owner_team_id, parent_book_id, project_id, currency, status, created_by)
		 values ($1, 'project', 'team', $2, $3, $4, $5, 'active', $6)
		 on conflict (id) do update set status = 'active'`,
		[PROJECT_BOOK, TEAM, TEAM_BOOK, PROJECT, CURRENCY, OWNER],
	);

	// Invoices: status, issue offset, due offset, total, amount paid.
	const invoices = [
		["11", "HCR-0001", "paid", -70, -55, 85000, 85000],
		["12", "HCR-0002", "paid", -40, -25, 94600, 94600],
		["13", "HCR-0003", "partially_paid", -25, -10, 89800, 40000],
		["14", "HCR-0004", "issued", -20, -5, 85000, 0],
		["15", "HCR-0005", "draft", 0, 15, 87400, 0],
	];
	for (const [suffix, number, status, issued, due, total, paid] of invoices) {
		const invoiceId = id(suffix);
		const periodStart = isoDate(issued - 30);
		const periodEnd = isoDate(issued - 1);
		await db.query(
			`insert into invoices (id, project_id, contract_id, issuer_user_id, recipient_user_id,
			   number, status, currency, issue_date, due_date, subtotal, total,
			   issued_at, sent_at, paid_at, period_start, period_end, origin,
			   hours_detail_level, payment_method, project_title_snapshot, bill_to, issued_by)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11,
			   case when $7 = 'draft' then null else ($9::date)::timestamptz end,
			   case when $7 = 'draft' then null else ($9::date)::timestamptz end,
			   case when $7 = 'paid' then ($10::date - 3)::timestamptz else null end,
			   $12, $13, 'scheduled', 'summary', 'Bank transfer', $14,
			   jsonb_build_object('name', 'Harbor Coffee Co.', 'contact', 'Alina Reyes'),
			   jsonb_build_object('name', 'JC Studio'))
			 on conflict (id) do update set status = excluded.status, total = excluded.total,
			   subtotal = excluded.subtotal, issue_date = excluded.issue_date, due_date = excluded.due_date`,
			[
				invoiceId, PROJECT, CONTRACT, OWNER, CLIENT, number, status, CURRENCY,
				isoDate(issued), isoDate(due), total, periodStart, periodEnd, PROJECT_TITLE,
			],
		);
		const overage = total - 85000;
		const lines = [["retainer", "Monthly retainer — 40 hours included", 1, 85000]];
		if (overage > 0) {
			lines.push(["overage", "Additional hours beyond the retainer", overage / 2400, 2400]);
		}
		await db.query("delete from invoice_line_items where invoice_id = $1", [invoiceId]);
		for (const [index, [source, description, quantity, rate]] of lines.entries()) {
			await db.query(
				`insert into invoice_line_items (invoice_id, source_type, description, quantity, unit_rate, amount, position)
				 values ($1, $2, $3, $4, $5, $6, $7)`,
				[invoiceId, source, description, quantity, rate, quantity * rate, index],
			);
		}
		if (paid > 0) {
			await db.query(
				`insert into invoice_payments (id, invoice_id, amount, payment_date, payment_method, reference, recorded_by)
				 values ($1, $2, $3, $4, 'Bank transfer', $5, $6)
				 on conflict (id) do update set amount = excluded.amount`,
				[id(`${suffix}1`), invoiceId, paid, isoDate(due - 3), `BPI-${number}`, OWNER],
			);
		}
	}

	// Three weeks of time: weekdays, owner and Mika, older weeks approved.
	let logIndex = 0;
	for (let day = -21; day <= -1; day += 1) {
		const weekday = new Date(`${isoDate(day)}T00:00:00Z`).getUTCDay();
		if (weekday === 0 || weekday === 6) continue;
		for (const [userId, name, hours, rate] of [
			[OWNER, "Dev Consultant", 3, 1500],
			[MIKA, "Mika Villanueva", 5, 650],
		]) {
			logIndex += 1;
			const status = day < -7 ? "approved" : "pending";
			await db.query(
				`insert into task_time_logs (id, project_id, team_id, member_user_id, member_display_name_snapshot,
				   started_at, ended_at, duration_seconds, status, source, rate_snapshot, currency_snapshot,
				   rate_type_snapshot, work_type_snapshot, reviewed_by, reviewed_at)
				 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'timer', $10, $11, 'hourly', 'real_work',
				   case when $9 = 'approved' then $12::uuid else null end,
				   case when $9 = 'approved' then $7::timestamptz else null end)
				 on conflict (id) do update set status = excluded.status`,
				[
					id(`7${String(logIndex).padStart(3, "0")}`), PROJECT, TEAM, userId, name,
					isoAt(day, 1), isoAt(day, 1 + hours), hours * 3600, status, rate, CURRENCY, OWNER,
				],
			);
		}
	}

	// Money out on this project.
	const expenses = [
		["81", "software_subscription", "Figma Professional — 2 seats", "Figma", 1650, -60, "monthly"],
		["82", "contractor", "Packaging illustrations", "Ria Santos (freelance)", 18000, -35, "none"],
		["83", "tax_fees", "Bank transfer fees", "BPI", 450, -24, "none"],
		["84", "other", "Print proofs for packaging", "Printhaus Manila", 3200, -12, "none"],
	];
	for (const [suffix, category, description, vendor, amount, when, recurrence] of expenses) {
		await db.query(
			`insert into finance_expenses (id, team_id, book_id, project_id, category, description, vendor,
			   amount, currency, incurred_on, recurrence, created_by)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			 on conflict (id) do update set amount = excluded.amount, voided_at = null`,
			[id(suffix), TEAM, PROJECT_BOOK, PROJECT, category, description, vendor, amount, CURRENCY, isoDate(when), recurrence, OWNER],
		);
	}
}

// ─── documents (through the API, so the bytes reach the private bucket) ───

/** A one-page PDF with the given lines of text, with a correct xref table. */
function makePdf(lines) {
	const text = lines
		.map((line, index) => `BT /F1 ${index === 0 ? 18 : 11} Tf 60 ${760 - index * 22} Td (${line.replace(/[()\\]/g, "")}) Tj ET`)
		.join("\n");
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
		`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	let body = "%PDF-1.4\n";
	const offsets = [];
	objects.forEach((object, index) => {
		offsets.push(Buffer.byteLength(body));
		body += `${index + 1} 0 obj\n${object}\nendobj\n`;
	});
	const xref = Buffer.byteLength(body);
	body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
	body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(body);
}

async function seedDocuments() {
	const apiUrl = process.env.SEED_API_URL ?? "http://localhost:8001";
	const auth = await fetch(
		`${webEnv.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`,
		{
			method: "POST",
			headers: { apikey: webEnv.VITE_SUPABASE_ANON_KEY, "Content-Type": "application/json" },
			body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
		},
	);
	if (!auth.ok) throw new Error(`sign-in failed (${auth.status})`);
	const { access_token: token } = await auth.json();
	const headers = { Authorization: `Bearer ${token}` };

	const unwrap = (json) => json?.data ?? json;
	const existingResponse = await fetch(
		`${apiUrl}/api/finance-imports/documents?project_id=${PROJECT}`,
		{ headers },
	);
	if (!existingResponse.ok) throw new Error(`backend not reachable (${existingResponse.status})`);
	const existing = unwrap(await existingResponse.json()) ?? [];

	const wanted = [
		{
			file: "HCR-0000-launch-deposit.pdf",
			kind: "invoice",
			lines: [
				"INVOICE HCR-0000",
				"JC Studio  ->  Harbor Coffee Co.",
				`Issue date: ${isoDate(-90)}    Due date: ${isoDate(-75)}`,
				"Launch deposit - brand discovery workshop",
				"Total due: PHP 45,000.00",
				"Pay by bank transfer to BPI 1234-5678-90",
			],
		},
		{
			file: "bpi-credit-advice-HCR-0000.pdf",
			kind: "payment_proof",
			lines: [
				"BPI CREDIT ADVICE",
				`Value date: ${isoDate(-78)}`,
				"Credited amount: PHP 45,000.00",
				"Remitter: HARBOR COFFEE CO",
				"Reference: HCR-0000 DEPOSIT",
			],
		},
	];
	const result = {};
	for (const doc of wanted) {
		const found = existing.find((row) => row.file_name === doc.file);
		if (found) {
			result[doc.kind] = found.id;
			continue;
		}
		const form = new FormData();
		form.append("project_id", PROJECT);
		form.append("kind", doc.kind);
		form.append("file", new Blob([makePdf(doc.lines)], { type: "application/pdf" }), doc.file);
		const upload = await fetch(`${apiUrl}/api/finance-imports/documents`, {
			method: "POST",
			headers,
			body: form,
		});
		if (!upload.ok) throw new Error(`upload ${doc.file} failed (${upload.status}): ${await upload.text()}`);
		result[doc.kind] = unwrap(await upload.json()).id;
		console.log(`uploaded ${doc.file}`);
	}
	return result;
}

async function seedImportedInvoice(db, documents) {
	const invoiceId = id("10");
	await db.query(
		`insert into invoices (id, project_id, contract_id, issuer_user_id, recipient_user_id, number, status,
		   currency, issue_date, due_date, subtotal, total, issued_at, paid_at, origin, source_document_id,
		   project_title_snapshot)
		 values ($1, $2, $3, $4, $5, 'HCR-0000', 'paid', $6, $7, $8, 45000, 45000,
		   ($7::date)::timestamptz, ($9::date)::timestamptz, 'imported', $10, $11)
		 on conflict (id) do update set source_document_id = excluded.source_document_id`,
		[invoiceId, PROJECT, CONTRACT, OWNER, CLIENT, CURRENCY, isoDate(-90), isoDate(-75), isoDate(-78), documents.invoice, PROJECT_TITLE],
	);
	await db.query(
		`insert into invoice_payments (id, invoice_id, amount, payment_date, payment_method, reference, recorded_by, proof_document_id)
		 values ($1, $2, 45000, $3, 'Bank transfer', 'HCR-0000 DEPOSIT', $4, $5)
		 on conflict (id) do update set proof_document_id = excluded.proof_document_id`,
		[id("101"), invoiceId, isoDate(-78), OWNER, documents.payment_proof ?? null],
	);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
