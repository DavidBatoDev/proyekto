import { describe, expect, it } from "vitest";
import {
	DEFAULT_PLAN_LIMITS,
	type LimitCell,
	type LimitKey,
	type PlanId,
	type PlanLimits,
} from "./planLimits";
import {
	type FeatureGroup,
	PAID_PLAN_IDS,
	PLANS,
	type Plan,
	planById,
	resolveFeatureGroups,
	resolveHighlights,
} from "./pricing";

describe("pricing data invariants", () => {
	/**
	 * The guard that keeps checkout honest: a Stripe price id in the web bundle
	 * would be a tampering surface (anyone could check out against an archived or
	 * internal price), would keep selling at the old rate after a re-pricing
	 * because this bundle is long-cached, and would need a separate build per
	 * Stripe mode. The (plan, interval) -> price mapping lives in the backend.
	 */
	it("contains no Stripe price identifiers", () => {
		expect(JSON.stringify(PLANS)).not.toMatch(/price_/);
	});

	it("gives every purchasable plan both a monthly and a yearly price", () => {
		for (const id of PAID_PLAN_IDS) {
			const plan = planById(id);
			expect(plan?.priceMonthly).toBeTypeOf("number");
			expect(plan?.priceYearly).toBeTypeOf("number");
			expect(plan?.intervals).toEqual(["month", "year"]);
		}
	});

	it("keeps enterprise quoted and annual-only", () => {
		const enterprise = planById("enterprise");
		expect(enterprise?.priceMonthly).toBeNull();
		expect(enterprise?.priceYearly).toBeNull();
		expect(enterprise?.cta.kind).toBe("sales");
		expect(enterprise?.intervals).toEqual(["year"]);
	});

	it("offers no interval on free, which is never bought", () => {
		expect(planById("free")?.intervals).toEqual([]);
	});

	it("marks exactly the paid plans as subscribable", () => {
		const subscribable = PLANS.filter(
			(plan) => plan.cta.kind === "subscribe",
		).map((plan) => plan.id);
		expect(subscribable).toEqual([...PAID_PLAN_IDS]);
	});

	it("prices yearly below monthly, since yearly billing is the discount", () => {
		for (const id of PAID_PLAN_IDS) {
			const plan = planById(id);
			expect(plan?.priceYearly as number).toBeLessThan(
				plan?.priceMonthly as number,
			);
		}
	});
});

// ── Today's published copy, pinned literally ────────────────────────────────
//
// Copied from pricing.ts as it stood before the limits moved to the database.
// The default matrix equals the seed, so resolving it must reproduce exactly
// what /pricing has always said. A diff here means the page changed its words
// without anyone editing a limit.

const PUBLISHED_HIGHLIGHTS: Record<PlanId, string[]> = {
	free: [
		"Up to 10 members",
		"2 projects, 2 teams",
		"250 roadmap nodes (epics, features, tasks) per roadmap",
		"50 AI messages a month",
		"Project knowledge base",
		"Tasks, chat and meetings",
	],
	pro: [
		"All Free features +",
		"Unlimited members",
		"10 projects, 3 teams",
		"Unlimited roadmap nodes",
		"500 AI messages per seat",
		"Deliverables, change requests, risks and decisions",
		"Time tracking and timesheets",
		"MCP server for Claude and other AI clients",
	],
	business: [
		"All Pro features +",
		"Unlimited projects and teams",
		"2,000 AI messages per seat",
		"High reasoning effort",
		"Private teams and guests",
		"Unlimited activity history",
	],
	enterprise: [
		"All Business features +",
		"SAML and SCIM",
		"Granular admin controls",
		"Activity export",
		"Priority AI capacity",
		"Migration and onboarding support",
		"Account management",
	],
};

const all = (value: boolean | string) => ({
	free: value,
	pro: value,
	business: value,
	enterprise: value,
});

