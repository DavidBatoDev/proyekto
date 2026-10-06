import { describe, expect, it } from "vitest";
import type { ReportSummary, TimeEntryView } from "@/services/time.types";
import {
	entry,
	group,
	NOW,
	summary,
	TEAM_ID,
	U1,
	U2,
} from "./__fixtures__/reportFixtures";
import {
	approvalSplitFor,
	approvedSummaryQuery,
	defaultReportRange,
	entryForLabel,
	entryPersonLabel,
	entryWorkLabels,
	exportQuery,
	groupRowLabel,
	isApprovedEntry,
	isPersonRow,
	matchPreset,
	noticeWorkspace,
	pageRangeLabel,
	peopleFromSummary,
	peopleSummaryQuery,
	presetRange,
	reportAmountsAllowed,
	reportFigures,
	reportFilterQuery,
	reportGroupBy,
	reportRangeFrom,
	sectionHeading,
	sectionsFromEntries,
	sectionTotals,
	summaryQuery,
} from "./reportModel";

const CTX = { timezone: "Asia/Manila", weekStart: 1, now: NOW };
const SCOPE = { kind: "team" as const, id: TEAM_ID };

describe("ranges", () => {
	it("counts presets in the scope's timezone and week", () => {
		expect(presetRange("this_month", CTX)).toEqual({
			from: "2026-10-01",
			to: "2026-10-31",
		});
		expect(presetRange("this_week", CTX)).toEqual({
			from: "2026-10-05",
			to: "2026-10-11",
		});
		expect(presetRange("this_week", { ...CTX, weekStart: 7 })).toEqual({
			from: "2026-10-04",
			to: "2026-10-10",
		});
		expect(presetRange("this_year", CTX)).toEqual({
			from: "2026-01-01",
			to: "2026-12-31",
		});
		expect(presetRange("all_time", CTX)).toEqual({
			from: "2000-01-01",
			to: "2026-10-06",
		});
	});

	it("reads today in the scope's zone, not the device's", () => {
		// 2026-10-31T20:00Z is already Nov 1 in Manila.
		const late = { ...CTX, now: new Date("2026-10-31T20:00:00.000Z") };
		expect(presetRange("this_month", late).from).toBe("2026-11-01");
		expect(
			presetRange("this_month", { ...late, timezone: "America/New_York" }).from,
		).toBe("2026-10-01");
	});

	it("matches a range to its preset", () => {
		expect(matchPreset({ from: "2026-10-01", to: "2026-10-31" }, CTX)).toBe(
			"this_month",
		);
		expect(matchPreset({ from: "2026-10-02", to: "2026-10-31" }, CTX)).toBe(
			null,
		);
	});

	it("reads the search, swapping an inverted range and defaulting to this month", () => {
		expect(
			reportRangeFrom({ from: "2026-09-01", to: "2026-09-30" }, CTX),
		).toEqual({ from: "2026-09-01", to: "2026-09-30" });
		expect(
			reportRangeFrom({ from: "2026-09-30", to: "2026-09-01" }, CTX),
		).toEqual({ from: "2026-09-01", to: "2026-09-30" });
		expect(reportRangeFrom({ from: "2026-09-15" }, CTX)).toEqual({
			from: "2026-09-15",
			to: "2026-10-06",
		});
		expect(reportRangeFrom({ to: "2026-09-15" }, CTX)).toEqual({
			from: "2026-09-01",
			to: "2026-09-15",
		});
		expect(reportRangeFrom({ from: "bad" }, CTX)).toEqual(
			defaultReportRange(CTX),
		);
	});
});

