import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	TimesheetEventRow,
	TimesheetSummary,
} from "@/services/time.types";
import {
	CARD_LABEL_MAX,
	CHIP_LABEL_MAX,
	canShowAmounts,
	cardLabel,
	chipLabel,
	contextLabel,
	contextSectionLabel,
	deviceTimeZone,
	firstName,
	formatClock,
	formatDurationText,
	formatInstantDateTime,
	formatInstantDay,
	formatInstantTime,
	formatLocalDay,
	formatMinutesText,
	formatMoneyLine,
	formatPeriodRange,
	formatTimer,
	goesToCopy,
	goesToTarget,
	joinMoneyLines,
	joinNames,
	labelWithTitle,
	manualTimeLine,
	moneyLines,
	NO_DECIDER_COPY,
	parseDurationInput,
	periodKindLabel,
	periodKindTitle,
	periodLastDayReached,
	roundingLine,
	scopePhrase,
	sheetScopeLabel,
	sheetStatusLine,
	sheetStatusView,
	submittedAgo,
	timesheetRulesLine,
	truncateLabel,
	WORK_ITEM_LABEL,
	weekdayName,
	weekdayShort,
	workItemLabel,
} from "./timeFormat";

const platform = vi.hoisted(() => ({ native: false }));
vi.mock("@/lib/platform", () => ({ isNativeApp: () => platform.native }));

afterEach(() => {
	platform.native = false;
});

const MANILA = "Asia/Manila";
/** Tue Oct 6 2026, 12:00 in Manila. */
const NOW = new Date("2026-10-06T04:00:00Z");
const dates = { now: NOW, userTimezone: MANILA };

const H = 3600;
const M = 60;

describe("durations", () => {
	it("formats h:mm for tables, flooring minutes", () => {
		expect(formatClock(38 * H + 15 * M)).toBe("38:15");
		expect(formatClock(45 * M)).toBe("0:45");
		expect(formatClock(9 * H + 20 * M + 59)).toBe("9:20");
		expect(formatClock(112 * H)).toBe("112:00");
		expect(formatClock(0)).toBe("0:00");
		expect(formatClock(59)).toBe("0:00");
		expect(formatClock(-30)).toBe("0:00");
	});

	it("reads a missing duration as the empty mark", () => {
		expect(formatClock(null)).toBe("—");
		expect(formatClock(undefined)).toBe("—");
		expect(formatClock(Number.NaN)).toBe("—");
		expect(formatClock(null, "–")).toBe("–");
	});

	it("formats the running timer as hh:mm:ss", () => {
		expect(formatTimer(1 * H + 12 * M + 44)).toBe("01:12:44");
		expect(formatTimer(0)).toBe("00:00:00");
		expect(formatTimer(null)).toBe("00:00:00");
		expect(formatTimer(100 * H)).toBe("100:00:00");
	});

	it("formats prose durations as 38h 15m", () => {
		expect(formatDurationText(38 * H + 15 * M)).toBe("38h 15m");
		expect(formatDurationText(45 * M)).toBe("45m");
		expect(formatDurationText(2 * H)).toBe("2h");
		expect(formatDurationText(0)).toBe("0m");
		expect(formatDurationText(null)).toBe("0m");
		expect(formatDurationText(null, "—")).toBe("—");
	});

	it("formats limits stored in minutes", () => {
		expect(formatMinutesText(2400)).toBe("40h");
		expect(formatMinutesText(2250)).toBe("37h 30m");
		expect(formatMinutesText(210)).toBe("3h 30m");
		expect(formatMinutesText(null)).toBe("0m");
	});
});

describe("parseDurationInput", () => {
	it.each([
		["1:30", 5400],
		["0:45", 2700],
		[":45", 2700],
		["10:05", 10 * H + 5 * M],
		["90m", 5400],
		["90 min", 5400],
		["90 minutes", 5400],
		["1.5h", 5400],
		["1,5h", 5400],
		["0.25h", 900],
		[".5h", 1800],
		["2 hours", 7200],
		["1h 30m", 5400],
		["1h30", 5400],
		["1hr 15min", 4500],
		["1.5", 5400],
		["2", 7200],
		["  1:30  ", 5400],
		["1H 30M", 5400],
	])("reads %s", (input, seconds) => {
		expect(parseDurationInput(input)).toBe(seconds);
	});

	it.each([
		"",
		"   ",
		"abc",
		"0:00",
		"0",
		"0m",
		"1:75",
		"1:5",
		"1h 75m",
		"1.5h 30m",
		"-1h",
		"25h",
		"1:30pm",
	])("refuses %j", (input) => {
		expect(parseDurationInput(input)).toBeNull();
	});

	it("refuses non-strings and honours a larger maximum", () => {
		expect(parseDurationInput(null)).toBeNull();
		expect(parseDurationInput(undefined)).toBeNull();
		expect(parseDurationInput("24h")).toBe(24 * H);
		expect(parseDurationInput("25h", { maxSeconds: 30 * H })).toBe(25 * H);
	});
});