const PUBLISHED_FEATURE_GROUPS = [
	{
		title: "Usage",
		rows: [
			{
				label: "Members",
				note: "Everyone in your workspace. Paid plans are billed per member.",
				values: {
					free: "Up to 10",
					pro: "Unlimited",
					business: "Unlimited",
					enterprise: "Unlimited",
				},
			},
			{
				label: "Projects",
				values: {
					free: "2",
					pro: "10",
					business: "Unlimited",
					enterprise: "Unlimited",
				},
			},
			{
				label: "Teams",
				values: {
					free: "2",
					pro: "3",
					business: "Unlimited",
					enterprise: "Unlimited",
				},
			},
			{
				label: "Roadmap nodes (epics, features, tasks) per roadmap",
				values: {
					free: "250",
					pro: "Unlimited",
					business: "Unlimited",
					enterprise: "Unlimited",
				},
			},
		],
	},
	{
		title: "AI",
		rows: [
			{
				label: "AI messages",
				note: "The assistant that drafts and edits your roadmap.",
				values: {
					free: "50 / month",
					pro: "500 / seat / month",
					business: "2,000 / seat / month",
					enterprise: "Negotiated",
				},
			},
			{
				label: "Reasoning effort",
				values: {
					free: "Standard",
					pro: "Standard",
					business: "High",
					enterprise: "High",
				},
			},
			{ label: "Project knowledge base", values: all(true) },
			{ label: "Saved memory and preferences", values: all(true) },
			{
				label: "Priority AI capacity",
				values: { free: false, pro: false, business: false, enterprise: true },
			},
		],
	},
	{
		title: "Planning and execution",
		rows: [
			{ label: "Roadmap canvas", values: all(true) },
			{ label: "Epics, features and tasks", values: all(true) },
			{ label: "Roadmap templates", values: all(true) },
			{ label: "Comments and mentions", values: all(true) },
			{ label: "Project chat channels", values: all(true) },
			{ label: "Meetings and video links", values: all(true) },
			{ label: "Roadmap sharing links", values: all(true) },
		],
	},
	{
		title: "Delivery governance",
		rows: [
			{
				label: "Deliverables",
				values: { free: false, pro: true, business: true, enterprise: true },
			},
			{
				label: "Deliverable review and acceptance",
				values: { free: false, pro: true, business: true, enterprise: true },
			},
			{
				label: "Change requests",
				values: { free: false, pro: true, business: true, enterprise: true },
			},
			{
				label: "Risks and issues register",
				values: { free: false, pro: true, business: true, enterprise: true },
			},
			{
				label: "Decision log",
				values: { free: false, pro: true, business: true, enterprise: true },
			},
			{
				label: "Custom register fields",
				values: { free: false, pro: false, business: false, enterprise: true },
			},
		],
	},
	{
		title: "Team management",
		rows: [
			{
				label: "Time tracking and timesheets",
				values: { free: false, pro: true, business: true, enterprise: true },
			},
			{
				label: "Private teams and guests",
				values: { free: false, pro: false, business: true, enterprise: true },
			},
			{
				label: "Roles and permissions",
				values: {
					free: false,
					pro: false,
					business: true,
					enterprise: "Granular",
				},
			},
			{
				label: "Activity log retention",
				values: {
					free: "7 days",
					pro: "90 days",
					business: "Unlimited",
					enterprise: "Unlimited",
				},
			},
			{
				label: "Activity export",
				values: { free: false, pro: false, business: false, enterprise: true },
			},
		],
	},
	{
		title: "Platform",
		rows: [
			{ label: "Mobile app (iOS and Android)", values: all(true) },
			{
				label: "MCP server",
				note: "Connect Proyekto to Claude and other MCP clients.",
				values: {
					free: false,
					pro: true,
					business: true,
					enterprise: "Higher limits",
				},
			},
			{ label: "Google sign-in", values: all(true) },
			{
				label: "SAML and SCIM",
				values: { free: false, pro: false, business: false, enterprise: true },
			},
		],
	},
	{
		title: "Support",
		rows: [
			{ label: "Community support", values: all(true) },
			{
				label: "Email support",
				values: { free: false, pro: true, business: true, enterprise: true },
			},
			{
				label: "Priority support",
				values: { free: false, pro: false, business: true, enterprise: true },
			},
			{
				label: "Migration and onboarding",
				values: { free: false, pro: false, business: false, enterprise: true },
			},
			{
				label: "Account manager",
				values: { free: false, pro: false, business: false, enterprise: true },
			},
		],
	},
];

/** The seed matrix with some cells replaced. */
function edited(
	changes: Partial<Record<PlanId, Partial<Record<LimitKey, LimitCell>>>>,
): Record<PlanId, PlanLimits> {
	const out = { ...DEFAULT_PLAN_LIMITS };
	for (const [id, cells] of Object.entries(changes) as [
		PlanId,
		Partial<Record<LimitKey, LimitCell>>,
	][]) {
		out[id] = { ...DEFAULT_PLAN_LIMITS[id], ...cells };
	}
	return out;
}

