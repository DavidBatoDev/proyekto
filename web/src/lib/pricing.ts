/**
 * The published pricing table.
 *
 * One module rather than markup scattered through the page, because these
 * numbers will need a second reader: `workspace_subscriptions.plan` already
 * carries exactly these four ids (20260902090000_workspaces_core.sql), and the
 * entitlement layer that enforces `seat_limit` and the AI message ceiling will
 * read its limits from here rather than from a second copy that drifts.
 *
 * Nothing enforces any of this yet — today it is only what the page renders.
 */

export type PlanId = "free" | "pro" | "business" | "enterprise";

export interface Plan {
	id: PlanId;
	name: string;
	/** Per user / month, billed yearly. `null` = quoted, not listed. */
	priceYearly: number | null;
	/** Per user / month, billed monthly. */
	priceMonthly: number | null;
	tagline: string;
	/** The short card list. The comparison table below carries the detail. */
	highlights: string[];
	cta: { label: string; kind: "signup" | "sales" };
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
			"Up to 10 members",
			"2 projects, 2 teams",
			"250 roadmap nodes (epics, features, tasks) per roadmap",
			"50 AI messages a month",
			"Project knowledge base",
			"Tasks, chat and meetings",
		],
		cta: { label: "Get started", kind: "signup" },
	},
	{
		id: "pro",
		name: "Pro",
		priceYearly: 10,
		priceMonthly: 12,
		tagline: "For teams running real delivery",
		highlights: [
			"All Free features +",
			"Unlimited members",
			"10 projects, 3 teams",
			"Unlimited roadmap nodes",
			"500 AI messages per seat",
			"Deliverables, change requests, risks and decisions",
			"Time tracking and timesheets",
			"MCP server for Claude and other AI clients",
		],
		cta: { label: "Get started", kind: "signup" },
	},
	{
		id: "business",
		name: "Business",
		priceYearly: 20,
		priceMonthly: 24,
		tagline: "For organizations governing delivery",
		highlights: [
			"All Pro features +",
			"Unlimited projects and teams",
			"2,000 AI messages per seat",
			"High reasoning effort",
			"Private teams and guests",
			"Unlimited activity history",
		],
		cta: { label: "Get started", kind: "signup" },
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
			"SAML and SCIM",
			"Granular admin controls",
			"Activity export",
			"Priority AI capacity",
			"Migration and onboarding support",
			"Account management",
		],
		cta: { label: "Contact sales", kind: "sales" },
	},
] as const;

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

const row = (
	label: string,
	free: Cell,
	pro: Cell,
	business: Cell,
	enterprise: Cell,
	note?: string,
): FeatureRow => ({
	label,
	note,
	values: { free, pro, business, enterprise },
});

export const FEATURE_GROUPS: readonly FeatureGroup[] = [
	{
		title: "Usage",
		rows: [
			row(
				"Members",
				"Up to 10",
				"Unlimited",
				"Unlimited",
				"Unlimited",
				"Everyone in your workspace. Paid plans are billed per member.",
			),
			row("Projects", "2", "10", "Unlimited", "Unlimited"),
			row("Teams", "2", "3", "Unlimited", "Unlimited"),
			row(
				"Roadmap nodes (epics, features, tasks) per roadmap",
				"250",
				"Unlimited",
				"Unlimited",
				"Unlimited",
			),
		],
	},
	{
		title: "AI",
		rows: [
			row(
				"AI messages",
				"50 / month",
				"500 / seat / month",
				"2,000 / seat / month",
				"Negotiated",
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
			row("Deliverables", false, true, true, true),
			row("Deliverable review and acceptance", false, true, true, true),
			row("Change requests", false, true, true, true),
			row("Risks and issues register", false, true, true, true),
			row("Decision log", false, true, true, true),
			row("Custom register fields", false, false, false, true),
		],
	},
	{
		title: "Team management",
		rows: [
			row("Time tracking and timesheets", false, true, true, true),
			row("Private teams and guests", false, false, true, true),
			row("Roles and permissions", false, false, true, "Granular"),
			row(
				"Activity log retention",
				"7 days",
				"90 days",
				"Unlimited",
				"Unlimited",
			),
			row("Activity export", false, false, false, true),
		],
	},
	{
		title: "Platform",
		rows: [
			row("Mobile app (iOS and Android)", true, true, true, true),
			row(
				"MCP server",
				false,
				true,
				true,
				"Higher limits",
				"Connect Proyekto to Claude and other MCP clients.",
			),
			row("Google sign-in", true, true, true, true),
			row("SAML and SCIM", false, false, false, true),
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
] as const;