describe("dates and periods", () => {
	it("says when a sheet was sent, counted in the viewer's zone", () => {
		// Tue Oct 6, 2026, 11:00 in Manila.
		const now = new Date("2026-10-06T03:00:00.000Z");
		const ago = (iso: string | null, timezone = "Asia/Manila") =>
			submittedAgo(iso, { now, timezone });
		expect(ago("2026-10-06T00:30:00.000Z")).toBe("today");
		expect(ago("2026-10-05T03:00:00.000Z")).toBe("yesterday");
		expect(ago("2026-10-03T03:00:00.000Z")).toBe("3 days ago");
		expect(ago("2026-09-22T03:00:00.000Z")).toBe("Sep 22");
		// 23:30Z on Oct 5 is already Oct 6 in Manila, still Oct 5 in UTC.
		expect(ago("2026-10-05T23:30:00.000Z")).toBe("today");
		expect(ago("2026-10-05T23:30:00.000Z", "UTC")).toBe("yesterday");
		expect(ago(null)).toBe("");
		expect(ago("not a date")).toBe("");
	});

	it("writes periods with an en dash and no year this year", () => {
		expect(formatPeriodRange("2026-09-22", "2026-09-28", dates)).toBe(
			"Sep 22–28",
		);
		expect(formatPeriodRange("2026-09-29", "2026-10-05", dates)).toBe(
			"Sep 29–Oct 5",
		);
		expect(formatPeriodRange("2026-10-01", "2026-10-15", dates)).toBe(
			"Oct 1–15",
		);
		expect(formatPeriodRange("2026-10-06", "2026-10-06", dates)).toBe("Oct 6");
	});

	it("adds the year only when it isn't the current year", () => {
		expect(formatPeriodRange("2025-09-22", "2025-09-28", dates)).toBe(
			"Sep 22–28, 2025",
		);
		expect(formatPeriodRange("2025-09-29", "2025-10-05", dates)).toBe(
			"Sep 29–Oct 5, 2025",
		);
		expect(formatPeriodRange("2026-12-28", "2027-01-03", dates)).toBe(
			"Dec 28, 2026–Jan 3, 2027",
		);
		expect(
			formatPeriodRange("2026-09-22", "2026-09-28", {
				...dates,
				year: "always",
			}),
		).toBe("Sep 22–28, 2026");
	});

	it("reads the current year in the reader's timezone", () => {
		// 20:00Z on Dec 31 is already Jan 1 2027 in Manila.
		const eve = new Date("2026-12-31T20:00:00Z");
		expect(
			formatPeriodRange("2026-12-21", "2026-12-27", {
				now: eve,
				userTimezone: MANILA,
			}),
		).toBe("Dec 21–27, 2026");
		expect(
			formatPeriodRange("2026-12-21", "2026-12-27", {
				now: eve,
				userTimezone: "UTC",
			}),
		).toBe("Dec 21–27");
	});

	it("names the period's timezone only when it isn't the reader's", () => {
		expect(
			formatPeriodRange("2026-09-22", "2026-09-28", {
				...dates,
				timezone: "America/New_York",
			}),
		).toBe("Sep 22–28 (America/New_York)");
		expect(
			formatPeriodRange("2026-09-22", "2026-09-28", {
				...dates,
				timezone: MANILA,
			}),
		).toBe("Sep 22–28");
	});

	it("builds the spaced header form of the review screen", () => {
		expect(
			formatPeriodRange("2026-09-22", "2026-09-28", {
				...dates,
				timezone: MANILA,
				showTimezone: "always",
				year: "always",
				spaced: true,
			}),
		).toBe("Sep 22 – 28, 2026 (Asia/Manila)");
		expect(
			formatPeriodRange("2026-09-29", "2026-10-05", {
				...dates,
				year: "always",
				spaced: true,
			}),
		).toBe("Sep 29 – Oct 5, 2026");
	});

	it("passes malformed dates through instead of throwing", () => {
		expect(formatPeriodRange("2026-02-30", "2026-03-01", dates)).toBe(
			"2026-02-30–2026-03-01",
		);
		expect(formatLocalDay("soon")).toBe("soon");
	});

	it("formats local days with an optional weekday", () => {
		expect(formatLocalDay("2026-10-02", dates)).toBe("Oct 2");
		// Oct 1 2026 is a Thursday (ux.md's mockup week is illustrative).
		expect(formatLocalDay("2026-10-01", { ...dates, weekday: true })).toBe(
			"Thu Oct 1",
		);
		expect(formatLocalDay("2026-10-06", { ...dates, weekday: true })).toBe(
			"Tue Oct 6",
		);
		expect(formatLocalDay("2025-10-06", dates)).toBe("Oct 6, 2025");
	});

	it("names weekdays by ISO number", () => {
		expect(weekdayShort(1)).toBe("Mon");
		expect(weekdayShort(7)).toBe("Sun");
		expect(weekdayName(1)).toBe("Monday");
		expect(weekdayName(7)).toBe("Sunday");
		expect(weekdayName(0)).toBe("");
		expect(weekdayShort(8)).toBe("");
	});

	it("formats instants in an explicit timezone, 24-hour", () => {
		const at = "2026-09-29T02:14:00Z";
		expect(formatInstantDay(at, MANILA, dates)).toBe("Sep 29");
		expect(formatInstantTime(at, MANILA)).toBe("10:14");
		expect(formatInstantTime(at, "UTC")).toBe("02:14");
		expect(formatInstantDateTime(at, MANILA, dates)).toBe("Sep 29, 10:14");
		// The local date moves with the zone.
		expect(formatInstantDay("2026-10-04T16:30:00Z", MANILA, dates)).toBe(
			"Oct 5",
		);
		expect(formatInstantDay("2026-10-04T16:30:00Z", "UTC", dates)).toBe(
			"Oct 4",
		);
	});

	it("reads unreadable instants as —", () => {
		expect(formatInstantDay(null, MANILA)).toBe("—");
		expect(formatInstantDay("nope", MANILA)).toBe("—");
		expect(formatInstantTime("nope", MANILA)).toBe("—");
		expect(formatInstantDateTime(undefined, MANILA)).toBe("—");
	});

	it("knows when a period's last day has started in its own timezone", () => {
		const justAfterMidnight = new Date("2026-10-04T16:30:00Z");
		expect(periodLastDayReached("2026-10-05", MANILA, justAfterMidnight)).toBe(
			true,
		);
		expect(periodLastDayReached("2026-10-05", "UTC", justAfterMidnight)).toBe(
			false,
		);
	});

	it("has a usable device timezone", () => {
		expect(() =>
			new Intl.DateTimeFormat("en-US", { timeZone: deviceTimeZone() }).format(),
		).not.toThrow();
	});
});

