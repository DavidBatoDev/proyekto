import { describe, expect, it } from "vitest";
import {
	buildEntitlements,
	computeMeter,
	normalizeWorkspaceUsage,
	usedFor,
	type WorkspaceUsage,
} from "./entitlements";
import { DEFAULT_PLAN_LIMITS, normalizeLimits } from "./planLimits";

function usage(overrides: Partial<WorkspaceUsage> = {}): WorkspaceUsage {
	return {
		workspace_id: "ws-1",
		plan: { effective: "free", source: "default", complimentary: null },
		subscription: null,
		limits: normalizeLimits(null, DEFAULT_PLAN_LIMITS.free),
		usage: { members: 4, pending_invites: 2, projects: 1, teams: 2 },
		counts_pending_invites: true,
		roadmaps: { largest: null, near_limit: [] },
		features: [],
		retention_days: 7,
		upgrade_plan: "pro",
		generated_at: "2026-09-22T00:00:00.000Z",
		...overrides,
	};
}

describe("computeMeter", () => {
	it("is ok at half", () => {
		expect(computeMeter(1, 2)).toEqual({
			used: 1,
			limit: 2,
			percent: 50,
			remaining: 1,
			overBy: 0,
			tone: "ok",
		});
	});

	it("warns from 80%", () => {
		expect(computeMeter(8, 10)).toMatchObject({
			percent: 80,
			remaining: 2,
			tone: "warning",
		});
		expect(computeMeter(7, 10).tone).toBe("ok");
	});

	it("is at the limit when used equals it", () => {
		expect(computeMeter(10, 10)).toMatchObject({
			percent: 100,
			remaining: 0,
			overBy: 0,
			tone: "limit",
		});
	});

	it("is over — grandfathered — past the limit, with percent clamped", () => {
		expect(computeMeter(12, 10)).toMatchObject({
			percent: 100,
			remaining: 0,
			overBy: 2,
			tone: "over",
		});
	});

	it("is unlimited for a null limit", () => {
		expect(computeMeter(3, null)).toEqual({
			used: 3,
			limit: null,
			percent: 0,
			remaining: null,
			overBy: 0,
			tone: "unlimited",
		});
	});

	it("treats a zero limit as reached even with nothing used", () => {
		expect(computeMeter(0, 0)).toMatchObject({
			percent: 100,
			remaining: 0,
			tone: "limit",
		});
	});

	it("never reports negative usage", () => {
		expect(computeMeter(-5, 10)).toMatchObject({ used: 0, tone: "ok" });
		expect(computeMeter(Number.NaN, 10).used).toBe(0);
	});
});

describe("usedFor", () => {
	it("adds pending invites to members only when the server says they count", () => {
		expect(usedFor(usage(), "members")).toBe(6);
		expect(usedFor(usage({ counts_pending_invites: false }), "members")).toBe(
			4,
		);
		expect(usedFor(usage(), "projects")).toBe(1);
	});
});

