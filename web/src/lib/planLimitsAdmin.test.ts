import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN_LIMITS, type LimitCell } from "./planLimits";
import {
	compFallbackPlan,
	compUntilToIso,
	describeCell,
	diffPlanLimits,
	dirtyChanges,
	findTierInversions,
	isoToDateInput,
	isPlanLimitsStaleError,
	isTighter,
	type LimitCellsByPlan,
	limitedFallback,
	mergeDraft,
	minimumFor,
	type PlanLimitsDraft,
	readAdminErrorCode,
	sameCell,
	validateCell,
	withDraftCell,
} from "./planLimitsAdmin";

const server: LimitCellsByPlan = DEFAULT_PLAN_LIMITS;

const KEYS = [
	{ key: "projects", label: "Projects", enforced: true },
	{ key: "teams", label: "Teams", enforced: true },
	{ key: "ai_messages_monthly", label: "AI messages", enforced: false },
	{ key: "change_requests", label: "Change requests", enforced: true },
	{
		key: "activity_retention_days",
		label: "Activity log retention",
		enforced: true,
	},
];

const count = (value: number | null): LimitCell => ({
	kind: "count",
	value,
	per_seat: false,
	display_label: null,
});

describe("sameCell", () => {
	it("ignores server metadata and blank labels", () => {
		const stored = {
			...count(2),
			updated_at: "2026-09-22T00:00:00Z",
			updated_by: "u-1",
		};
		expect(sameCell(count(2), stored)).toBe(true);
		expect(sameCell({ ...count(2), display_label: "  " }, count(2))).toBe(true);
	});

	it("treats a cleared input (NaN) as a change", () => {
		expect(sameCell(count(Number.NaN), count(Number.NaN))).toBe(false);
	});

	it("compares features by enabled and label", () => {
		const on: LimitCell = {
			kind: "feature",
			enabled: true,
			display_label: null,
		};
		expect(sameCell(on, { ...on, enabled: false })).toBe(false);
		expect(sameCell(on, { ...on, display_label: "Granular" })).toBe(false);
	});
});

describe("withDraftCell / dirtyChanges", () => {
	it("records an edit and drops it when set back to the stored value", () => {
		let draft: PlanLimitsDraft = {};
		draft = withDraftCell(draft, server, "free", "projects", count(3));
		expect(draft.free?.projects).toEqual(count(3));
		draft = withDraftCell(draft, server, "free", "projects", count(2));
		expect(draft).toEqual({});
	});

	it("emits only changed cells, with the fields their kind takes", () => {
		let draft: PlanLimitsDraft = {};
		draft = withDraftCell(draft, server, "pro", "teams", count(null));
		draft = withDraftCell(draft, server, "free", "projects", count(3));
		draft = withDraftCell(draft, server, "pro", "ai_messages_monthly", {
			kind: "quota",
			value: 750,
			per_seat: true,
			display_label: null,
		});
		draft = withDraftCell(draft, server, "free", "change_requests", {
			kind: "feature",
			enabled: true,
			display_label: " Beta ",
		});
		expect(dirtyChanges(draft, server)).toEqual([
			{ plan: "free", key: "projects", value: 3, display_label: null },
			{
				plan: "free",
				key: "change_requests",
				enabled: true,
				display_label: "Beta",
			},
			{ plan: "pro", key: "teams", value: null, display_label: null },
			{
				plan: "pro",
				key: "ai_messages_monthly",
				value: 750,
				per_seat: true,
				display_label: null,
			},
		]);
	});

	it("re-diffs against a newer server, keeping only real differences", () => {
		const draft: PlanLimitsDraft = { free: { projects: count(3) } };
		const newer: LimitCellsByPlan = {
			...server,
			free: { ...server.free, projects: count(3) },
		};
		expect(dirtyChanges(draft, newer)).toEqual([]);
	});
});

describe("validateCell", () => {
	it("accepts unlimited and in-range whole numbers", () => {
		expect(validateCell(count(null))).toBeNull();
		expect(validateCell(count(0))).toBeNull();
		expect(validateCell(count(1_000_000_000))).toBeNull();
	});

	it("rejects blanks, fractions, values under the floor and over the cap", () => {
		expect(validateCell(count(Number.NaN))).toMatch(/whole number/);
		expect(validateCell(count(1.5))).toMatch(/whole number/);
		expect(validateCell(count(0), 1)).toBe("At least 1, or Unlimited.");
		expect(validateCell(count(1_000_000_001))).toMatch(/At most/);
		expect(
			validateCell(
				{ kind: "days", value: 0, per_seat: false, display_label: null },
				1,
			),
		).toBe("At least 1 day, or Unlimited.");
	});

	it("caps pricing labels at 40 characters", () => {
		expect(
			validateCell({
				kind: "feature",
				enabled: true,
				display_label: "x".repeat(41),
			}),
		).toMatch(/40 characters/);
	});
});

