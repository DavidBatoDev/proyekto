import { describe, expect, it } from "vitest";
import {
	isIsoDate,
	isUuid,
	parseTimeForParam,
	timeForParam,
	timeHref,
	timeReportGroupBy,
	timesheetHref,
	validateLegacyTeamTimeReportSearch,
	validateTeamTimeReportSearch,
	validateTimePageSearch,
	validateTimesheetReviewSearch,
	validateWorkspaceTimeSettingsSearch,
	workspaceTimeTab,
} from "./timeSearch";

const T = "11111111-2222-4333-8444-555555555555";
const P = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const E = "99999999-8888-4777-8666-555555555555";

describe("primitives", () => {
	it("recognises uuids of any version, case-insensitively", () => {
		expect(isUuid(T)).toBe(true);
		expect(isUuid(T.toUpperCase())).toBe(true);
		expect(isUuid("not-a-uuid")).toBe(false);
		expect(isUuid(`${T}x`)).toBe(false);
		expect(isUuid(42)).toBe(false);
	});

	it("accepts only real calendar dates", () => {
		expect(isIsoDate("2026-09-29")).toBe(true);
		expect(isIsoDate("2024-02-29")).toBe(true);
		expect(isIsoDate("2026-02-29")).toBe(false);
		expect(isIsoDate("2026-13-01")).toBe(false);
		expect(isIsoDate("2026-09-31")).toBe(false);
		expect(isIsoDate("2026-9-1")).toBe(false);
		expect(isIsoDate("2026-09-29T00:00:00Z")).toBe(false);
	});
});

describe("the For param", () => {
	it("reads governed contexts and both spellings of Just me", () => {
		expect(parseTimeForParam(`team:${T}`)).toEqual({ kind: "team", id: T });
		expect(parseTimeForParam(`assignment:${T}`)).toEqual({
			kind: "assignment",
			id: T,
		});
		expect(parseTimeForParam(`workspace:${T}`)).toEqual({
			kind: "workspace",
			id: T,
		});
		expect(parseTimeForParam("personal")).toEqual({
			kind: "personal",
			id: null,
		});
		// The API's spelling, from a link built off an API value.
		expect(parseTimeForParam("personal:")).toEqual({
			kind: "personal",
			id: null,
		});
	});

	it("rejects unknown kinds and ids that are not uuids", () => {
		expect(parseTimeForParam(`project:${T}`)).toBeNull();
		expect(parseTimeForParam("team:abc")).toBeNull();
		expect(parseTimeForParam("team:")).toBeNull();
		expect(parseTimeForParam(T)).toBeNull();
		expect(parseTimeForParam("")).toBeNull();
		expect(parseTimeForParam(undefined)).toBeNull();
	});

	it("writes Just me bare, the way the URL spells it", () => {
		expect(timeForParam({ kind: "personal", id: null })).toBe("personal");
		expect(timeForParam({ kind: "team", id: T })).toBe(`team:${T}`);
	});
});

describe("validateTimePageSearch", () => {
	it("keeps every valid param", () => {
		expect(
			validateTimePageSearch({
				for: `team:${T}`,
				project: P,
				week: "2026-09-29",
				entry: E,
			}),
		).toEqual({ for: `team:${T}`, project: P, week: "2026-09-29", entry: E });
	});

	it("reads ?tab= and drops anything else", () => {
		expect(validateTimePageSearch({ tab: "approvals" })).toEqual({
			tab: "approvals",
		});
		expect(validateTimePageSearch({ tab: "nope" })).toEqual({});
	});

	it("normalises the API's personal: to the URL's personal", () => {
		expect(validateTimePageSearch({ for: "personal:" })).toEqual({
			for: "personal",
		});
	});

	it("drops malformed values instead of failing the page", () => {
		expect(
			validateTimePageSearch({
				for: "team:nope",
				project: "p1",
				week: "next-week",
				entry: "<script>",
			}),
		).toEqual({});
		expect(validateTimePageSearch({})).toEqual({});
	});

	it("keeps a non-uuid entry token so the page can show its not-found card", () => {
		// Old links carry ids; a gone or mistyped one must still reach the
		// "This time entry doesn't exist or you can't open it." card.
		expect(validateTimePageSearch({ entry: "abc-123" })).toEqual({
			entry: "abc-123",
		});
		expect(validateTimePageSearch({ entry: "a".repeat(65) })).toEqual({});
	});

	it("folds router-decoded numbers back to text", () => {
		// The default parser JSON-decodes `?entry=123` to the number 123.
		expect(validateTimePageSearch({ entry: 123 })).toEqual({ entry: "123" });
		expect(validateTimePageSearch({ week: 20260929 })).toEqual({});
	});

	it("ignores params it does not own", () => {
		expect(validateTimePageSearch({ member: T, preset: "week" })).toEqual({});
	});

	it("keeps the view (D86) and drops anything but list or month", () => {
		expect(
			validateTimePageSearch({ week: "2026-09-01", view: "month" }),
		).toEqual({ week: "2026-09-01", view: "month" });
		expect(validateTimePageSearch({ view: "list" })).toEqual({ view: "list" });
		expect(validateTimePageSearch({ view: "calendar" })).toEqual({});
		expect(validateTimePageSearch({ view: " month " })).toEqual({
			view: "month",
		});
	});
});

