/**
 * The published pricing page: plans, prices, card copy and the comparison grid.
 *
 * The LIMITS are not written here. Every number and every plan-gated check on
 * /pricing comes from the plan-limit matrix in the database (`plan_limits`,
 * edited by a super admin), which the backend enforces and publishes through
 * `GET /api/plans`. This module only says WHERE each limit appears: a card
 * highlight is a token (`{ limit: "projects_teams" }`), a grid row names its
 * limit key, and `resolveHighlights` / `resolveFeatureGroups` turn the live
 * matrix into the strings the page draws. An admin edit therefore reaches the
 * pricing page without a deploy, and the page cannot promise more — or less —
 * than enforcement allows.
 *
 * `DEFAULT_PLAN_LIMITS` (planLimits.ts, identical to the seed) is the fallback:
 * it renders the first frame and carries the page through an API outage. A
 * test pins that the defaults resolve to exactly the copy this page published
 * before the limits moved, so nothing visibly changes when live data arrives
 * unless an admin has actually edited a limit.
 *
 * What stays static is what no limit governs: prices, taglines, CTAs, billing
 * intervals, and the grid rows that have no limit key (reasoning effort,
 * support, the capabilities every plan shares).
 *
 * Payment-provider price ids are deliberately ABSENT. The (plan, interval) ->
 * price mapping lives in the backend billing module, keyed by env var, for three
 * reasons: a client-supplied price id would let anyone check out against an
 * archived or internal price; prices rotate on a re-pricing while this bundle
 * is long-cached on Cloudflare; and test vs live mode would otherwise need a
 * build per environment. A test asserts no key in this file matches /^price_/.
 *
 * Nothing here may be used to compute an amount shown on the billing settings
 * page either. These are marketing list prices — a given workspace may have a
 * coupon, a tax line, or a pending proration credit — so every figure on that
 * page comes from the payment provider through the API.
 */

import {
	cellValue,
	DEFAULT_PLAN_LIMITS,
	type FeatureKey,
	formatCount,
	isEnabled,
	type LimitCell,
	type LimitCellMap,
	type LimitKey,
	PLAN_ORDER,
	type PlanId,
} from "./planLimits";
import { countNoun } from "./usageCopy";

export type { PlanId } from "./planLimits";

/** The plans a customer can buy without talking to sales. */
export type PaidPlanId = Extract<PlanId, "pro" | "business">;

export type BillingInterval = "month" | "year";

export const PAID_PLAN_IDS: readonly PaidPlanId[] = ["pro", "business"];

/** Any per-plan limit matrix: `usePublicPlanLimits().limits`, or a partial one. */
export type PlanLimitMatrix = Readonly<Partial<Record<PlanId, LimitCellMap>>>;

/** The card sentences that are built from a plan's numbers. */
export type HighlightLimit =
	| "members"
	| "projects_teams"
	| "roadmap_nodes"
	| "ai_messages"
	| "activity_history";

/**
 * One line on a plan card. A plain string is fixed copy; the object forms are
 * resolved against the limit matrix by `resolveHighlights`. Declarative data
 * rather than functions, so PLANS still serializes (the price-id test reads it
 * as JSON).
 */
export type PlanHighlight =
	| string
	/** A sentence written from the plan's numbers, e.g. "10 projects, 3 teams". */
	| { limit: HighlightLimit }
	/** Fixed text, shown only while the feature is on for this plan. */
	| { feature: FeatureKey; text: string }
	/** One line naming whichever of these features are on; dropped when none are. */
	| { features: readonly { key: FeatureKey; text: string }[] };

export interface Plan {
	id: PlanId;
	name: string;
	/** Per user / month, billed yearly. `null` = quoted, not listed. */
	priceYearly: number | null;
	/** Per user / month, billed monthly. */
	priceMonthly: number | null;
	tagline: string;
	/**
	 * The short card list. The comparison table below carries the detail. Read
	 * it through `resolveHighlights`, never directly: the limit lines are tokens.
	 */
	highlights: readonly PlanHighlight[];
	/**
	 * "subscribe" is a real checkout; "signup" sends a signed-out visitor to
	 * create an account first; "sales" is the quoted, non-self-serve path.
	 */
	cta: { label: string; kind: "signup" | "sales" | "subscribe" };
	/**
	 * Which billing intervals this plan can actually be bought on. Data rather
	 * than prose, so the CTA can reason about "annual billing only" instead of
	 * parsing a tagline.
	 */
	intervals: readonly BillingInterval[];
	/** Drawn with the filled button and a ring, as the recommended plan. */
	featured?: boolean;
}

