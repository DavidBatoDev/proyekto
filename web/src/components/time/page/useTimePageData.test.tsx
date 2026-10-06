/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { timeService } from "@/services/time.service";
import type {
	TimeEntryView,
	TimeOverview,
	TimesheetSummary,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));
const teams = vi.hoisted(() => ({ listMyTeams: vi.fn() }));
vi.mock("@/services/teams.service", () => teams);

import {
	cardSheetScope,
	contextSheetScope,
	dayTotals,
	entriesOnDay,
	findOverviewContext,
	forFilterOptions,
	forRefLabel,
	forRequestOf,
	onlyPersonal,
	resolveViewZone,
	sheetPeopleNames,
	sheetsInView,
	useTimePageData,
	viewWeekFor,
	weekParam,
	zoneLabel,
} from "./useTimePageData";

const MANILA = "Asia/Manila";
const NY = "America/New_York";
// Tue Oct 6, 2026, 11:00 in Manila.
const NOW = new Date("2026-10-06T03:00:00.000Z");
const WEEK = { start: "2026-10-05", end: "2026-10-11" };

function entry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return {
		id: "e1",
		context_kind: "team",
		context_ref: "t1",
		context_label_snapshot: "Prodigitality Services Inc. Team",
		timesheet_id: "s1",
		work_item: "task",
		started_at: "2026-10-05T01:00:00.000Z",
		ended_at: "2026-10-05T04:30:00.000Z",
		paused_at: null,
		duration_seconds: 3.5 * 3600,
		break_seconds: 0,
		break_minutes: 0,
		payable_seconds: null,
		source: "timer",
		work_type_snapshot: "real_work",
		legacy_status: null,
		payout_id: null,
		flagged_reason: null,
		project_id: "p1",
		team_id: "t1",
		workspace_id: "w1",
		engagement_assignment_id: null,
		created_at: "2026-10-05T04:30:00.000Z",
		updated_at: "2026-10-05T04:30:00.000Z",
		timesheet: null,
		locked_reason: null,
		identity: "visible",
		member_user_id: "u1",
		member_display_name_snapshot: null,
		member: null,
		member_label: null,
		content: "visible",
		task_id: "task-1",
		note: null,
		task: {
			id: "task-1",
			title: "Fix login bug",
			work_type: null,
			status: null,
		},
		project: { id: "p1", title: "Acme Website" },
		content_label: null,
		cost: "hidden",
		...over,
	};
}

function sheet(over: Partial<TimesheetSummary> = {}): TimesheetSummary {
	return {
		id: "s1",
		member_user_id: "u1",
		member_display_name_snapshot: null,
		scope_kind: "team",
		scope_ref: "t1",
		team_id: "t1",
		workspace_id: "w1",
		engagement_id: null,
		scope_label_snapshot: "Prodigitality Services Inc. Team",
		policy_workspace_id: "w1",
		period_kind: "weekly",
		period_start: "2026-10-05",
		period_end: "2026-10-11",
		timezone: MANILA,
		week_start: 1,
		status: "open",
		approver_scope: "team",
		revision: 1,
		submitted_at: null,
		submitted_by: null,
		submission_kind: null,
		decided_at: null,
		decided_by: null,
		decision_kind: null,
		decision_note: null,
		overtime_approved: false,
		total_seconds: null,
		payable_seconds: null,
		origin: "app",
		created_at: "2026-10-05T00:00:00.000Z",
		updated_at: "2026-10-05T00:00:00.000Z",
		entry_count: 1,
		running_count: 0,
		logged_seconds: 3600,
		...over,
	};
}

const overview = (over: Partial<TimeOverview> = {}): TimeOverview => ({
	can_log: true,
	approver_mode: false,
	contexts: [],
	approvals_waiting: 0,
	workspace_time_admin: [],
	...over,
});

const PREFS = { timezone: MANILA, weekStart: 1 };
const A1 = "11111111-1111-4111-8111-111111111111";
const T9 = "99999999-9999-4999-8999-999999999999";