describe("money", () => {
	it("writes one code-prefixed line per currency", () => {
		expect(formatMoneyLine(6885, "PHP")).toBe("PHP 6,885.00");
		expect(formatMoneyLine(120, "usd")).toBe("USD 120.00");
		expect(formatMoneyLine(1200, "JPY")).toBe("JPY 1,200");
		expect(formatMoneyLine(1234567.891, "EUR")).toBe("EUR 1,234,567.89");
		expect(formatMoneyLine(null, "PHP")).toBe("PHP 0.00");
		expect(formatMoneyLine(5, null)).toBe("USD 5.00");
		expect(formatMoneyLine(5, "NOTACODE")).toBe("NOTACODE 5.00");
	});

	it("lists currencies in code order and joins them with a middle dot", () => {
		const lines = moneyLines({ USD: 120, PHP: 6885 });
		expect(lines).toEqual(["PHP 6,885.00", "USD 120.00"]);
		expect(joinMoneyLines(lines)).toBe("PHP 6,885.00 · USD 120.00");
		expect(moneyLines({ USD: Number.NaN, PHP: null, EUR: 0 })).toEqual([
			"EUR 0.00",
		]);
		expect(moneyLines(null)).toEqual([]);
	});

	it("hides amounts when cost is hidden, and on native for agreement time", () => {
		expect(
			canShowAmounts({ cost: "visible", kind: "team", native: false }),
		).toBe(true);
		expect(
			canShowAmounts({ cost: "hidden", kind: "team", native: false }),
		).toBe(false);
		expect(canShowAmounts({ kind: "engagement", native: false })).toBe(true);
		expect(canShowAmounts({ kind: "engagement", native: true })).toBe(false);
		expect(canShowAmounts({ kind: "assignment", native: true })).toBe(false);
		expect(canShowAmounts({ kind: "workspace", native: true })).toBe(true);
	});

	it("reads the platform when native isn't passed", () => {
		platform.native = true;
		expect(canShowAmounts({ kind: "engagement" })).toBe(false);
		platform.native = false;
		expect(canShowAmounts({ kind: "engagement" })).toBe(true);
	});
});