const count = (value: number | null): LimitCell => ({
	kind: "count",
	value,
	per_seat: false,
	display_label: null,
});
const days = (value: number | null): LimitCell => ({
	kind: "days",
	value,
	per_seat: false,
	display_label: null,
});
const quota = (
	value: number | null,
	per_seat: boolean,
	display_label: string | null = null,
): LimitCell => ({ kind: "quota", value, per_seat, display_label });
const off: LimitCell = { kind: "feature", enabled: false, display_label: null };

const plan = (id: PlanId): Plan => planById(id) as Plan;

function cellsOf(
	groups: FeatureGroup[],
	label: string,
): Record<PlanId, boolean | string> {
	const found = groups
		.flatMap((group) => group.rows)
		.find((r) => r.label === label);
	if (!found) throw new Error(`No row labelled ${label}`);
	return found.values;
}

const NODES_ROW = "Roadmap nodes (epics, features, tasks) per roadmap";

describe("pricing copy resolved from the limit matrix", () => {
	it("renders today's published matrix from the default limits", () => {
		// Round-trip through JSON so an absent `note` and `note: undefined` read
		// the same, exactly as the page renders them.
		expect(
			JSON.parse(JSON.stringify(resolveFeatureGroups(DEFAULT_PLAN_LIMITS))),
		).toStrictEqual(PUBLISHED_FEATURE_GROUPS);
	});

	it("renders today's highlights from the default limits", () => {
		for (const p of PLANS) {
			expect(resolveHighlights(p, DEFAULT_PLAN_LIMITS[p.id])).toStrictEqual(
				PUBLISHED_HIGHLIGHTS[p.id],
			);
		}
	});

	it("keeps the highlight tokens plain, serializable data", () => {
		expect(JSON.parse(JSON.stringify(PLANS))).toEqual(PLANS);
	});

	it("falls back to the seed for a missing matrix or a malformed cell", () => {
		const published = resolveFeatureGroups(DEFAULT_PLAN_LIMITS);
		expect(resolveFeatureGroups()).toEqual(published);
		expect(resolveFeatureGroups({})).toEqual(published);
		expect(resolveHighlights(plan("free"))).toEqual(PUBLISHED_HIGHLIGHTS.free);
		// A feature cell where a count belongs is ignored, not rendered.
		const wrongKind = { ...DEFAULT_PLAN_LIMITS.free, projects: off };
		expect(resolveHighlights(plan("free"), wrongKind)).toEqual(
			PUBLISHED_HIGHLIGHTS.free,
		);
	});

	it("follows an edited limit into the grid and the card", () => {
		const limits = edited({ free: { projects: count(3) } });
		expect(cellsOf(resolveFeatureGroups(limits), "Projects").free).toBe("3");
		expect(resolveHighlights(plan("free"), limits.free)).toContain(
			"3 projects, 2 teams",
		);
	});

	it("writes singulars and mixed unlimited counts", () => {
		const limits = edited({
			free: { projects: count(1), teams: count(1), members: count(1) },
			pro: { projects: count(null) },
		});
		expect(resolveHighlights(plan("free"), limits.free)).toEqual(
			expect.arrayContaining(["Up to 1 member", "1 project, 1 team"]),
		);
		expect(resolveHighlights(plan("pro"), limits.pro)).toContain(
			"Unlimited projects, 3 teams",
		);
	});

	it("lifts a limit to Unlimited", () => {
		const limits = edited({
			free: {
				members: count(null),
				roadmap_nodes_per_roadmap: count(null),
			},
		});
		const lines = resolveHighlights(plan("free"), limits.free);
		expect(lines).toContain("Unlimited members");
		expect(lines).toContain("Unlimited roadmap nodes");
		const groups = resolveFeatureGroups(limits);
		expect(cellsOf(groups, "Members").free).toBe("Unlimited");
		expect(cellsOf(groups, NODES_ROW).free).toBe("Unlimited");
	});

	it("drops a feature's highlight and cell when it is switched off", () => {
		const limits = edited({ pro: { time_tracking: off, mcp_server: off } });
		const lines = resolveHighlights(plan("pro"), limits.pro);
		expect(lines).not.toContain("Time tracking and timesheets");
		expect(lines).not.toContain("MCP server for Claude and other AI clients");
		const groups = resolveFeatureGroups(limits);
		expect(cellsOf(groups, "Time tracking and timesheets").pro).toBe(false);
		expect(cellsOf(groups, "MCP server").pro).toBe(false);
	});

	it("maps each governance row to its own key", () => {
		const oneOff = edited({ pro: { risks: off } });
		expect(resolveHighlights(plan("pro"), oneOff.pro)).toContain(
			"Deliverables, change requests and decisions",
		);
		const groups = resolveFeatureGroups(oneOff);
		expect(cellsOf(groups, "Risks and issues register").pro).toBe(false);
		expect(cellsOf(groups, "Decision log").pro).toBe(true);
		expect(cellsOf(groups, "Deliverable review and acceptance").pro).toBe(true);

		const allOff = edited({
			pro: {
				deliverables: off,
				change_requests: off,
				risks: off,
				decisions: off,
			},
		});
		const lines = resolveHighlights(plan("pro"), allOff.pro);
		expect(lines.some((line) => /deliverables|decisions/i.test(line))).toBe(
			false,
		);
	});

	it("keeps an enterprise display label only while the feature is on", () => {
		const labelledOff = edited({
			enterprise: {
				mcp_server: {
					kind: "feature",
					enabled: false,
					display_label: "Higher limits",
				},
				roles_permissions: {
					kind: "feature",
					enabled: false,
					display_label: "Granular",
				},
			},
		});
		const groups = resolveFeatureGroups(labelledOff);
		expect(cellsOf(groups, "MCP server").enterprise).toBe(false);
		expect(cellsOf(groups, "Roles and permissions").enterprise).toBe(false);
		expect(
			resolveHighlights(plan("enterprise"), labelledOff.enterprise),
		).not.toContain("Granular admin controls");

		const relabelled = edited({
			enterprise: {
				mcp_server: {
					kind: "feature",
					enabled: true,
					display_label: "Dedicated",
				},
			},
		});
		expect(
			cellsOf(resolveFeatureGroups(relabelled), "MCP server").enterprise,
		).toBe("Dedicated");
	});

	it("formats thousands: 2,000 / seat / month", () => {
		const limits = edited({
			free: { ai_messages_monthly: quota(1500, false) },
			pro: { ai_messages_monthly: quota(2000, true) },
		});
		const ai = cellsOf(resolveFeatureGroups(limits), "AI messages");
		expect(ai.free).toBe("1,500 / month");
		expect(ai.pro).toBe("2,000 / seat / month");
		expect(ai.enterprise).toBe("Negotiated");
		expect(resolveHighlights(plan("free"), limits.free)).toContain(
			"1,500 AI messages a month",
		);
		expect(resolveHighlights(plan("pro"), limits.pro)).toContain(
			"2,000 AI messages per seat",
		);
	});

	it("formats counts and retention days", () => {
		const limits = edited({
			free: {
				roadmap_nodes_per_roadmap: count(1200),
				activity_retention_days: days(1),
			},
			business: { activity_retention_days: days(365) },
		});
		const groups = resolveFeatureGroups(limits);
		expect(cellsOf(groups, NODES_ROW).free).toBe("1,200");
		expect(cellsOf(groups, "Activity log retention").free).toBe("1 day");
		expect(cellsOf(groups, "Activity log retention").business).toBe("365 days");
		expect(resolveHighlights(plan("free"), limits.free)).toContain(
			"1,200 roadmap nodes (epics, features, tasks) per roadmap",
		);
		expect(resolveHighlights(plan("business"), limits.business)).toContain(
			"365 days of activity history",
		);
	});

	it("drops the AI line for a zero or a labelled unlimited quota", () => {
		const limits = edited({
			free: { ai_messages_monthly: quota(0, false) },
			pro: { ai_messages_monthly: quota(null, true) },
			business: { ai_messages_monthly: quota(null, true, "Fair use") },
		});
		const mentionsAi = (lines: string[]) =>
			lines.some((line) => line.includes("AI message"));
		expect(mentionsAi(resolveHighlights(plan("free"), limits.free))).toBe(
			false,
		);
		expect(resolveHighlights(plan("pro"), limits.pro)).toContain(
			"Unlimited AI messages",
		);
		expect(
			mentionsAi(resolveHighlights(plan("business"), limits.business)),
		).toBe(false);
		expect(cellsOf(resolveFeatureGroups(limits), "AI messages").business).toBe(
			"Fair use",
		);
	});

	it("never changes the static rows", () => {
		const everythingOff = edited({
			enterprise: Object.fromEntries(
				Object.entries(DEFAULT_PLAN_LIMITS.enterprise).map(([key, cell]) => [
					key,
					cell.kind === "feature" ? off : cell,
				]),
			),
		});
		const groups = resolveFeatureGroups(everythingOff);
		expect(cellsOf(groups, "Priority AI capacity").enterprise).toBe(true);
		expect(cellsOf(groups, "Account manager").enterprise).toBe(true);
		expect(cellsOf(groups, "Reasoning effort").enterprise).toBe("High");
	});
});