describe("minimumFor / limitedFallback", () => {
	it("never lets days or members go under 1", () => {
		expect(minimumFor("members", "count")).toBe(1);
		expect(minimumFor("members", "count", 0)).toBe(1);
		expect(minimumFor("activity_retention_days", "days", 0)).toBe(1);
		expect(minimumFor("projects", "count")).toBe(0);
		expect(minimumFor("projects", "count", 2)).toBe(2);
	});

	it("restores the stored number, else the seed, else the floor", () => {
		expect(limitedFallback("free", "projects", count(5), 0)).toBe(5);
		expect(limitedFallback("pro", "teams", count(null), 0)).toBe(3);
		expect(limitedFallback("business", "teams", count(null), 0)).toBe(1);
	});
});

describe("describeCell / isTighter / diffPlanLimits", () => {
	it("describes cells the way the review dialog lists them", () => {
		expect(describeCell(count(null))).toBe("Unlimited");
		expect(
			describeCell({
				kind: "quota",
				value: 2000,
				per_seat: true,
				display_label: null,
			}),
		).toBe("2,000 / seat");
		expect(
			describeCell({
				kind: "feature",
				enabled: true,
				display_label: "Granular",
			}),
		).toBe('On ("Granular")');
		expect(
			describeCell({
				kind: "days",
				value: 7,
				per_seat: false,
				display_label: null,
			}),
		).toBe("7 days");
	});

	it("knows which edits tighten", () => {
		expect(isTighter(count(null), count(10))).toBe(true);
		expect(isTighter(count(10), count(5))).toBe(true);
		expect(isTighter(count(5), count(10))).toBe(false);
		expect(isTighter(count(5), count(null))).toBe(false);
		expect(
			isTighter(
				{ kind: "feature", enabled: true, display_label: null },
				{ kind: "feature", enabled: false, display_label: null },
			),
		).toBe(true);
	});

	it("writes one line per change", () => {
		const draft: PlanLimitsDraft = {
			free: { projects: count(3) },
			pro: { teams: count(1) },
		};
		const lines = diffPlanLimits(server, draft, KEYS);
		expect(lines.map((line) => line.text)).toEqual([
			"Free · Projects: 2 → 3",
			"Pro · Teams: 3 → 1",
		]);
		expect(lines.map((line) => line.tightened)).toEqual([false, true]);
		expect(lines.every((line) => line.enforced)).toBe(true);
	});
});

describe("findTierInversions", () => {
	it("is quiet for the seed", () => {
		expect(findTierInversions(server, KEYS)).toEqual([]);
	});

	it("warns when a cheaper plan is more generous", () => {
		const cells = mergeDraft(server, {
			free: { projects: count(20) },
			business: {
				change_requests: {
					kind: "feature",
					enabled: false,
					display_label: null,
				},
			},
		});
		expect(findTierInversions(cells, KEYS)).toEqual([
			"Free is more generous than Pro for Projects.",
			"Pro is more generous than Business for Change requests.",
		]);
	});

	it("checks only the keys asked about", () => {
		const cells = mergeDraft(server, { free: { projects: count(20) } });
		expect(findTierInversions(cells, KEYS, ["teams"])).toEqual([]);
	});

	it("skips per-seat against per-workspace quotas", () => {
		const cells = mergeDraft(server, {
			free: {
				ai_messages_monthly: {
					kind: "quota",
					value: 5000,
					per_seat: false,
					display_label: null,
				},
			},
		});
		expect(findTierInversions(cells, KEYS, ["ai_messages_monthly"])).toEqual(
			[],
		);
	});
});

describe("admin error codes", () => {
	it("reads the filter's envelope, a service error's code, and causes", () => {
		const axiosLike = {
			code: "ERR_BAD_REQUEST",
			response: {
				status: 409,
				data: { error: { code: "plan_limits_stale", message: "…" } },
			},
		};
		expect(readAdminErrorCode(axiosLike)).toBe("plan_limits_stale");
		expect(isPlanLimitsStaleError(axiosLike)).toBe(true);
		expect(
			isPlanLimitsStaleError(
				Object.assign(new Error("x"), { code: "plan_limits_stale" }),
			),
		).toBe(true);
		expect(
			isPlanLimitsStaleError(new Error("wrapped", { cause: axiosLike })),
		).toBe(true);
		expect(readAdminErrorCode({ code: "ERR_NETWORK" })).toBeNull();
		expect(isPlanLimitsStaleError(new Error("boom"))).toBe(false);
	});
});

describe("complimentary plan helpers", () => {
	it("falls back to the paid plan only while it is paying", () => {
		expect(compFallbackPlan({ plan: "pro", status: "active" })).toBe("pro");
		expect(compFallbackPlan({ plan: "business", status: "past_due" })).toBe(
			"business",
		);
		expect(compFallbackPlan({ plan: "pro", status: "canceled" })).toBe("free");
		expect(compFallbackPlan({ plan: "free", status: null })).toBe("free");
	});

	it("round-trips an end date as the end of that local day", () => {
		const iso = compUntilToIso("2026-12-31");
		expect(iso).not.toBeNull();
		const date = new Date(iso as string);
		expect(date.getFullYear()).toBe(2026);
		expect(date.getMonth()).toBe(11);
		expect(date.getDate()).toBe(31);
		expect(date.getHours()).toBe(23);
		expect(isoToDateInput(iso)).toBe("2026-12-31");
		expect(compUntilToIso("")).toBeNull();
		expect(compUntilToIso("31/12/2026")).toBeNull();
		expect(isoToDateInput(null)).toBe("");
	});
});