describe("queries", () => {
	const range = { from: "2026-09-01", to: "2026-09-30" };

	it("maps the URL filters to the API's names", () => {
		const filters = reportFilterQuery(
			SCOPE,
			{ person: U1, status: "submitted", for: "team", group: "week" },
			range,
		);
		expect(filters).toEqual({
			scope: SCOPE,
			from: "2026-09-01",
			to: "2026-09-30",
			member_user_id: U1,
			status: "submitted",
			context_kind: "team",
		});
		expect(summaryQuery(filters, "week").group_by).toBe("week");
		expect(approvedSummaryQuery(filters, "member")).toMatchObject({
			status: "approved",
			group_by: "member",
		});
	});

	it("lists people without the person and status filters", () => {
		const filters = reportFilterQuery(
			SCOPE,
			{ person: U1, status: "open", for: "assignment" },
			range,
		);
		expect(peopleSummaryQuery(filters)).toEqual({
			scope: SCOPE,
			from: "2026-09-01",
			to: "2026-09-30",
			context_kind: "assignment",
			group_by: "member",
		});
	});

	it("maps UI groups to API groups and leaves group_by off a sections export", () => {
		expect(reportGroupBy("person")).toBe("member");
		expect(reportGroupBy(undefined, "week")).toBe("week");
		const filters = reportFilterQuery(SCOPE, {}, range);
		expect(exportQuery(filters)).not.toHaveProperty("group_by");
		expect(exportQuery(filters, "day").group_by).toBe("day");
	});
});

describe("Approved and Not yet approved", () => {
	const all = summary({
		total_seconds: 43_200,
		payable_seconds: 30_600,
		groups: [
			group({
				key: U1,
				label: "Maria Santos",
				total_seconds: 36_000,
				payable_seconds: 30_600,
				amounts_by_currency: { PHP: 6885, usd: 120 },
			}),
			group({ key: U2, label: "Leo Cruz", total_seconds: 7_200 }),
		],
	});
	// Approved sheets: Maria's 32,000 s logged froze to 30,600 payable (a cap).
	const approved = summary({
		total_seconds: 32_000,
		payable_seconds: 30_600,
		groups: [
			group({ key: U1, total_seconds: 32_000, payable_seconds: 30_600 }),
		],
	});

	it("derives Not yet approved from the approved-sheets summary, by row and in total", () => {
		const { totals, rows } = reportFigures(all, approved, "derive");
		expect(totals.approvedSeconds).toBe(30_600);
		expect(totals.notApprovedSeconds).toBe(11_200);
		expect(
			rows.map((r) => [r.key, r.approvedSeconds, r.notApprovedSeconds]),
		).toEqual([
			[U1, 30_600, 4_000],
			[U2, 0, 7_200],
		]);
	});

	it("keeps Not yet approved unknown while the split loads", () => {
		const { totals, rows } = reportFigures(all, undefined, "derive");
		expect(totals.notApprovedSeconds).toBeNull();
		expect(rows[0].notApprovedSeconds).toBeNull();
	});

	it("needs no split under a status filter or in the client's view", () => {
		expect(approvalSplitFor(undefined)).toBe("derive");
		expect(approvalSplitFor("approved")).toBe("all_approved");
		expect(approvalSplitFor("returned")).toBe("none_approved");
		expect(approvalSplitFor(undefined, true)).toBe("approved_only");
		expect(
			reportFigures(all, null, "all_approved").totals.notApprovedSeconds,
		).toBe(0);
		expect(
			reportFigures(all, null, "none_approved").totals.notApprovedSeconds,
		).toBe(43_200);
		expect(
			reportFigures(all, null, "approved_only").totals.notApprovedSeconds,
		).toBeNull();
	});

	it("prefers the server's own split and billable figures when it sends them", () => {
		const withExtras = {
			...all,
			unapproved_seconds: 9_000,
			billable_seconds: 28_800,
		} as ReportSummary;
		const { totals } = reportFigures(withExtras, undefined, "derive");
		expect(totals.notApprovedSeconds).toBe(9_000);
		expect(totals.billableSeconds).toBe(28_800);
		expect(
			reportFigures(all, approved, "derive").totals.billableSeconds,
		).toBeNull();
	});

	it("totals cost per currency from the rows, upper-cased", () => {
		const { totals, rows } = reportFigures(all, approved, "derive");
		expect(totals.amounts).toEqual({ PHP: 6885, USD: 120 });
		expect(rows[1].amounts).toBeNull();
	});
});

