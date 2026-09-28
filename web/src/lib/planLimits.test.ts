import { describe, expect, it } from "vitest";
import {
	cellValue,
	DEFAULT_PLAN_LIMITS,
	ENFORCED_LIMIT_KEYS,
	formatCount,
	isEnabled,
	LIMIT_DEFINITIONS,
	LIMIT_KEYS,
	nextPlanWith,
	normalizeLimits,
	normalizePlanLimits,
	PLAN_ORDER,
	type PlanId,
	type PlanLimits,
	planLabel,
	planRank,
} from "./planLimits";

const edit = (
	plan: PlanId,
	key: keyof PlanLimits,
	cell: PlanLimits[keyof PlanLimits],
): Record<PlanId, PlanLimits> => {
	const next = normalizePlanLimits(DEFAULT_PLAN_LIMITS);
	next[plan] = { ...next[plan], [key]: cell };
	return next;
};

describe("plan limit catalogue", () => {
	it("orders plans free → enterprise, matching SQL plan_rank()", () => {
		expect(PLAN_ORDER).toEqual(["free", "pro", "business", "enterprise"]);
		expect(PLAN_ORDER.map(planRank)).toEqual([0, 1, 2, 3]);
		expect(planRank("platinum")).toBe(-1);
	});

	it("defines every key exactly once, and nothing else", () => {
		const defined = LIMIT_DEFINITIONS.map((definition) => definition.key);
		expect(new Set(defined).size).toBe(defined.length);
		expect([...defined].sort()).toEqual([...LIMIT_KEYS].sort());
		expect(LIMIT_KEYS).toHaveLength(18);
		for (const plan of PLAN_ORDER) {
			expect(Object.keys(DEFAULT_PLAN_LIMITS[plan]).sort()).toEqual(
				[...LIMIT_KEYS].sort(),
			);
		}
	});

	it("gives numeric keys a unit and features none", () => {
		for (const definition of LIMIT_DEFINITIONS) {
			if (definition.kind === "feature") {
				expect(definition.unit).toBeNull();
			} else {
				expect(definition.unit?.plural).toBeTruthy();
			}
		}
	});

	/** The keys the backend enforces in this pass; the rest are pricing-only. */
	it("snapshots the enforced key set", () => {
		expect([...ENFORCED_LIMIT_KEYS]).toEqual([
			"members",
			"projects",
			"teams",
			"roadmap_nodes_per_roadmap",
			"deliverables",
			"deliverable_review",
			"change_requests",
			"risks",
			"decisions",
			"time_tracking",
			"activity_retention_days",
			"mcp_server",
		]);
	});

	it("labels plans for display", () => {
		expect(planLabel("business")).toBe("Business");
		expect(planLabel("Already a name")).toBe("Already a name");
	});

	it("formats counts deterministically", () => {
		expect(formatCount(2000)).toBe("2,000");
		expect(formatCount(7)).toBe("7");
	});
});

/**
 * The literal copy of the seed in
 * supabase/migrations/20260922120000_workspace_plan_limits.sql. If this fails
 * after a seed change, update both together — /pricing renders these values
 * during an outage.
 */
describe("DEFAULT_PLAN_LIMITS matches the seed", () => {
	const n = (
		kind: "count" | "quota" | "days",
		value: number | null,
		per_seat = false,
		display_label: string | null = null,
	) => ({ kind, value, per_seat, display_label });
	const f = (enabled: boolean, display_label: string | null = null) => ({
		kind: "feature",
		enabled,
		display_label,
	});
	const row = (
		free: object,
		pro: object,
		business: object,
		enterprise: object,
	) => ({ free, pro, business, enterprise });

	const SEED: Record<string, Record<PlanId, object>> = {
		members: row(
			n("count", 10),
			n("count", null),
			n("count", null),
			n("count", null),
		),
		projects: row(
			n("count", 2),
			n("count", 10),
			n("count", null),
			n("count", null),
		),
		teams: row(
			n("count", 2),
			n("count", 3),
			n("count", null),
			n("count", null),
		),
		roadmap_nodes_per_roadmap: row(
			n("count", 250),
			n("count", null),
			n("count", null),
			n("count", null),
		),
		ai_messages_monthly: row(
			n("quota", 50, false),
			n("quota", 500, true),
			n("quota", 2000, true),
			n("quota", null, false, "Negotiated"),
		),
		deliverables: row(f(false), f(true), f(true), f(true)),
		deliverable_review: row(f(false), f(true), f(true), f(true)),
		change_requests: row(f(false), f(true), f(true), f(true)),
		risks: row(f(false), f(true), f(true), f(true)),
		decisions: row(f(false), f(true), f(true), f(true)),
		custom_register_fields: row(f(false), f(false), f(false), f(true)),
		time_tracking: row(f(false), f(true), f(true), f(true)),
		private_teams_guests: row(f(false), f(false), f(true), f(true)),
		roles_permissions: row(f(false), f(false), f(true), f(true, "Granular")),
		activity_retention_days: row(
			n("days", 7),
			n("days", 90),
			n("days", null),
			n("days", null),
		),
		activity_export: row(f(false), f(false), f(false), f(true)),
		mcp_server: row(f(false), f(true), f(true), f(true, "Higher limits")),
		saml_scim: row(f(false), f(false), f(false), f(true)),
	};

	it("cell for cell", () => {
		for (const plan of PLAN_ORDER) {
			for (const key of LIMIT_KEYS) {
				expect({ plan, key, cell: DEFAULT_PLAN_LIMITS[plan][key] }).toEqual({
					plan,
					key,
					cell: SEED[key][plan],
				});
			}
		}
	});

	it("is frozen, so nothing edits the fallback in place", () => {
		expect(Object.isFrozen(DEFAULT_PLAN_LIMITS)).toBe(true);
		expect(Object.isFrozen(DEFAULT_PLAN_LIMITS.free)).toBe(true);
		expect(Object.isFrozen(DEFAULT_PLAN_LIMITS.free.projects)).toBe(true);
	});
});