describe("validateTimesheetReviewSearch", () => {
	it("keeps only the entry", () => {
		expect(
			validateTimesheetReviewSearch({ entry: E, for: `team:${T}` }),
		).toEqual({ entry: E });
		expect(validateTimesheetReviewSearch({})).toEqual({});
	});
});

describe("workspace time settings", () => {
	it("keeps the report tab and leaves the default policy tab out of the URL", () => {
		expect(validateWorkspaceTimeSettingsSearch({ tab: "report" })).toEqual({
			tab: "report",
		});
		expect(validateWorkspaceTimeSettingsSearch({ tab: "policy" })).toEqual({});
		expect(validateWorkspaceTimeSettingsSearch({ tab: "money" })).toEqual({});
		expect(validateWorkspaceTimeSettingsSearch({})).toEqual({});
	});

	it("defaults to the policy tab", () => {
		expect(workspaceTimeTab({})).toBe("policy");
		expect(workspaceTimeTab({ tab: "report" })).toBe("report");
	});
});

describe("validateTeamTimeReportSearch", () => {
	it("keeps every valid filter", () => {
		expect(
			validateTeamTimeReportSearch({
				person: T,
				project: P,
				for: "assignment",
				status: "submitted",
				from: "2026-09-01",
				to: "2026-09-30",
				group: "week",
			}),
		).toEqual({
			person: T,
			project: P,
			for: "assignment",
			status: "submitted",
			from: "2026-09-01",
			to: "2026-09-30",
			group: "week",
		});
	});

	it("drops values outside each filter's choices", () => {
		expect(
			validateTeamTimeReportSearch({
				person: "masked:x",
				for: "personal",
				status: "pending",
				group: "member",
				from: "2026-02-30",
			}),
		).toEqual({});
	});

	it("swaps an inverted range rather than showing nothing", () => {
		expect(
			validateTeamTimeReportSearch({ from: "2026-09-30", to: "2026-09-01" }),
		).toEqual({ from: "2026-09-01", to: "2026-09-30" });
	});

	it("answers old Team Logs links on the legacy reader: member → person, a uuid log kept", () => {
		expect(
			validateLegacyTeamTimeReportSearch({
				person: T,
				from: "2026-09-01",
				to: "2026-09-15",
				preset: "custom",
				cutoff_month: "2026-09",
				status: "pending",
				log: E,
			}),
		).toEqual({ person: T, from: "2026-09-01", to: "2026-09-15", log: E });
		expect(validateLegacyTeamTimeReportSearch({ member: T })).toEqual({
			person: T,
		});
		// `person` wins over an old `member`; junk drops.
		expect(
			validateLegacyTeamTimeReportSearch({ person: T, member: P }),
		).toEqual({ person: T });
		expect(
			validateLegacyTeamTimeReportSearch({ member: "someone", log: "nope" }),
		).toEqual({});
		// The plain Report reader never keeps either.
		expect(validateTeamTimeReportSearch({ member: T, log: E })).toEqual({});
	});

	it("maps the person group to the API's member group", () => {
		expect(timeReportGroupBy("person")).toBe("member");
		expect(timeReportGroupBy("week")).toBe("week");
		expect(timeReportGroupBy("day")).toBe("day");
	});
});

describe("string links", () => {
	it("builds a bare /time link", () => {
		expect(timeHref()).toBe("/time");
		expect(timeHref({}, "waiting")).toBe("/time#waiting");
	});

	it("carries the valid params and drops the rest", () => {
		const href = timeHref({ for: `team:${T}`, entry: E });
		const url = new URL(href, "https://proyekto.test");
		expect(url.pathname).toBe("/time");
		expect(url.searchParams.get("for")).toBe(`team:${T}`);
		expect(url.searchParams.get("entry")).toBe(E);
		expect(
			timeHref({ project: "nope" } as unknown as Parameters<
				typeof timeHref
			>[0]),
		).toBe("/time");
	});

	it("round-trips through the page validator", () => {
		const href = timeHref({ for: "personal", week: "2026-09-29" });
		const url = new URL(href, "https://proyekto.test");
		expect(
			validateTimePageSearch(Object.fromEntries(url.searchParams.entries())),
		).toEqual({ for: "personal", week: "2026-09-29" });
		const month = new URL(
			timeHref({ week: "2026-09-01", view: "month" }),
			"https://proyekto.test",
		);
		expect(month.searchParams.get("view")).toBe("month");
		expect(
			validateTimePageSearch(Object.fromEntries(month.searchParams.entries())),
		).toEqual({ week: "2026-09-01", view: "month" });
	});

	it("builds a timesheet link, optionally opening an entry", () => {
		expect(timesheetHref("s1")).toBe("/time/timesheets/s1");
		expect(timesheetHref("s1", E)).toBe(`/time/timesheets/s1?entry=${E}`);
		expect(timesheetHref("s1", "<bad>")).toBe("/time/timesheets/s1");
	});
});