export const PLANS: readonly Plan[] = [
	{
		id: "free",
		name: "Free",
		priceYearly: 0,
		priceMonthly: 0,
		tagline: "Free for everyone",
		highlights: [
			{ limit: "members" },
			{ limit: "projects_teams" },
			{ limit: "roadmap_nodes" },
			{ limit: "ai_messages" },
			"Project knowledge base",
			"Tasks, chat and meetings",
		],
		cta: { label: "Get started", kind: "signup" },
		intervals: [],
	},
	{
		id: "pro",
		name: "Pro",
		priceYearly: 10,
		priceMonthly: 12,
		tagline: "For teams running real delivery",
		highlights: [
			"All Free features +",
			{ limit: "members" },
			{ limit: "projects_teams" },
			{ limit: "roadmap_nodes" },
			{ limit: "ai_messages" },
			{
				features: [
					{ key: "deliverables", text: "deliverables" },
					{ key: "change_requests", text: "change requests" },
					{ key: "risks", text: "risks" },
					{ key: "decisions", text: "decisions" },
				],
			},
			{ feature: "time_tracking", text: "Time tracking and timesheets" },
			{
				feature: "mcp_server",
				text: "MCP server for Claude and other AI clients",
			},
		],
		cta: { label: "Get started", kind: "subscribe" },
		intervals: ["month", "year"],
	},
	{
		id: "business",
		name: "Business",
		priceYearly: 20,
		priceMonthly: 24,
		tagline: "For organizations governing delivery",
		highlights: [
			"All Pro features +",
			{ limit: "projects_teams" },
			{ limit: "ai_messages" },
			"High reasoning effort",
			{ feature: "private_teams_guests", text: "Private teams and guests" },
			{ limit: "activity_history" },
		],
		cta: { label: "Get started", kind: "subscribe" },
		intervals: ["month", "year"],
		featured: true,
	},
	{
		id: "enterprise",
		name: "Enterprise",
		priceYearly: null,
		priceMonthly: null,
		tagline: "Annual billing only",
		highlights: [
			"All Business features +",
			{ feature: "saml_scim", text: "SAML and SCIM" },
			{ feature: "roles_permissions", text: "Granular admin controls" },
			{ feature: "activity_export", text: "Activity export" },
			"Priority AI capacity",
			"Migration and onboarding support",
			"Account management",
		],
		cta: { label: "Contact sales", kind: "sales" },
		intervals: ["year"],
	},
] as const;

export function planById(id: PlanId): Plan | undefined {
	return PLANS.find((plan) => plan.id === id);
}

// ── Reading the matrix ──────────────────────────────────────────────────────

/**
 * A plan's cell for `key`. The seed's cell stands in when the given map lacks
 * the key or holds a cell of the wrong kind — the same fallback the limit
 * normalizer applies, so a partial matrix still renders the published page.
 */
function cellOf(
	limits: LimitCellMap | null | undefined,
	plan: PlanId,
	key: LimitKey,
): LimitCell {
	const fallback = DEFAULT_PLAN_LIMITS[plan][key];
	const cell = limits?.[key];
	return cell && cell.kind === fallback.kind ? cell : fallback;
}

const capitalize = (text: string) =>
	text.charAt(0).toUpperCase() + text.slice(1);