describe("normalizePlanLimits", () => {
	it("returns the seed for garbage, null and non-objects", () => {
		for (const raw of [null, undefined, "nope", 42, [], true]) {
			expect(normalizePlanLimits(raw)).toEqual(DEFAULT_PLAN_LIMITS);
		}
	});

	it("merges a partial payload onto the defaults key by key", () => {
		const result = normalizePlanLimits({
			free: {
				projects: {
					kind: "count",
					value: 3,
					per_seat: false,
					display_label: null,
				},
			},
		});
		expect(cellValue(result.free.projects)).toBe(3);
		expect(result.free.teams).toEqual(DEFAULT_PLAN_LIMITS.free.teams);
		expect(result.pro).toEqual(DEFAULT_PLAN_LIMITS.pro);
	});

	it.each([
		["a string number", "10"],
		["a negative", -1],
		["a fraction", 1.5],
		["NaN", Number.NaN],
		["Infinity", Number.POSITIVE_INFINITY],
		["an absurd value", 2_000_000_000],
	])("falls back to the default cell for %s", (_label, value) => {
		const result = normalizePlanLimits({
			free: { projects: { kind: "count", value, per_seat: false } },
		});
		expect(result.free.projects).toEqual(DEFAULT_PLAN_LIMITS.free.projects);
	});

	it("keeps null as unlimited", () => {
		const result = normalizePlanLimits({
			free: { projects: { kind: "count", value: null } },
		});
		expect(result.free.projects).toEqual({
			kind: "count",
			value: null,
			per_seat: false,
			display_label: null,
		});
	});

	it("respects each key's minimum (members ≥ 1, days ≥ 1)", () => {
		const result = normalizePlanLimits({
			free: {
				members: { kind: "count", value: 0 },
				activity_retention_days: { kind: "days", value: 0 },
				projects: { kind: "count", value: 0 },
			},
		});
		expect(result.free.members).toEqual(DEFAULT_PLAN_LIMITS.free.members);
		expect(result.free.activity_retention_days).toEqual(
			DEFAULT_PLAN_LIMITS.free.activity_retention_days,
		);
		expect(cellValue(result.free.projects)).toBe(0);
	});

	it("rejects a cell whose kind disagrees with the key", () => {
		const result = normalizePlanLimits({
			pro: {
				time_tracking: { kind: "count", value: 3 },
				projects: { kind: "feature", enabled: true },
			},
		});
		expect(result.pro.time_tracking).toEqual(
			DEFAULT_PLAN_LIMITS.pro.time_tracking,
		);
		expect(result.pro.projects).toEqual(DEFAULT_PLAN_LIMITS.pro.projects);
	});

	it("validates feature cells", () => {
		const result = normalizePlanLimits({
			pro: {
				change_requests: { kind: "feature", enabled: "yes" },
				decisions: { kind: "feature", enabled: false },
			},
		});
		expect(result.pro.change_requests).toEqual(
			DEFAULT_PLAN_LIMITS.pro.change_requests,
		);
		expect(isEnabled(result.pro.decisions)).toBe(false);
	});

	it("allows per_seat only on a quota", () => {
		const result = normalizePlanLimits({
			free: {
				projects: { kind: "count", value: 2, per_seat: true },
				ai_messages_monthly: { kind: "quota", value: 60, per_seat: true },
			},
		});
		expect(result.free.projects).toMatchObject({ per_seat: false });
		expect(result.free.ai_messages_monthly).toMatchObject({
			value: 60,
			per_seat: true,
		});
	});

	it("keeps a short display label and drops a bad one", () => {
		const result = normalizePlanLimits({
			enterprise: {
				ai_messages_monthly: {
					kind: "quota",
					value: null,
					per_seat: false,
					display_label: "  Custom  ",
				},
				mcp_server: {
					kind: "feature",
					enabled: true,
					display_label: "x".repeat(41),
				},
			},
		});
		expect(result.enterprise.ai_messages_monthly.display_label).toBe("Custom");
		expect(result.enterprise.mcp_server.display_label).toBeNull();
	});

	it("ignores unknown keys and unknown plans", () => {
		const result = normalizePlanLimits({
			platinum: { projects: { kind: "count", value: 99 } },
			free: { rocket_launches: { kind: "count", value: 3 } },
		});
		expect(Object.keys(result)).toEqual([...PLAN_ORDER]);
		expect(Object.keys(result.free)).not.toContain("rocket_launches");
		expect(result).toEqual(DEFAULT_PLAN_LIMITS);
	});

	it("never hands out the frozen defaults themselves", () => {
		const result = normalizeLimits(null, DEFAULT_PLAN_LIMITS.free);
		expect(result.projects).not.toBe(DEFAULT_PLAN_LIMITS.free.projects);
		expect(Object.isFrozen(result.projects)).toBe(false);
	});
});