describe("resolveViewZone", () => {
	it("uses the person's preferences under All and Just me", () => {
		expect(resolveViewZone({ forRef: null, prefs: PREFS })).toEqual({
			timezone: MANILA,
			weekStart: 1,
			source: "preferences",
		});
		expect(
			resolveViewZone({
				forRef: { kind: "personal", id: null },
				prefs: { timezone: NY, weekStart: 7 },
			}),
		).toEqual({ timezone: NY, weekStart: 7, source: "preferences" });
	});

	it("reads a context's zone from its latest sheet, via the overview's sheet scope", () => {
		const zone = resolveViewZone({
			forRef: { kind: "assignment", id: "a1" },
			prefs: PREFS,
			overview: overview({
				contexts: [
					{
						kind: "assignment",
						id: "a1",
						label: "Acme Corp",
						sheet_scope: { kind: "engagement", ref: "eng1" },
						current_sheet: null,
					},
				],
			}),
			sheets: [
				sheet({
					scope_kind: "engagement",
					scope_ref: "eng1",
					timezone: "Europe/London",
					week_start: 3,
					period_start: "2026-09-01",
				}),
				sheet({
					scope_kind: "engagement",
					scope_ref: "eng1",
					timezone: NY,
					week_start: 7,
					period_start: "2026-10-04",
				}),
				sheet({ timezone: "UTC", week_start: 2 }),
			],
		});
		expect(zone).toEqual({ timezone: NY, weekStart: 7, source: "context" });
	});

	it("guesses a team or workspace scope without the overview, and falls back when no sheet matches", () => {
		expect(
			resolveViewZone({
				forRef: { kind: "team", id: "T1" },
				prefs: PREFS,
				sheets: [sheet({ timezone: NY, week_start: 7 })],
			}),
		).toEqual({ timezone: NY, weekStart: 7, source: "context" });
		expect(
			resolveViewZone({
				forRef: { kind: "workspace", id: "w9" },
				prefs: PREFS,
				sheets: [sheet()],
			}),
		).toEqual({ timezone: MANILA, weekStart: 1, source: "fallback" });
		expect(
			contextSheetScope({ kind: "assignment", id: "a1" }, null),
		).toBeNull();
	});

	it("cleans an invalid zone and week start", () => {
		expect(
			resolveViewZone({
				forRef: null,
				prefs: { timezone: "Not/AZone", weekStart: 9 },
			}),
		).toEqual({ timezone: "UTC", weekStart: 1, source: "preferences" });
	});
});

describe("view week", () => {
	it("snaps ?week= to its week start and defaults to this week in the view zone", () => {
		expect(
			viewWeekFor("2026-10-08", { timezone: MANILA, weekStart: 1 }),
		).toEqual(WEEK);
		expect(
			viewWeekFor(undefined, { timezone: MANILA, weekStart: 1 }, NOW),
		).toEqual(WEEK);
		// Sunday weeks.
		expect(
			viewWeekFor("2026-10-08", { timezone: MANILA, weekStart: 7 }),
		).toEqual({
			start: "2026-10-04",
			end: "2026-10-10",
		});
		// A malformed value is ignored.
		expect(
			viewWeekFor("2026-13-01", { timezone: MANILA, weekStart: 1 }, NOW),
		).toEqual(WEEK);
	});

	it("omits ?week= for the current week", () => {
		expect(weekParam(WEEK, "2026-10-06")).toBeUndefined();
		expect(
			weekParam({ start: "2026-09-28", end: "2026-10-04" }, "2026-10-06"),
		).toBe("2026-09-28");
	});
});

describe("dayTotals", () => {
	it("sums each day in the view zone, flags days over 8h and counts a running timer live", () => {
		const entries = [
			entry({ id: "a" }),
			entry({
				id: "b",
				started_at: "2026-10-05T05:00:00.000Z",
				ended_at: "2026-10-05T11:00:00.000Z",
				duration_seconds: 6 * 3600,
			}),
			// 23:30 UTC on Oct 6 is Oct 7 in Manila.
			entry({
				id: "c",
				started_at: "2026-10-06T23:30:00.000Z",
				ended_at: "2026-10-07T00:30:00.000Z",
				duration_seconds: 3600,
			}),
			entry({
				id: "run",
				started_at: "2026-10-06T02:00:00.000Z",
				ended_at: null,
				duration_seconds: null,
			}),
			// Outside the week.
			entry({
				id: "old",
				started_at: "2026-09-30T01:00:00.000Z",
				ended_at: "2026-09-30T02:00:00.000Z",
				duration_seconds: 3600,
			}),
		];
		const { days, weekSeconds } = dayTotals(entries, WEEK, {
			timeZone: MANILA,
			today: "2026-10-06",
			nowMs: NOW.getTime(),
		});
		expect(days.map((d) => d.date)).toEqual([
			"2026-10-05",
			"2026-10-06",
			"2026-10-07",
			"2026-10-08",
			"2026-10-09",
			"2026-10-10",
			"2026-10-11",
		]);
		expect(days[0]).toMatchObject({ seconds: 9.5 * 3600, over: true });
		expect(days[1]).toMatchObject({
			seconds: 3600,
			over: false,
			isToday: true,
		});
		expect(days[2]).toMatchObject({ seconds: 3600 });
		expect(weekSeconds).toBe(11.5 * 3600);
	});

	it("picks one day's entries", () => {
		const entries = [
			entry({ id: "a" }),
			entry({ id: "b", started_at: "2026-10-07T01:00:00.000Z" }),
		];
		expect(
			entriesOnDay(entries, "2026-10-07", MANILA).map((e) => e.id),
		).toEqual(["b"]);
		expect(entriesOnDay(entries, null, MANILA)).toHaveLength(2);
	});
});