function joinList(parts: readonly string[]): string {
	if (parts.length <= 1) return parts.join("");
	return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// ── Card highlights ─────────────────────────────────────────────────────────

function limitHighlight(
	token: HighlightLimit,
	cell: (key: LimitKey) => LimitCell,
): string | null {
	switch (token) {
		case "members": {
			const members = cellValue(cell("members"));
			return members === null
				? "Unlimited members"
				: `Up to ${countNoun("members", members)}`;
		}
		case "projects_teams": {
			const projects = cellValue(cell("projects"));
			const teams = cellValue(cell("teams"));
			if (projects === null && teams === null) {
				return "Unlimited projects and teams";
			}
			const part = (key: "projects" | "teams", n: number | null) =>
				n === null ? `unlimited ${key}` : countNoun(key, n);
			return capitalize(
				`${part("projects", projects)}, ${part("teams", teams)}`,
			);
		}
		case "roadmap_nodes": {
			const nodes = cellValue(cell("roadmap_nodes_per_roadmap"));
			return nodes === null
				? "Unlimited roadmap nodes"
				: `${formatCount(nodes)} roadmap ${nodes === 1 ? "node" : "nodes"} (epics, features, tasks) per roadmap`;
		}
		case "ai_messages": {
			const quota = cell("ai_messages_monthly");
			if (quota.kind === "feature") return null;
			// A labelled unlimited quota ("Negotiated") is a grid word, not a
			// card sentence; a zero quota is nothing worth advertising.
			if (quota.value === null) {
				return quota.display_label ? null : "Unlimited AI messages";
			}
			if (quota.value === 0) return null;
			const messages = `${formatCount(quota.value)} AI ${quota.value === 1 ? "message" : "messages"}`;
			return quota.per_seat ? `${messages} per seat` : `${messages} a month`;
		}
		case "activity_history": {
			const retention = cellValue(cell("activity_retention_days"));
			return retention === null
				? "Unlimited activity history"
				: `${countNoun("activity_retention_days", retention)} of activity history`;
		}
	}
}

/**
 * A plan card's lines, written from `limits` (one plan's cells). A feature
 * that is switched off drops its line, so a card never advertises something
 * the plan does not grant.
 */
export function resolveHighlights(
	plan: Plan,
	limits?: LimitCellMap | null,
): string[] {
	const cell = (key: LimitKey) => cellOf(limits, plan.id, key);
	const lines: string[] = [];
	for (const item of plan.highlights) {
		let line: string | null;
		if (typeof item === "string") {
			line = item;
		} else if ("limit" in item) {
			line = limitHighlight(item.limit, cell);
		} else if ("feature" in item) {
			line = isEnabled(cell(item.feature)) ? item.text : null;
		} else {
			const on = item.features
				.filter((entry) => isEnabled(cell(entry.key)))
				.map((entry) => entry.text);
			line = on.length > 0 ? capitalize(joinList(on)) : null;
		}
		if (line) lines.push(line);
	}
	return lines;
}

// ── Comparison grid ─────────────────────────────────────────────────────────

/**
 * A cell in the comparison table.
 *
 * `true` renders a check, `false` a dash, and a string renders verbatim — which
 * is how a limit ("20 projects") and a capability ("SAML and SCIM") live in the
 * same grid without a second shape.
 */
export type Cell = boolean | string;

export interface FeatureRow {
	label: string;
	/** Shown under the label where the name alone would not settle it. */
	note?: string;
	values: Record<PlanId, Cell>;
}

export interface FeatureGroup {
	title: string;
	rows: FeatureRow[];
}

/** The limit a grid row reads, and how its number is written. */
export type LimitCellSpec =
	| {
			kind: "count";
			key: "members" | "projects" | "teams" | "roadmap_nodes_per_roadmap";
			/** Written before a finite number: "Up to 10". */
			prefix?: string;
	  }
	| { kind: "quota"; key: "ai_messages_monthly" }
	| { kind: "days"; key: "activity_retention_days" }
	| { kind: "feature"; key: FeatureKey };

/** A grid row before resolution: fixed values, or a limit key to read. */
export type FeatureRowDef =
	| { label: string; note?: string; values: Record<PlanId, Cell> }
	| { label: string; note?: string; limit: LimitCellSpec };

export interface FeatureGroupDef {
	title: string;
	rows: readonly FeatureRowDef[];
}

const row = (
	label: string,
	free: Cell,
	pro: Cell,
	business: Cell,
	enterprise: Cell,
	note?: string,
): FeatureRowDef => ({
	label,
	note,
	values: { free, pro, business, enterprise },
});

const limitRow = (
	label: string,
	limit: LimitCellSpec,
	note?: string,
): FeatureRowDef => ({ label, note, limit });

const feature = (key: FeatureKey): LimitCellSpec => ({ kind: "feature", key });

export const FEATURE_GROUP_DEFS: readonly FeatureGroupDef[] = [
	{
		title: "Usage",
		rows: [
			limitRow(
				"Members",
				{ kind: "count", key: "members", prefix: "Up to " },
				"Everyone in your workspace. Paid plans are billed per member.",
			),
			limitRow("Projects", { kind: "count", key: "projects" }),
			limitRow("Teams", { kind: "count", key: "teams" }),
			limitRow("Roadmap nodes (epics, features, tasks) per roadmap", {
				kind: "count",
				key: "roadmap_nodes_per_roadmap",
			}),
		],
	},
	{
		title: "AI",
		rows: [
			limitRow(
				"AI messages",
				{ kind: "quota", key: "ai_messages_monthly" },
				"The assistant that drafts and edits your roadmap.",
			),
			row("Reasoning effort", "Standard", "Standard", "High", "High"),
			row("Project knowledge base", true, true, true, true),
			row("Saved memory and preferences", true, true, true, true),
			row("Priority AI capacity", false, false, false, true),
		],
	},
	{
		title: "Planning and execution",
		rows: [
			row("Roadmap canvas", true, true, true, true),
			row("Epics, features and tasks", true, true, true, true),
			row("Roadmap templates", true, true, true, true),
			row("Comments and mentions", true, true, true, true),
			row("Project chat channels", true, true, true, true),
			row("Meetings and video links", true, true, true, true),
			row("Roadmap sharing links", true, true, true, true),
		],
	},
	{
		title: "Delivery governance",
		rows: [
			limitRow("Deliverables", feature("deliverables")),
			limitRow(
				"Deliverable review and acceptance",
				feature("deliverable_review"),
			),
			limitRow("Change requests", feature("change_requests")),
			limitRow("Risks and issues register", feature("risks")),
			limitRow("Decision log", feature("decisions")),
			limitRow("Custom register fields", feature("custom_register_fields")),
		],
	},
	{
		title: "Team management",
		rows: [
			limitRow("Time tracking and timesheets", feature("time_tracking")),
			limitRow("Private teams and guests", feature("private_teams_guests")),
			limitRow("Roles and permissions", feature("roles_permissions")),
			limitRow("Activity log retention", {
				kind: "days",
				key: "activity_retention_days",
			}),
			limitRow("Activity export", feature("activity_export")),
		],
	},
	{
		title: "Platform",
		rows: [
			row("Mobile app (iOS and Android)", true, true, true, true),
			limitRow(
				"MCP server",
				feature("mcp_server"),
				"Connect Proyekto to Claude and other MCP clients.",
			),
			row("Google sign-in", true, true, true, true),
			limitRow("SAML and SCIM", feature("saml_scim")),
		],
	},
	{
		title: "Support",
		rows: [
			row("Community support", true, true, true, true),
			row("Email support", false, true, true, true),
			row("Priority support", false, false, true, true),
			row("Migration and onboarding", false, false, false, true),
			row("Account manager", false, false, false, true),
		],
	},
];

/**
 * One grid cell from one limit cell. A cell's `display_label` ("Negotiated",
 * "Higher limits", "Granular") replaces the number or the check — but a
 * feature's label shows only while the feature is on, so switching it off
 * always reads as a dash.
 */
export function formatLimitCell(spec: LimitCellSpec, cell: LimitCell): Cell {
	if (cell.kind === "feature") {
		return cell.enabled ? (cell.display_label ?? true) : false;
	}
	if (cell.display_label) return cell.display_label;
	if (cell.value === null) return "Unlimited";
	switch (spec.kind) {
		case "quota":
			return `${formatCount(cell.value)} / ${cell.per_seat ? "seat / month" : "month"}`;
		case "days":
			return countNoun(spec.key, cell.value);
		case "count":
			return `${spec.prefix ?? ""}${formatCount(cell.value)}`;
		default:
			return formatCount(cell.value);
	}
}

/** The comparison grid, written from the whole matrix. */
export function resolveFeatureGroups(
	limits: PlanLimitMatrix = DEFAULT_PLAN_LIMITS,
): FeatureGroup[] {
	return FEATURE_GROUP_DEFS.map((group) => ({
		title: group.title,
		rows: group.rows.map((def): FeatureRow => {
			if ("values" in def) {
				return { label: def.label, note: def.note, values: { ...def.values } };
			}
			const values = {} as Record<PlanId, Cell>;
			for (const plan of PLAN_ORDER) {
				values[plan] = formatLimitCell(
					def.limit,
					cellOf(limits[plan], plan, def.limit.key),
				);
			}
			return { label: def.label, note: def.note, values };
		}),
	}));
}