describe("reading cells", () => {
	it("reads a numeric value, with null as unlimited", () => {
		expect(cellValue(DEFAULT_PLAN_LIMITS.free.projects)).toBe(2);
		expect(cellValue(DEFAULT_PLAN_LIMITS.business.projects)).toBeNull();
		expect(cellValue(DEFAULT_PLAN_LIMITS.free, "teams")).toBe(2);
	});

	it("reads features and missing cells fail-open", () => {
		expect(cellValue(DEFAULT_PLAN_LIMITS.free.decisions)).toBeNull();
		expect(cellValue(undefined)).toBeNull();
		expect(isEnabled(DEFAULT_PLAN_LIMITS.free.decisions)).toBe(false);
		expect(isEnabled(DEFAULT_PLAN_LIMITS.pro, "decisions")).toBe(true);
		expect(isEnabled(DEFAULT_PLAN_LIMITS.pro, "not_a_key")).toBe(true);
		expect(isEnabled(null)).toBe(true);
	});
});

describe("nextPlanWith", () => {
	it("finds the next plan with a looser count", () => {
		expect(nextPlanWith("projects", "free", DEFAULT_PLAN_LIMITS)).toBe("pro");
		expect(nextPlanWith("projects", "pro", DEFAULT_PLAN_LIMITS)).toBe(
			"business",
		);
		expect(nextPlanWith("teams", "pro", DEFAULT_PLAN_LIMITS)).toBe("business");
	});

	it("honours how many are needed", () => {
		expect(nextPlanWith("projects", "free", DEFAULT_PLAN_LIMITS, 3)).toBe(
			"pro",
		);
		expect(nextPlanWith("projects", "free", DEFAULT_PLAN_LIMITS, 11)).toBe(
			"business",
		);
	});

	it("finds the first plan that switches a feature on", () => {
		expect(nextPlanWith("decisions", "free", DEFAULT_PLAN_LIMITS)).toBe("pro");
		expect(nextPlanWith("roles_permissions", "free", DEFAULT_PLAN_LIMITS)).toBe(
			"business",
		);
		expect(nextPlanWith("saml_scim", "pro", DEFAULT_PLAN_LIMITS)).toBe(
			"enterprise",
		);
	});

	it("returns null when nothing is looser", () => {
		expect(nextPlanWith("projects", "enterprise", DEFAULT_PLAN_LIMITS)).toBe(
			null,
		);
		expect(nextPlanWith("decisions", "pro", DEFAULT_PLAN_LIMITS)).toBeNull();
		expect(nextPlanWith("members", "pro", DEFAULT_PLAN_LIMITS)).toBeNull();
	});

	it("follows an admin edit to the live matrix", () => {
		const edited = edit("pro", "projects", {
			kind: "count",
			value: 2,
			per_seat: false,
			display_label: null,
		});
		expect(nextPlanWith("projects", "free", edited)).toBe("business");
	});
});