describe("labels", () => {
	const team = "Prodigitality Services Inc. Team";

	it("names every work item, and anything unknown as Other", () => {
		expect(WORK_ITEM_LABEL).toEqual({
			task: "Task",
			meeting: "Meeting",
			review: "Review",
			admin: "Admin",
			other: "Other",
		});
		expect(workItemLabel("meeting")).toBe("Meeting");
		expect(workItemLabel(null)).toBe("Other");
		expect(workItemLabel(undefined)).toBe("Other");
	});

	it("cuts chips at 22 characters and cards at 32, each + …", () => {
		expect(CHIP_LABEL_MAX).toBe(22);
		expect(CARD_LABEL_MAX).toBe(32);
		expect(truncateLabel(team, CHIP_LABEL_MAX)).toBe("Prodigitality Services…");
		expect(truncateLabel(team, CARD_LABEL_MAX)).toBe(team);
		expect(truncateLabel("Prodigitality Workspace", 22)).toBe(
			"Prodigitality Workspac…",
		);
		// A cut at a space never leaves "… " dangling.
		expect(truncateLabel("Acme Website Project", 13)).toBe("Acme Website…");
		expect(truncateLabel("Acme", 22)).toBe("Acme");
	});

	it("counts code points, so an emoji is never split", () => {
		expect(truncateLabel("🚀🚀🚀 Launch", 2)).toBe("🚀🚀…");
	});

	it("adds the full label as a tooltip only when cut", () => {
		expect(chipLabel(team)).toEqual({
			text: "Prodigitality Services…",
			title: team,
		});
		expect(cardLabel(team)).toEqual({ text: team, title: undefined });
		expect(labelWithTitle("  Acme  ", 22)).toEqual({
			text: "Acme",
			title: undefined,
		});
	});

	it("labels sheet scopes, with ' · agreement' on web only", () => {
		expect(sheetScopeLabel("engagement", "Acme Corp", { native: false })).toBe(
			"Acme Corp · agreement",
		);
		expect(sheetScopeLabel("engagement", "Acme Corp", { native: true })).toBe(
			"Acme Corp",
		);
		expect(sheetScopeLabel("workspace", "Acme", { native: false })).toBe(
			"Acme",
		);
		expect(sheetScopeLabel("team", team, { native: false, max: 22 })).toBe(
			"Prodigitality Services…",
		);
		expect(
			sheetScopeLabel("engagement", "Acme Corporation International", {
				native: false,
				max: 22,
			}),
		).toBe("Acme Corporation Inter… · agreement");
	});

	it("defaults the scope label to the platform", () => {
		platform.native = true;
		expect(sheetScopeLabel("engagement", "Acme Corp")).toBe("Acme Corp");
	});

	it("labels contexts and report sections", () => {
		expect(contextLabel("personal", null)).toBe("Just me");
		expect(contextLabel("personal", "Me")).toBe("Just me");
		expect(contextLabel("team", " Design ")).toBe("Design");
		expect(contextSectionLabel("team", team, { max: 22 })).toBe(
			"Prodigitality Services… · team",
		);
		expect(contextSectionLabel("workspace", "Acme")).toBe("Acme · workspace");
		expect(contextSectionLabel("assignment", "Acme Corp")).toBe(
			"Acme Corp · agreement",
		);
		expect(contextSectionLabel("engagement", "Acme Corp")).toBe(
			"Acme Corp · agreement",
		);
	});

	it("says scopes inside sentences", () => {
		expect(scopePhrase("engagement", "Acme")).toBe("your agreement with Acme");
		expect(scopePhrase("assignment", null)).toBe("your agreement");
		expect(scopePhrase("team", team)).toBe(team);
		expect(scopePhrase("team", null)).toBe("this team");
		expect(scopePhrase("workspace", "")).toBe("this workspace");
		expect(scopePhrase("personal", null)).toBe("just you");
		expect(scopePhrase(null, null)).toBe("this project");
	});

	it("shortens and joins names", () => {
		expect(firstName("Ana Reyes")).toBe("Ana");
		expect(firstName("  Leo  ")).toBe("Leo");
		expect(firstName(null)).toBeNull();
		expect(firstName("   ")).toBeNull();
		expect(joinNames(["Ana Reyes"])).toBe("Ana Reyes");
		expect(joinNames(["Ana Reyes", "Leo Cruz"])).toBe("Ana Reyes and Leo Cruz");
		expect(joinNames(["Ana Reyes", "Leo Cruz"], "or")).toBe(
			"Ana Reyes or Leo Cruz",
		);
		expect(joinNames(["Ana", "Leo", "Maria"])).toBe("Ana, Leo and 1 other");
		expect(joinNames(["Ana", "Leo", "Maria", "Bo"])).toBe(
			"Ana, Leo and 2 others",
		);
	});
});

describe("policy phrases", () => {
	it("names period kinds", () => {
		expect(periodKindLabel("weekly")).toBe("weekly");
		expect(periodKindLabel("biweekly")).toBe("every two weeks");
		expect(periodKindLabel("semi_monthly")).toBe("twice a month");
		expect(periodKindLabel("monthly")).toBe("monthly");
		expect(periodKindTitle("semi_monthly")).toBe(
			"Twice a month (1–15, 16–end)",
		);
		expect(periodKindTitle("weekly")).toBe("Weekly");
	});

	it("writes the popover's timesheet line", () => {
		expect(
			timesheetRulesLine({
				period_kind: "weekly",
				week_start: 1,
				timezone: MANILA,
			}),
		).toBe("weekly · starts Monday · Asia/Manila");
		expect(
			timesheetRulesLine({
				period_kind: "biweekly",
				week_start: 7,
				timezone: "UTC",
			}),
		).toBe("every two weeks · starts Sunday · UTC");
		expect(
			timesheetRulesLine({
				period_kind: "semi_monthly",
				week_start: 1,
				timezone: MANILA,
			}),
		).toBe("twice a month · Asia/Manila");
	});

	it("writes manual-time and rounding lines", () => {
		expect(
			manualTimeLine({ allow_manual_entries: true, retroactive_days: 7 }),
		).toBe("Manual time up to 7 days back");
		expect(
			manualTimeLine({ allow_manual_entries: true, retroactive_days: 1 }),
		).toBe("Manual time up to 1 day back");
		expect(
			manualTimeLine({ allow_manual_entries: true, retroactive_days: null }),
		).toBe("Manual time allowed");
		expect(
			manualTimeLine({ allow_manual_entries: true, retroactive_days: 0 }),
		).toBe("Manual time allowed");
		expect(manualTimeLine({ allow_manual_entries: false })).toBe(
			"Manual time off",
		);
		expect(roundingLine(0)).toBe("No rounding");
		expect(roundingLine(null)).toBe("No rounding");
		expect(roundingLine(15)).toBe("Rounds to the nearest 15 min");
	});
});

