import { describe, expect, it } from "vitest";
import type {
	LoggingForResult,
	LoggingOption,
	UnavailableOption,
} from "@/services/time.types";
import {
	defaultRemember,
	findOption,
	forChipOptionFromEntry,
	forIconKind,
	forMode,
	forOptionKey,
	governingEngagementId,
	isSameFor,
	preselectedOption,
	resultFromErrorExtras,
	sortForOptions,
	sortUnavailable,
	toForRequest,
	truncateLabel,
} from "./forOptions";

const TEAM = "11111111-1111-4111-8111-111111111111";
const WS = "22222222-2222-4222-8222-222222222222";
const ASG = "33333333-3333-4333-8333-333333333333";

function option(
	kind: LoggingOption["kind"],
	id: string | null,
	label: string,
	over: Partial<LoggingOption> = {},
): LoggingOption {
	return {
		kind,
		id,
		label,
		sheet_scope: kind === "personal" ? null : { kind: "workspace", ref: WS },
		rate_source: "none",
		workspace_tag: null,
		approver_hint: kind === "personal" ? null : "workspace",
		...over,
	};
}

const team = option("team", TEAM, "Prodigitality Services Inc. Team", {
	approver_hint: "team",
});
const agreement = option("assignment", ASG, "Acme Corp", {
	approver_hint: "hirer",
	sheet_scope: { kind: "engagement", ref: ASG },
});
const workspace = option("workspace", WS, "Acme");
const personal = option("personal", null, "Just me");

function result(over: Partial<LoggingForResult>): LoggingForResult {
	return {
		options: [],
		selected: null,
		prefill: null,
		unavailable: [],
		...over,
	};
}

describe("forMode", () => {
	it("maps each option count to its behaviour", () => {
		expect(forMode(null)).toBe("none");
		expect(forMode(result({ options: [], reason: "none" }))).toBe("none");
		expect(forMode(result({ options: [team], selected: team }))).toBe("single");
		expect(forMode(result({ options: [personal], selected: personal }))).toBe(
			"single",
		);
		expect(forMode(result({ options: [team, agreement] }))).toBe("choose");
		expect(
			forMode(result({ options: [team, agreement], prefill: agreement })),
		).toBe("confirm");
	});
});

describe("keys and equality", () => {
	it("keys personal without an id and compares ids case-insensitively", () => {
		expect(forOptionKey(personal)).toBe("personal:");
		expect(forOptionKey({ kind: "personal", id: "x" })).toBe("personal:");
		expect(forOptionKey(team)).toBe(`team:${TEAM}`);
		expect(isSameFor(team, { kind: "team", id: TEAM.toUpperCase() })).toBe(
			true,
		);
		expect(isSameFor(team, { kind: "workspace", id: TEAM })).toBe(false);
		expect(isSameFor(null, team)).toBe(false);
	});

	it("writes the request body (personal has a null id)", () => {
		expect(toForRequest(personal)).toEqual({ kind: "personal", id: null });
		expect(toForRequest(team)).toEqual({ kind: "team", id: TEAM });
	});

	it("finds an option by key", () => {
		const r = result({ options: [team, agreement] });
		expect(findOption(r, forOptionKey(agreement))).toBe(agreement);
		expect(findOption(r, "nope")).toBeNull();
		expect(findOption(null, "x")).toBeNull();
	});
});

describe("ordering", () => {
	it("puts agreements first and keeps server order within a kind", () => {
		const second = option("assignment", "a2", "Pixel Studio");
		expect(
			sortForOptions([team, workspace, agreement, personal, second]).map(
				(o) => o.label,
			),
		).toEqual([
			"Acme Corp",
			"Pixel Studio",
			"Prodigitality Services Inc. Team",
			"Acme",
			"Just me",
		]);
	});

	it("orders unavailable options the same way", () => {
		const off: UnavailableOption[] = [
			{ kind: "team", id: TEAM, label: "Design", reason: "team_time_off" },
			{ kind: "assignment", id: ASG, label: "Acme", reason: "no_settings" },
		];
		expect(sortUnavailable(off).map((u) => u.kind)).toEqual([
			"assignment",
			"team",
		]);
		expect(sortUnavailable(undefined)).toEqual([]);
	});
});