describe("buildEntitlements", () => {
	it("fails open while loading and when unavailable", () => {
		for (const status of ["loading", "unavailable"] as const) {
			const entitlements = buildEntitlements(null, status);
			expect(entitlements.status).toBe(status);
			expect(entitlements.canCreate("projects")).toBe(true);
			expect(entitlements.canCreate("members", 500)).toBe(true);
			expect(entitlements.hasFeature("time_tracking")).toBe(true);
			expect(entitlements.meter("teams")).toBeNull();
			expect(entitlements.remaining("teams")).toBeNull();
		}
	});

	it("downgrades a 'ready' with no payload to unavailable", () => {
		expect(buildEntitlements(null, "ready").status).toBe("unavailable");
	});

	it("blocks exactly at the limit", () => {
		const entitlements = buildEntitlements(usage(), "ready");
		expect(entitlements.canCreate("teams")).toBe(false);
		expect(entitlements.canCreate("projects")).toBe(true);
		expect(entitlements.meter("teams")?.tone).toBe("limit");
	});

	it("checks a batch against what is left", () => {
		const entitlements = buildEntitlements(
			usage({
				usage: { members: 6, pending_invites: 2, projects: 0, teams: 0 },
			}),
			"ready",
		);
		// 10 − (6 + 2 pending) = 2 left.
		expect(entitlements.remaining("members")).toBe(2);
		expect(entitlements.canCreate("members", 2)).toBe(true);
		expect(entitlements.canCreate("members", 3)).toBe(false);
	});

	it("counts pending invites only when flagged", () => {
		const base = {
			usage: { members: 9, pending_invites: 1, projects: 0, teams: 0 },
		};
		expect(buildEntitlements(usage(base), "ready").canCreate("members")).toBe(
			false,
		);
		expect(
			buildEntitlements(
				usage({ ...base, counts_pending_invites: false }),
				"ready",
			).canCreate("members"),
		).toBe(true);
	});

	it("never blocks an unlimited count or a zero-sized batch", () => {
		const entitlements = buildEntitlements(
			usage({
				plan: {
					effective: "business",
					source: "subscription",
					complimentary: null,
				},
				limits: normalizeLimits(null, DEFAULT_PLAN_LIMITS.business),
				usage: { members: 400, pending_invites: 0, projects: 90, teams: 40 },
			}),
			"ready",
		);
		expect(entitlements.canCreate("projects", 50)).toBe(true);
		expect(entitlements.meter("projects")?.tone).toBe("unlimited");
		expect(buildEntitlements(usage(), "ready").canCreate("teams", 0)).toBe(
			true,
		);
	});

	it("reads features from the effective plan's cells", () => {
		const free = buildEntitlements(usage(), "ready");
		expect(free.hasFeature("time_tracking")).toBe(false);
		expect(free.hasFeature("some_future_key")).toBe(true);
		const pro = buildEntitlements(
			usage({ limits: normalizeLimits(null, DEFAULT_PLAN_LIMITS.pro) }),
			"ready",
		);
		expect(pro.hasFeature("time_tracking")).toBe(true);
	});

	it("names the plan and flags a complimentary one", () => {
		const entitlements = buildEntitlements(
			usage({
				plan: {
					effective: "business",
					source: "complimentary",
					complimentary: { plan: "business", since: null, until: null },
				},
			}),
			"ready",
		);
		expect(entitlements.plan).toBe("business");
		expect(entitlements.planName).toBe("Business");
		expect(entitlements.isComplimentary).toBe(true);
	});
});

describe("normalizeWorkspaceUsage", () => {
	it("rejects a body with no usage counts", () => {
		expect(() => normalizeWorkspaceUsage(null, "ws-1")).toThrow();
		expect(() => normalizeWorkspaceUsage({ plan: {} }, "ws-1")).toThrow();
	});

	it("fills gaps from the effective plan's seed and zero counts", () => {
		const result = normalizeWorkspaceUsage(
			{
				plan: { effective: "pro", source: "subscription" },
				usage: { members: 3, projects: "7" },
				roadmaps: {
					largest: { roadmap_id: "r1", name: null, nodes: 40 },
					near_limit: [{ nodes: 3 }, { roadmap_id: "r2", nodes: 9 }],
				},
			},
			"ws-9",
		);
		expect(result.workspace_id).toBe("ws-9");
		expect(result.plan).toEqual({
			effective: "pro",
			source: "subscription",
			complimentary: null,
		});
		expect(result.limits.projects).toEqual(DEFAULT_PLAN_LIMITS.pro.projects);
		expect(result.usage).toEqual({
			members: 3,
			pending_invites: 0,
			projects: 0,
			teams: 0,
		});
		expect(result.counts_pending_invites).toBe(true);
		expect(result.roadmaps.largest?.nodes).toBe(40);
		expect(result.roadmaps.near_limit.map((r) => r.roadmap_id)).toEqual(["r2"]);
		expect(result.retention_days).toBe(90);
	});

	it("keeps a complimentary plan and an explicit unlimited retention", () => {
		const result = normalizeWorkspaceUsage(
			{
				plan: {
					effective: "business",
					source: "complimentary",
					complimentary: { plan: "business", since: "2026-09-01", until: null },
				},
				usage: { members: 1, pending_invites: 0, projects: 0, teams: 0 },
				retention_days: null,
				upgrade_plan: "enterprise",
			},
			"ws-1",
		);
		expect(result.plan.complimentary).toEqual({
			plan: "business",
			since: "2026-09-01",
			until: null,
		});
		expect(result.retention_days).toBeNull();
		expect(result.upgrade_plan).toBe("enterprise");
	});
});