describe("goesToCopy", () => {
	const ana = [{ id: "u-ana", display_name: "Ana Reyes" }];

	it("writes each route as ux.md does", () => {
		expect(
			goesToCopy("team", undefined, {
				scopeKind: "team",
				label: "Prodigitality Services Inc. Team",
			}),
		).toBe("Goes to Prodigitality Services Inc. Team's owners and admins");
		expect(
			goesToCopy("workspace", undefined, {
				scopeKind: "workspace",
				label: "Acme",
			}),
		).toBe("Goes to Acme's workspace owners and admins");
		expect(
			goesToCopy("hirer", ana, { scopeKind: "engagement", label: "Pixel" }),
		).toBe("Goes to Ana Reyes");
		expect(
			goesToCopy("auto", [], { scopeKind: "engagement", label: "Acme Corp" }),
		).toBe(
			"Submitting confirms these hours for your agreement with Acme Corp.",
		);
		expect(
			goesToCopy("self", [], { scopeKind: "workspace", label: "Acme" }),
		).toBe("You're the only approver here, so this approves itself.");
	});

	it("says no one can approve only when the decider list came back empty", () => {
		expect(goesToCopy("team", [], { label: "Design" })).toBe(NO_DECIDER_COPY);
		expect(goesToCopy("hirer", [], { label: "Pixel" })).toBe(NO_DECIDER_COPY);
		expect(goesToCopy("workspace", [], { label: "Acme" })).toBe(
			NO_DECIDER_COPY,
		);
		expect(NO_DECIDER_COPY).toBe(
			"No one else can approve this. Add a workspace admin.",
		);
	});

	it("falls back to the scope when names are missing", () => {
		expect(goesToCopy("hirer", undefined, { label: "Pixel Studio" })).toBe(
			"Goes to Pixel Studio",
		);
		expect(
			goesToCopy("hirer", [{ id: "x", display_name: null }], {
				label: "Pixel",
			}),
		).toBe("Goes to Pixel");
		expect(goesToCopy("team", undefined, {})).toBe(
			"Goes to the team's owners and admins",
		);
		expect(goesToCopy("auto", undefined, { scopeKind: "workspace" })).toBe(
			"Approval is off here, so this approves itself.",
		);
		expect(goesToCopy(null)).toBeNull();
		expect(goesToCopy(undefined, ana)).toBeNull();
	});

	it("names the policy workspace for workspace approvers of a team sheet", () => {
		expect(
			goesToCopy("workspace", undefined, {
				scopeKind: "team",
				label: "Design",
				workspaceName: "Prodigitality Workspace",
			}),
		).toBe("Goes to Prodigitality Workspace's workspace owners and admins");
		expect(
			goesToTarget("workspace", undefined, {
				scopeKind: "team",
				label: "Design",
			}),
		).toBe("the workspace owners and admins");
		expect(goesToTarget("auto")).toBeNull();
		expect(
			goesToTarget("hirer", [
				{ id: "a", display_name: "Ana Reyes" },
				{ id: "b", display_name: "Leo Cruz" },
			]),
		).toBe("Ana Reyes and Leo Cruz");
	});

	it("V11: a decider who is the viewer reads 'you', never her own name", () => {
		const both = [
			{ id: "u-ana", display_name: "Ana Reyes" },
			{ id: "u-leo", display_name: "Leo Cruz" },
		];
		expect(
			goesToCopy("hirer", ana, {
				scopeKind: "engagement",
				label: "Ana Reyes",
				viewerId: "u-ana",
			}),
		).toBe("Goes to you");
		// The others keep their names; the viewer comes first.
		expect(
			goesToCopy("hirer", both, { label: "Pixel", viewerId: "u-leo" }),
		).toBe("Goes to you and Ana Reyes");
		expect(goesToTarget("hirer", both, { viewerId: "u-ana" })).toBe(
			"you and Leo Cruz",
		);
		// Someone else viewing: names as before.
		expect(goesToCopy("hirer", both, { viewerId: "u-maria" })).toBe(
			"Goes to Ana Reyes and Leo Cruz",
		);
		// Group routes never name a person, so they read as before.
		expect(
			goesToCopy("team", ana, { label: "Design", viewerId: "u-ana" }),
		).toBe("Goes to Design's owners and admins");
	});
});

type Sheet = Parameters<typeof sheetStatusView>[0];

function sheet(over: Partial<TimesheetSummary> = {}): Sheet {
	return {
		status: "open",
		scope_kind: "team",
		scope_label_snapshot: "Prodigitality Services Inc. Team",
		period_start: "2026-09-29",
		period_end: "2026-10-05",
		timezone: MANILA,
		approver_scope: null,
		submission_kind: null,
		submitted_at: null,
		decision_kind: null,
		decided_by: null,
		decided_at: null,
		decision_note: null,
		overtime_approved: false,
		member_user_id: "u-maria",
		...over,
	};
}