describe("sheets", () => {
	it("keeps sheets overlapping the week, narrowed to the context's scope; Just me has none", () => {
		const team = sheet({ id: "team" });
		const ws = sheet({
			id: "ws",
			scope_kind: "workspace",
			scope_ref: "w1",
			period_start: "2026-10-01",
			period_end: "2026-10-15",
			period_kind: "semi_monthly",
		});
		const old = sheet({
			id: "old",
			period_start: "2026-09-21",
			period_end: "2026-09-27",
		});
		expect(sheetsInView([team, ws, old], WEEK).map((s) => s.id)).toEqual([
			"ws",
			"team",
		]);
		expect(
			sheetsInView([team, ws], WEEK, {
				forRef: { kind: "workspace", id: "w1" },
				scope: { kind: "workspace", ref: "w1" },
			}).map((s) => s.id),
		).toEqual(["ws"]);
		expect(
			sheetsInView([team, ws], WEEK, {
				forRef: { kind: "personal", id: null },
			}),
		).toEqual([]);
	});

	it("narrows the cards to the sheet holding the view's entries when the overview doesn't list the context", () => {
		const team = { kind: "team", id: "t9" } as const;
		const ws = sheet({ id: "ws", scope_kind: "workspace", scope_ref: "w1" });
		const other = sheet({ id: "other", scope_kind: "team", scope_ref: "t2" });
		// Pro: the team's time is on the workspace sheet; guessing the team would hide it.
		const scope = cardSheetScope(
			team,
			null,
			[other, ws],
			[entry({ timesheet_id: "ws" })],
		);
		expect(scope).toEqual({ kind: "workspace", ref: "w1" });
		expect(
			sheetsInView([other, ws], WEEK, { forRef: team, scope }).map((s) => s.id),
		).toEqual(["ws"]);
		// No entry pins a sheet: no narrowing rather than a guess.
		expect(cardSheetScope(team, null, [other, ws], [])).toBeNull();
		// The overview's answer wins when it lists the context.
		expect(
			cardSheetScope(
				team,
				{
					kind: "team",
					id: "t9",
					label: "Design",
					sheet_scope: { kind: "team", ref: "t9" },
					current_sheet: null,
				},
				[ws],
				[entry({ timesheet_id: "ws" })],
			),
		).toEqual({ kind: "team", ref: "t9" });
		expect(
			cardSheetScope({ kind: "personal", id: null }, null, [ws], []),
		).toBeNull();
	});

	it("collects decider names from A1 and A2", () => {
		expect(
			sheetPeopleNames([
				sheet({
					routing_preview: {
						approver_scope: "team",
						cost_money: false,
						deciders: [{ id: "ana", display_name: "Ana Reyes" }],
					},
				}),
				sheet({
					deciders: [
						{ id: "leo", display_name: " Leo Cruz " },
						{ id: "x", display_name: null },
					],
				}),
			]),
		).toEqual({ ana: "Ana Reyes", leo: "Leo Cruz" });
	});
});