describe("native amounts", () => {
	it("never shows a mixed or agreement amount on native", () => {
		expect(reportAmountsAllowed({ scopeKind: "project", native: false })).toBe(
			true,
		);
		expect(reportAmountsAllowed({ scopeKind: "team", native: true })).toBe(
			true,
		);
		expect(reportAmountsAllowed({ scopeKind: "project", native: true })).toBe(
			false,
		);
		expect(
			reportAmountsAllowed({
				scopeKind: "workspace",
				groupBy: "context",
				rowKey: "assignment:a1",
				native: true,
			}),
		).toBe(false);
		expect(
			reportAmountsAllowed({
				scopeKind: "workspace",
				groupBy: "context",
				rowKey: "team:t1",
				native: true,
			}),
		).toBe(true);
	});
});

describe("row labels", () => {
	const opts = { now: NOW, userTimezone: "Asia/Manila" };

	it("writes days and A5 weeks with the year only when it isn't this year", () => {
		expect(groupRowLabel("day", { key: "2026-10-02", label: "x" }, opts)).toBe(
			"Fri Oct 2",
		);
		expect(groupRowLabel("week", { key: "2026-09-21", label: "x" }, opts)).toBe(
			"Sep 21–27",
		);
		expect(groupRowLabel("week", { key: "2026-09-28", label: "x" }, opts)).toBe(
			"Sep 28–Oct 4",
		);
		expect(groupRowLabel("week", { key: "2025-09-22", label: "x" }, opts)).toBe(
			"Sep 22–28, 2025",
		);
	});

	it("names For rows and keeps the server's other labels", () => {
		expect(
			groupRowLabel("context", { key: "workspace:w1", label: "Acme" }),
		).toBe("Acme · workspace");
		expect(
			groupRowLabel("context", { key: "assignment:a1", label: "Acme Corp" }),
		).toBe("Acme Corp · agreement");
		expect(
			groupRowLabel("member", { key: "masked:a1", label: "Delivery team" }),
		).toBe("Delivery team");
		expect(groupRowLabel("project", { key: "none", label: "" })).toBe("—");
	});

	it("filters only to real people", () => {
		expect(isPersonRow("member", U1)).toBe(true);
		expect(isPersonRow("member", "masked:a1")).toBe(false);
		expect(isPersonRow("project", U1)).toBe(false);
		expect(
			peopleFromSummary(
				summary({
					groups: [
						group({ key: U2, label: "Leo Cruz" }),
						group({ key: "masked:a1", label: "Delivery team" }),
						group({ key: U1, label: "Ana Reyes" }),
					],
				}),
			),
		).toEqual([
			{ id: U1, label: "Ana Reyes" },
			{ id: U2, label: "Leo Cruz" },
		]);
	});

	it("pages and plan notices", () => {
		expect(pageRangeLabel(2, 50, 312)).toBe("51–100 of 312");
		expect(pageRangeLabel(7, 50, 312)).toBe("301–312 of 312");
		expect(noticeWorkspace({ id: "w" })).toBeNull();
		expect(
			noticeWorkspace({ id: "w", slug: "acme", my_role: "owner" }),
		).toEqual({
			slug: "acme",
			my_role: "owner",
		});
	});
});

describe("entry cells", () => {
	it("masks people and hides projects the viewer can't open", () => {
		const masked = entry({
			identity: "masked",
			member_user_id: null,
			member: null,
			member_display_name_snapshot: null,
			member_label: "Delivery team",
		});
		expect(entryPersonLabel(masked)).toBe("Delivery team");
		expect(entryPersonLabel(entry())).toBe("Maria Santos");
		const hidden = entry({
			content: "hidden",
			task: null,
			project: null,
			task_id: null,
			work_item: "meeting",
			content_label: "A project you can't open",
		});
		expect(entryWorkLabels(hidden)).toEqual({
			project: "A project you can't open",
			work: "Meeting",
			hidden: true,
		});
		expect(entryWorkLabels(entry())).toEqual({
			project: "Acme Website",
			work: "Fix login bug",
			hidden: false,
		});
	});

	it("labels agreement time per platform", () => {
		const agreement = entry({
			context_kind: "assignment",
			context_label_snapshot: "Acme Corp",
		});
		expect(entryForLabel(agreement, { native: false }).text).toBe(
			"Acme Corp · agreement",
		);
		expect(entryForLabel(agreement, { native: true }).text).toBe("Acme Corp");
		const long = entryForLabel(
			entry({ context_label_snapshot: "Prodigitality Services Inc. Team" }),
		);
		expect(long).toEqual({
			text: "Prodigitality Services…",
			title: "Prodigitality Services Inc. Team",
		});
	});

	it("counts approved time per CHANGE-5", () => {
		expect(isApprovedEntry(entry({ payable_seconds: 3600 }))).toBe(true);
		expect(isApprovedEntry(entry({ payable_seconds: null }))).toBe(false);
		expect(
			isApprovedEntry(entry({ payable_seconds: 0, legacy_status: "rejected" })),
		).toBe(false);
	});
});