function event(over: Partial<TimesheetEventRow>): TimesheetEventRow {
	return {
		id: 1,
		timesheet_id: "s1",
		actor_user_id: null,
		event: "submitted",
		from_status: "open",
		to_status: "submitted",
		note: null,
		total_seconds: null,
		payable_seconds: null,
		revision: 1,
		created_at: "2026-09-29T02:00:00Z",
		...over,
	};
}

describe("sheetStatusView", () => {
	const names = { "u-ana": "Ana Reyes", "u-maria": "Maria Santos" };

	it("keeps an open manual sheet 'until' its last day, then Submit shows", () => {
		const before = sheetStatusView(sheet(), {
			now: new Date("2026-10-03T04:00:00Z"),
		});
		expect(before).toMatchObject({
			label: "Open",
			sublabel: "until Oct 5",
			tone: "neutral",
			locked: false,
			submitAvailable: false,
			submitLabel: null,
			overdue: false,
		});
		expect(sheetStatusLine(before)).toBe("Open · until Oct 5");

		const lastDay = sheetStatusView(sheet(), {
			now: new Date("2026-10-05T04:00:00Z"),
		});
		expect(lastDay).toMatchObject({
			sublabel: "until Oct 5",
			submitAvailable: true,
			submitLabel: "Submit",
		});
	});

	it("counts the last day in the sheet's timezone", () => {
		// 00:30 Oct 5 in Manila, still Oct 4 in UTC.
		const view = sheetStatusView(sheet(), {
			now: new Date("2026-10-04T16:30:00Z"),
		});
		expect(view.submitAvailable).toBe(true);
	});

	it("marks a manual sheet past its end as overdue", () => {
		const view = sheetStatusView(sheet(), { now: NOW });
		expect(view).toMatchObject({
			sublabel: "overdue",
			overdue: true,
			submitAvailable: true,
		});
	});

	it("says when an auto/self sheet sends itself (period end + max(reminder, 1))", () => {
		const auto = sheet({
			routing_preview: {
				approver_scope: "self",
				cost_money: false,
				deciders: [],
			},
		});
		const view = sheetStatusView(auto, {
			now: new Date("2026-10-02T04:00:00Z"),
		});
		expect(view).toMatchObject({
			sublabel: "sends itself Oct 6",
			sendsItself: true,
			sendsItselfOn: "2026-10-06",
			submitAvailable: true,
			overdue: false,
		});
		const acme = sheet({
			scope_kind: "workspace",
			scope_label_snapshot: "Acme",
			period_start: "2026-10-01",
			period_end: "2026-10-15",
			approver_scope: "auto",
		});
		expect(sheetStatusView(acme, { now: NOW, reminderDays: 2 }).sublabel).toBe(
			"sends itself Oct 17",
		);
		expect(sheetStatusView(acme, { now: NOW, reminderDays: 0 }).sublabel).toBe(
			"sends itself Oct 16",
		);
	});

	it("reads the sheet's own reminder_days (D85) when the caller passes none", () => {
		const acme = sheet({
			scope_kind: "workspace",
			scope_label_snapshot: "Acme",
			period_start: "2026-10-01",
			period_end: "2026-10-15",
			approver_scope: "auto",
			reminder_days: 3,
		});
		// The review screen and the approval rows pass no reminderDays.
		expect(sheetStatusView(acme, { now: NOW })).toMatchObject({
			sublabel: "sends itself Oct 18",
			sendsItselfOn: "2026-10-18",
		});
		expect(
			sheetStatusView(acme, { now: NOW, reminderDays: null }).sendsItselfOn,
		).toBe("2026-10-18");
		// A value the caller passes wins (the /time cards pass the overview's).
		expect(
			sheetStatusView(acme, { now: NOW, reminderDays: 2 }).sendsItselfOn,
		).toBe("2026-10-17");
		// 0 still means the next day, as the RPC and the cron read it.
		expect(
			sheetStatusView({ ...acme, reminder_days: 0 }, { now: NOW })
				.sendsItselfOn,
		).toBe("2026-10-16");
		// Unknown on the sheet and from the caller: 1 day.
		expect(
			sheetStatusView({ ...acme, reminder_days: null }, { now: NOW })
				.sendsItselfOn,
		).toBe("2026-10-16");
	});

	it("notes a member reopen of an own auto/self sheet", () => {
		const view = sheetStatusView(sheet({ approver_scope: "self" }), {
			now: NOW,
			viewerId: "u-maria",
			events: [
				event({
					id: 4,
					event: "reopened",
					from_status: "approved",
					to_status: "open",
					actor_user_id: "u-maria",
					created_at: "2026-10-06T01:00:00Z",
				}),
			],
		});
		expect(view.sublabels).toEqual(["Reopened by you", "sends itself Oct 6"]);
	});

	it("drops the reopen note once a later withdraw is what made it open", () => {
		const reopened = event({
			id: 4,
			event: "reopened",
			from_status: "approved",
			to_status: "open",
			actor_user_id: "u-maria",
			created_at: "2026-10-06T01:00:00Z",
		});
		const withdrawn = event({
			id: 6,
			event: "withdrawn",
			from_status: "submitted",
			to_status: "open",
			actor_user_id: "u-maria",
			created_at: "2026-10-06T03:00:00Z",
		});
		const view = sheetStatusView(sheet({ approver_scope: "self" }), {
			now: NOW,
			viewerId: "u-maria",
			events: [reopened, withdrawn],
		});
		expect(view.sublabels).toEqual(["sends itself Oct 6"]);
	});

	it("names who a submitted sheet waits on", () => {
		const hirer = sheetStatusView(
			sheet({
				status: "submitted",
				scope_kind: "engagement",
				scope_label_snapshot: "Pixel Studio",
				approver_scope: "hirer",
				submission_kind: "manual",
				deciders: [{ id: "u-ana", display_name: "Ana Reyes" }],
			}),
			{ now: NOW },
		);
		expect(hirer).toMatchObject({
			label: "Submitted",
			sublabel: "Waiting on Ana Reyes",
			tone: "muted",
			locked: true,
			submitAvailable: false,
		});

		const workspace = sheetStatusView(
			sheet({
				status: "submitted",
				scope_kind: "workspace",
				scope_label_snapshot: "Acme",
				approver_scope: "workspace",
				submission_kind: "manual",
			}),
			{ now: NOW },
		);
		expect(workspace.sublabel).toBe("Waiting on Acme's owners and admins");

		const team = sheetStatusView(
			sheet({ status: "submitted", approver_scope: "team" }),
			{ now: NOW },
		);
		expect(team.sublabel).toBe(
			"Waiting on Prodigitality Services Inc. Team's owners and admins",
		);

		const escalated = sheetStatusView(
			sheet({ status: "submitted", approver_scope: "workspace" }),
			{ now: NOW, workspaceName: "Prodigitality Workspace" },
		);
		expect(escalated.sublabel).toBe(
			"Waiting on Prodigitality Workspace's owners and admins",
		);
	});

	it("V11: a decider never reads her own name in 'Waiting on …'", () => {
		const submitted = (over: Partial<TimesheetSummary> = {}) =>
			sheet({
				status: "submitted",
				scope_kind: "engagement",
				// The worker's counterparty: the hirer herself.
				scope_label_snapshot: "Cora Villanueva",
				approver_scope: "hirer",
				submission_kind: "manual",
				...over,
			});
		const cora = { id: "u-cora", display_name: "Cora Villanueva" };
		const leo = { id: "u-leo", display_name: "Leo Cruz" };
		// The decider list names the viewer.
		expect(
			sheetStatusView(submitted({ deciders: [cora] }), {
				now: NOW,
				viewerId: "u-cora",
			}).sublabel,
		).toBe("Waiting for you");
		expect(
			sheetStatusView(submitted({ deciders: [leo, cora] }), {
				now: NOW,
				viewerId: "u-cora",
			}).sublabel,
		).toBe("Waiting for you or Leo Cruz");
		// The review screen: A2 sends no list to a decider, so the label (her
		// own name) used to show. `viewer.can_decide` says it waits for her.
		expect(
			sheetStatusView(submitted(), {
				now: NOW,
				viewerId: "u-cora",
				viewerCanDecide: true,
			}).sublabel,
		).toBe("Waiting for you");
		// The member still reads the hirer's name.
		expect(
			sheetStatusView(submitted({ deciders: [cora] }), {
				now: NOW,
				viewerId: "u-theo",
			}).sublabel,
		).toBe("Waiting on Cora Villanueva");
		expect(
			sheetStatusView(submitted(), { now: NOW, viewerId: "u-theo" }).sublabel,
		).toBe("Waiting on Cora Villanueva");
		// A team lead deciding a team sheet: the group copy names no one.
		expect(
			sheetStatusView(sheet({ status: "submitted", approver_scope: "team" }), {
				now: NOW,
				viewerId: "u-lead",
				viewerCanDecide: true,
			}).sublabel,
		).toBe("Waiting on Prodigitality Services Inc. Team's owners and admins");
	});

	it("puts 'no one else can approve' first when the deciders are empty", () => {
		const fromList = sheetStatusView(
			sheet({ status: "submitted", approver_scope: "team", deciders: [] }),
			{ now: NOW },
		);
		expect(fromList.sublabel).toBe(NO_DECIDER_COPY);
		const fromCount = sheetStatusView(
			sheet({ status: "submitted", approver_scope: "workspace" }),
			{ now: NOW, decidersCount: 0 },
		);
		expect(fromCount.sublabel).toBe(NO_DECIDER_COPY);
	});

	it("adds how the sheet was sent", () => {
		expect(
			sheetStatusView(
				sheet({
					status: "submitted",
					approver_scope: "team",
					submission_kind: "legacy",
				}),
				{ now: NOW },
			).sublabels,
		).toEqual([
			"Waiting on Prodigitality Services Inc. Team's owners and admins",
			"Imported from per-entry review",
		]);
		expect(
			sheetStatusView(
				sheet({
					status: "submitted",
					approver_scope: "workspace",
					scope_kind: "workspace",
					scope_label_snapshot: "Acme",
					submission_kind: "auto",
					submitted_at: "2026-10-05T17:00:00Z",
				}),
				{ now: NOW },
			).sublabels,
		).toEqual([
			"Waiting on Acme's owners and admins",
			"Sent automatically Oct 6",
		]);
		expect(
			sheetStatusView(
				sheet({
					status: "submitted",
					approver_scope: "auto",
					submission_kind: "on_deletion",
				}),
				{ now: NOW },
			).sublabels,
		).toEqual(["Sent when the account was closed"]);
	});

	it("tells a return from a decider reopen, with the note", () => {
		const returned = sheetStatusView(
			sheet({
				status: "returned",
				decided_by: "u-ana",
				decision_note: "Split Thursday",
			}),
			{
				now: NOW,
				names,
				events: [
					event({
						id: 2,
						event: "returned",
						from_status: "submitted",
						to_status: "returned",
						actor_user_id: "u-ana",
						note: "Split Thursday",
						created_at: "2026-09-30T02:00:00Z",
					}),
				],
			},
		);
		expect(returned).toMatchObject({
			label: "Returned",
			sublabel: "Returned by Ana · 'Split Thursday'",
			tone: "warning",
			locked: false,
			submitAvailable: true,
			submitLabel: "Resubmit",
		});

		const reopened = sheetStatusView(
			sheet({
				status: "returned",
				decided_by: "u-ana",
				decision_note: "Fix Tue",
			}),
			{
				now: NOW,
				names,
				events: [
					event({
						id: 2,
						event: "returned",
						to_status: "returned",
						actor_user_id: "u-ana",
						note: "Old note",
						created_at: "2026-09-30T02:00:00Z",
					}),
					event({
						id: 5,
						event: "reopened",
						from_status: "approved",
						to_status: "returned",
						actor_user_id: "u-ana",
						note: "Fix Tue",
						created_at: "2026-10-02T02:00:00Z",
					}),
				],
			},
		);
		expect(reopened.sublabel).toBe("Reopened by Ana · 'Fix Tue'");

		// The reopener's name unknown: "Reopened" still tells it from a return.
		const unnamed = sheetStatusView(
			sheet({
				status: "returned",
				decided_by: "u-lito",
				decision_note: "Fix Tue",
			}),
			{
				now: NOW,
				events: [
					event({
						id: 5,
						event: "reopened",
						from_status: "approved",
						to_status: "returned",
						actor_user_id: "u-lito",
						note: "Fix Tue",
						created_at: "2026-10-02T02:00:00Z",
					}),
				],
			},
		);
		expect(unnamed.sublabel).toBe("Reopened · 'Fix Tue'");
	});

	it("falls back to the sheet's decision fields without events", () => {
		expect(
			sheetStatusView(
				sheet({
					status: "returned",
					decided_by: "u-me",
					decision_note: "Split Thu",
				}),
				{ now: NOW, viewerId: "u-me" },
			).sublabel,
		).toBe("Returned by you · 'Split Thu'");
		expect(
			sheetStatusView(
				sheet({
					status: "returned",
					decided_by: "u-x",
					decision_note: "Split Thu",
				}),
				{ now: NOW },
			).sublabel,
		).toBe("'Split Thu'");
		const long = "a".repeat(80);
		expect(
			sheetStatusView(sheet({ status: "returned", decision_note: long }), {
				now: NOW,
			}).sublabel,
		).toBe(`'${"a".repeat(60)}…'`);
	});

	it("writes the approved sublabels", () => {
		expect(
			sheetStatusView(
				sheet({
					status: "approved",
					decision_kind: "self",
					approver_scope: "self",
				}),
				{ now: NOW },
			),
		).toMatchObject({
			label: "Approved",
			sublabel: "Self-approved",
			tone: "success",
			locked: true,
		});
		expect(
			sheetStatusView(sheet({ status: "approved", decision_kind: "legacy" }), {
				now: NOW,
			}).sublabel,
		).toBe("Imported");
		expect(
			sheetStatusView(
				sheet({
					status: "approved",
					scope_kind: "engagement",
					approver_scope: "auto",
					decision_kind: "auto",
				}),
				{ now: NOW },
			).sublabel,
		).toBe("Confirmed");
		expect(
			sheetStatusView(
				sheet({
					status: "approved",
					decision_kind: "manual",
					approver_scope: "team",
					overtime_approved: true,
				}),
				{ now: NOW },
			).sublabels,
		).toEqual(["Overtime approved"]);
		expect(
			sheetStatusView(
				sheet({
					status: "approved",
					decision_kind: "manual",
					approver_scope: "team",
				}),
				{ now: NOW },
			).sublabel,
		).toBeNull();
		expect(
			sheetStatusLine(
				sheetStatusView(
					sheet({ status: "approved", decision_kind: "manual" }),
					{ now: NOW },
				),
			),
		).toBe("Approved");
	});
});