describe("labels", () => {
	const ov = overview({
		contexts: [
			{
				kind: "team",
				id: "t1",
				label: "Prodigitality Services Inc. Team",
				sheet_scope: { kind: "team", ref: "t1" },
				current_sheet: null,
			},
			{
				kind: "assignment",
				id: "a1",
				label: "Acme Corp",
				sheet_scope: { kind: "engagement", ref: "e1" },
				current_sheet: null,
			},
			{
				kind: "personal",
				id: null,
				label: "Just me",
				sheet_scope: null,
				current_sheet: null,
			},
			{
				kind: "workspace",
				id: "w1",
				label: "Acme",
				sheet_scope: { kind: "workspace", ref: "w1" },
				current_sheet: null,
			},
		],
	});

	it("names a context from the overview, else from an entry", () => {
		expect(forRefLabel({ kind: "team", id: "T1" }, { overview: ov })).toBe(
			"Prodigitality Services Inc. Team",
		);
		expect(forRefLabel({ kind: "personal", id: null })).toBe("Just me");
		expect(
			forRefLabel(
				{ kind: "team", id: "t9" },
				{
					entries: [
						entry({ context_ref: "t9", context_label_snapshot: "Design" }),
					],
				},
			),
		).toBe("Design");
		expect(forRefLabel({ kind: "team", id: "zz" })).toBeNull();
		expect(findOverviewContext(ov, { kind: "personal", id: null })?.label).toBe(
			"Just me",
		);
	});

	it("shows the zone label only when it differs", () => {
		const base = { prefsTimezone: MANILA, forRef: null } as const;
		expect(
			zoneLabel({
				...base,
				zone: { timezone: MANILA, weekStart: 1, source: "preferences" },
			}),
		).toBeNull();
		expect(
			zoneLabel({
				...base,
				zone: { timezone: MANILA, weekStart: 1, source: "preferences" },
				sheets: [sheet({ timezone: NY })],
			}),
		).toBe("Your time (Asia/Manila)");
		expect(
			zoneLabel({
				zone: { timezone: NY, weekStart: 7, source: "context" },
				prefsTimezone: MANILA,
				forRef: { kind: "assignment", id: "a1" },
				contextName: "Acme Corp",
			}),
		).toBe("Acme Corp time (America/New_York)");
		expect(
			zoneLabel({
				zone: { timezone: MANILA, weekStart: 1, source: "context" },
				prefsTimezone: MANILA,
				forRef: { kind: "team", id: "t1" },
				contextName: "Team",
			}),
		).toBeNull();
		expect(
			zoneLabel({
				zone: { timezone: MANILA, weekStart: 1, source: "fallback" },
				prefsTimezone: NY,
				forRef: { kind: "team", id: "t1" },
			}),
		).toBeNull();
	});

	it("lists the For choices, agreements first and Just me last", () => {
		const options = forFilterOptions(ov, null, { native: false });
		expect(options.map((o) => [o.value, o.label])).toEqual([
			["assignment:a1", "Acme Corp · agreement"],
			["team:t1", "Prodigitality Services Inc. Team"],
			["workspace:w1", "Acme"],
			["personal", "Just me"],
		]);
		expect(forFilterOptions(ov, null, { native: true })[0].label).toBe(
			"Acme Corp",
		);
	});

	it("keeps the current ?for= when the overview doesn't list it", () => {
		const options = forFilterOptions(
			overview(),
			{ kind: "team", id: "t9" },
			{
				entries: [
					entry({ context_ref: "t9", context_label_snapshot: "Design" }),
				],
			},
		);
		expect(options).toEqual([
			{ value: "team:t9", label: "Design", kind: "team" },
		]);
		expect(
			forFilterOptions(overview(), { kind: "workspace", id: "w9" })[0].label,
		).toBe("This workspace");
		expect(
			forFilterOptions(overview(), { kind: "team", id: "t9" })[0].label,
		).toBe("This team");
		// Never " · agreement" without a name.
		expect(
			forFilterOptions(
				overview(),
				{ kind: "assignment", id: A1 },
				{ native: false },
			)[0].label,
		).toBe("Your agreement");
		// A known team or workspace name fills in before the generic label.
		expect(
			forFilterOptions(
				overview(),
				{ kind: "team", id: "t9" },
				{ names: { t9: "Design" } },
			)[0].label,
		).toBe("Design");
		expect(
			forRefLabel({ kind: "workspace", id: "w9" }, { names: { w9: "Acme" } }),
		).toBe("Acme");
	});

	it("knows when everything is Just me, and spells For for the API", () => {
		expect(onlyPersonal(overview())).toBe(true);
		expect(onlyPersonal(ov)).toBe(false);
		expect(forRequestOf({ kind: "personal", id: null })).toEqual({
			kind: "personal",
			id: null,
		});
		expect(forRequestOf({ kind: "team", id: "t1" })).toEqual({
			kind: "team",
			id: "t1",
		});
		expect(forRequestOf(null)).toBeNull();
	});
});