describe("sections", () => {
	const entries: TimeEntryView[] = [
		entry({
			id: "a",
			context_label_snapshot: "Prodigitality Services Inc. Team",
			payable_seconds: 3600,
			cost: "visible",
			currency_snapshot: "php",
			amount_snapshot: 100,
		}),
		entry({
			id: "b",
			context_label_snapshot: "Prodigitality Services Inc. Team",
			member_user_id: U2,
			member: { id: U2, display_name: "Leo Cruz", avatar_url: null },
			duration_seconds: 1800,
			cost: "visible",
		}),
		entry({
			id: "c",
			context_kind: "assignment",
			context_ref: "as1",
			context_label_snapshot: "Acme Corp",
			identity: "masked",
			member_user_id: null,
			member: null,
			member_display_name_snapshot: null,
			member_label: "Delivery team",
			payable_seconds: 7200,
			duration_seconds: 7200,
		}),
		entry({
			id: "d",
			context_kind: "workspace",
			context_ref: "w1",
			context_label_snapshot: "Acme",
			payable_seconds: 600,
			duration_seconds: 600,
			work_type_snapshot: "training",
		}),
		entry({ id: "e", context_kind: "personal", context_ref: null }),
		entry({
			id: "f",
			payable_seconds: 0,
			legacy_status: "rejected",
			duration_seconds: 2_678_400,
		}),
	];

	it("groups by context, then person, keeping the approval split apart", () => {
		const sections = sectionsFromEntries(entries);
		expect(sections.map((s) => s.key)).toEqual([
			"team:t1",
			"workspace:w1",
			"assignment:as1",
		]);
		const [team, workspace, agreement] = sections;
		expect(team).toMatchObject({
			approvedSeconds: 3600,
			notApprovedSeconds: 1800,
			billableSeconds: 3600,
			amounts: { PHP: 100 },
			costVisible: true,
			allMasked: false,
		});
		expect(
			team.people.map((p) => [
				p.label,
				p.approvedSeconds,
				p.notApprovedSeconds,
			]),
		).toEqual([
			["Leo Cruz", 0, 1800],
			["Maria Santos", 3600, 0],
		]);
		expect(workspace.billableSeconds).toBe(0);
		expect(agreement).toMatchObject({
			allMasked: true,
			costVisible: false,
			amounts: null,
		});
		expect(agreement.people).toHaveLength(1);
		expect(agreement.people[0]).toMatchObject({
			label: "Delivery team",
			masked: true,
		});
	});

	it("heads sections per ux.md, masking agreement people", () => {
		const [team, , agreement] = sectionsFromEntries(entries);
		expect(sectionHeading(team)).toEqual({
			text: "Prodigitality Services… · team",
			title: "Prodigitality Services Inc. Team · team",
		});
		expect(sectionHeading(agreement)).toEqual({
			text: "Delivery team · agreement with Acme Corp",
			title: undefined,
		});
	});

	it("totals sections without adding Approved to Not yet approved", () => {
		expect(sectionTotals(sectionsFromEntries(entries))).toEqual({
			approvedSeconds: 3600 + 7200 + 600,
			notApprovedSeconds: 1800,
			billableSeconds: 3600 + 7200,
			amounts: { PHP: 100 },
		});
	});
});