describe("preselection and remember (L38)", () => {
	it("preselects the remembered default but nothing on a first choice", () => {
		expect(
			preselectedOption(result({ options: [team, agreement] })),
		).toBeNull();
		expect(
			preselectedOption(
				result({ options: [team, agreement], prefill: agreement }),
			),
		).toBe(agreement);
		expect(preselectedOption(result({ options: [team], selected: team }))).toBe(
			team,
		);
	});

	it("ticks remember the first time, and afterwards only for a different pick", () => {
		const first = result({ options: [team, agreement] });
		expect(defaultRemember(first, null)).toBe(true);
		expect(defaultRemember(first, team)).toBe(true);
		const later = result({ options: [team, agreement], prefill: agreement });
		expect(defaultRemember(later, agreement)).toBe(false);
		expect(defaultRemember(later, team)).toBe(true);
	});
});

describe("resultFromErrorExtras", () => {
	it("rebuilds the picker from a LOGGING_FOR_REQUIRED body", () => {
		const r = resultFromErrorExtras(
			{ options: [team, agreement], prefill: team },
			result({
				unavailable: [
					{ kind: "workspace", id: WS, label: "Acme", reason: "plan" },
				],
			}),
		);
		expect(r?.options).toEqual([team, agreement]);
		expect(r?.prefill).toBe(team);
		expect(r?.selected).toBeNull();
		expect(r?.reason).toBe("confirm");
		expect(r?.unavailable).toHaveLength(1);
	});

	it("drops a prefill that is not among the options and junk entries", () => {
		const r = resultFromErrorExtras({
			options: [team, null, { kind: "team" }, agreement],
			prefill: workspace,
		});
		expect(r?.options).toEqual([team, agreement]);
		expect(r?.prefill).toBeNull();
		expect(r?.reason).toBe("required");
	});

	it("selects a lone option and reads an empty list as none", () => {
		expect(resultFromErrorExtras({ options: [team] })?.selected).toBe(team);
		expect(resultFromErrorExtras({ options: [] })?.reason).toBe("none");
		expect(resultFromErrorExtras({ detail: "x" })).toBeNull();
		expect(resultFromErrorExtras(undefined)).toBeNull();
	});
});

describe("chip helpers", () => {
	it("cuts labels at 22 characters plus an ellipsis, keeping the full label", () => {
		expect(truncateLabel("Prodigitality Services Inc. Team")).toEqual({
			text: "Prodigitality Services…",
			full: "Prodigitality Services Inc. Team",
			truncated: true,
		});
		expect(truncateLabel("Acme").truncated).toBe(false);
		expect(
			truncateLabel("Prodigitality Services Inc. Team", 32).truncated,
		).toBe(false);
		expect(truncateLabel(null).text).toBe("");
	});

	it("maps kinds to icon families", () => {
		expect(forIconKind("assignment")).toBe("agreement");
		expect(forIconKind("team")).toBe("team");
		expect(forIconKind("workspace")).toBe("workspace");
		expect(forIconKind("personal")).toBe("personal");
	});

	it("builds a chip from an entry's recorded For", () => {
		expect(
			forChipOptionFromEntry({
				context_kind: "team",
				context_ref: TEAM,
				context_label_snapshot: "Design",
			}),
		).toEqual({ kind: "team", id: TEAM, label: "Design" });
		expect(
			forChipOptionFromEntry({
				context_kind: "personal",
				context_ref: null,
				context_label_snapshot: null,
			}),
		).toEqual({ kind: "personal", id: null, label: "Just me" });
	});

	it("reads the governing engagement (A8) only for agreements", () => {
		expect(
			governingEngagementId({ kind: "assignment", engagement_id: "e1" }),
		).toBe("e1");
		expect(
			governingEngagementId({ kind: "assignment" }, { engagement_id: "e2" }),
		).toBe("e2");
		expect(
			governingEngagementId({ kind: "team", engagement_id: "e1" }),
		).toBeNull();
		expect(governingEngagementId({ kind: "assignment" })).toBeNull();
	});
});