// ── The hook ────────────────────────────────────────────────────────────────

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useTimePageData", () => {
	beforeEach(() => {
		client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		useAuthStore.setState({ user: { id: "u1" } as never });
		vi.spyOn(timeService, "getPreferences").mockResolvedValue({
			user_id: "u1",
			timezone: MANILA,
			week_start: 1,
			updated_at: "2026-01-01T00:00:00.000Z",
		});
	});

	afterEach(() => {
		cleanup();
		client.clear();
		useAuthStore.setState({ user: null });
		vi.restoreAllMocks();
	});

	it("reads the view week's entries and sheets in the person's zone under All", async () => {
		vi.spyOn(timeService, "getOverview").mockResolvedValue(overview());
		const list = vi
			.spyOn(timeService, "listMyEntries")
			.mockResolvedValue({ items: [entry()], total: 1, page: 1, limit: 200 });
		const sheets = vi
			.spyOn(timeService, "listMyTimesheets")
			.mockResolvedValue([sheet()]);

		const { result } = renderHook(
			() => useTimePageData({ week: "2026-10-07" }, { now: NOW }),
			{ wrapper },
		);
		await waitFor(() => expect(result.current.entries).toHaveLength(1));
		expect(list).toHaveBeenCalledWith(
			expect.objectContaining({
				from: "2026-10-05",
				to: "2026-10-11",
				page: 1,
			}),
		);
		expect(sheets).toHaveBeenCalledWith({
			from: "2026-10-05",
			to: "2026-10-11",
		});
		await waitFor(() => expect(result.current.sheets).toHaveLength(1));
		expect(result.current.isCurrentWeek).toBe(true);
		expect(result.current.zone.source).toBe("preferences");
		expect(result.current.approverMode).toBe(false);
	});

	it("waits for the context's sheets, then reads the week in its zone with ?for=", async () => {
		vi.spyOn(timeService, "getOverview").mockResolvedValue(
			overview({
				contexts: [
					{
						kind: "assignment",
						id: A1,
						label: "Acme Corp",
						sheet_scope: { kind: "engagement", ref: "e1" },
						current_sheet: null,
					},
				],
			}),
		);
		const list = vi
			.spyOn(timeService, "listMyEntries")
			.mockResolvedValue({ items: [], total: 0, page: 1, limit: 200 });
		vi.spyOn(timeService, "listMyTimesheets").mockImplementation(async (q) =>
			q?.to
				? []
				: [
						sheet({
							scope_kind: "engagement",
							scope_ref: "e1",
							timezone: NY,
							week_start: 7,
							period_start: "2026-10-04",
							period_end: "2026-10-10",
						}),
					],
		);

		const { result } = renderHook(
			() => useTimePageData({ for: `assignment:${A1}` }, { now: NOW }),
			{ wrapper },
		);
		await waitFor(() => expect(list).toHaveBeenCalled());
		// Every read used the context's Sunday week in New York (Oct 5 there).
		for (const call of list.mock.calls) {
			expect(call[0]).toMatchObject({
				from: "2026-10-04",
				to: "2026-10-10",
				for: { kind: "assignment", id: A1 },
			});
		}
		expect(result.current.zone).toEqual({
			timezone: NY,
			weekStart: 7,
			source: "context",
		});
		expect(result.current.zoneText).toBe("Acme Corp time (America/New_York)");
	});

	it("names a ?for=team: the overview doesn't list from the person's teams, and doesn't narrow the cards on a guess", async () => {
		teams.listMyTeams.mockResolvedValue([
			{ id: T9, name: "Design", owner_id: "u2" },
		]);
		vi.spyOn(timeService, "getOverview").mockResolvedValue(overview());
		vi.spyOn(timeService, "listMyEntries").mockResolvedValue({
			items: [],
			total: 0,
			page: 1,
			limit: 200,
		});
		// Pro: the team's time lands on the workspace sheet.
		vi.spyOn(timeService, "listMyTimesheets").mockResolvedValue([
			sheet({ id: "ws", scope_kind: "workspace", scope_ref: "w1" }),
		]);
		const { result } = renderHook(
			() => useTimePageData({ for: `team:${T9}` }, { now: NOW }),
			{ wrapper },
		);
		await waitFor(() => expect(result.current.forName).toBe("Design"));
		expect(result.current.forOptions).toEqual([
			{ value: `team:${T9}`, label: "Design", kind: "team" },
		]);
		await waitFor(() =>
			expect(result.current.sheets.map((s) => s.id)).toEqual(["ws"]),
		);
		expect(teams.listMyTeams).toHaveBeenCalled();
	});

	it("reads no week in approver mode", async () => {
		vi.spyOn(timeService, "getOverview").mockResolvedValue(
			overview({ approver_mode: true, approvals_waiting: 2 }),
		);
		const list = vi.spyOn(timeService, "listMyEntries");
		const { result } = renderHook(() => useTimePageData({}, { now: NOW }), {
			wrapper,
		});
		await waitFor(() => expect(result.current.approverMode).toBe(true));
		await new Promise((resolve) => setTimeout(resolve, 20));
		// A read may have started before the overview answered; none after.
		expect(list.mock.calls.length).toBeLessThanOrEqual(1);
	});
});
