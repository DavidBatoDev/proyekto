import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import {
	deciderDetail,
	ENGAGEMENT_ID,
	entries,
	entry,
	event,
	manila,
	memberDetail,
	NOW,
	rules,
	sheet,
	TZ,
} from "./__fixtures__/reviewFixtures";
import {
	addedLater,
	buildReviewGrid,
	filterLabel,
	filterReviewEntries,
	flagsLineParts,
	HIDDEN_ROW_KEY,
	headerFacts,
	historyItems,
	latestEvent,
	overLimitHead,
	reviewButtons,
	reviewFlags,
	reviewNames,
	reviewPersonName,
	rulesView,
	settledHrefFor,
	sheetCost,
	sheetOvertime,
	sheetWeeklyLimit,
} from "./reviewModel";

const NOW_MS = NOW.getTime();
const OPTS = { now: NOW, userTimezone: TZ };

describe("buildReviewGrid", () => {
	const grid = buildReviewGrid(sheet(), entries(), { nowMs: NOW_MS });

	it("has a column for every day of the period and the totals", () => {
		expect(grid.days).toEqual([
			"2026-09-21",
			"2026-09-22",
			"2026-09-23",
			"2026-09-24",
			"2026-09-25",
			"2026-09-26",
			"2026-09-27",
		]);
		expect(grid.totalSeconds).toBe(18 * 3600);
		expect(grid.dayTotals["2026-09-24"]).toBe(11 * 3600 + 40 * 60);
		expect(grid.projectCount).toBe(4);
	});

	it("merges projects the reader can't open into one row, last (L21)", () => {
		expect(grid.rows.map((r) => r.label)).toEqual([
			"Acme Website",
			"Internal ops",
			"Projects you can't open",
		]);
		const merged = grid.rows[2];
		expect(merged.key).toBe(HIDDEN_ROW_KEY);
		expect(merged.merged).toBe(true);
		expect(merged.totalSeconds).toBe(3600 + 20 * 60);
		expect(merged.byDay["2026-09-22"]).toBe(3600);
		expect(merged.byDay["2026-09-23"]).toBe(20 * 60);
	});

	it("adds a column for an entry outside the period instead of losing it", () => {
		const odd = entry({
			id: "x",
			started_at: manila("2026-09-28", "09:00"),
			ended_at: manila("2026-09-28", "10:00"),
			duration_seconds: 3600,
		});
		const g = buildReviewGrid(sheet(), [odd], { nowMs: NOW_MS });
		expect(g.days.at(-1)).toBe("2026-09-28");
		expect(g.totalSeconds).toBe(3600);
	});

	it("counts a running entry's live time", () => {
		const running = entry({
			id: "r",
			started_at: new Date(NOW_MS - 2 * 3600 * 1000).toISOString(),
			ended_at: null,
			duration_seconds: null,
		});
		const g = buildReviewGrid(
			sheet({ period_start: "2026-10-05", period_end: "2026-10-11" }),
			[running],
			{ nowMs: NOW_MS },
		);
		expect(g.totalSeconds).toBe(2 * 3600);
	});
});

describe("filters", () => {
	const all = entries();
	const grid = buildReviewGrid(sheet(), all, { nowMs: NOW_MS });

	it("filters to a cell, a row, a day, and merged cells give the merged rows", () => {
		expect(
			filterReviewEntries(all, { rowKey: "p1", date: "2026-09-24" }, TZ).map(
				(e) => e.id,
			),
		).toEqual(["e2"]);
		expect(
			filterReviewEntries(all, { rowKey: "p2" }, TZ).map((e) => e.id),
		).toEqual(["e3", "e6"]);
		expect(
			filterReviewEntries(all, { date: "2026-09-24" }, TZ).map((e) => e.id),
		).toEqual(["e2", "e3"]);
		expect(
			filterReviewEntries(all, { rowKey: HIDDEN_ROW_KEY }, TZ).map((e) => e.id),
		).toEqual(["e4", "e5"]);
		expect(filterReviewEntries(all, null, TZ)).toHaveLength(6);
	});

	it("names the filter", () => {
		expect(filterLabel({ rowKey: "p1", date: "2026-09-24" }, grid, OPTS)).toBe(
			"Acme Website · Thu Sep 24",
		);
		expect(filterLabel({ rowKey: HIDDEN_ROW_KEY }, grid, OPTS)).toBe(
			"Projects you can't open",
		);
	});
});

describe("flags", () => {
	it("finds days over 8h, entries added later and long entries", () => {
		const list = entries();
		list.push(
			entry({
				id: "long",
				started_at: manila("2026-09-26", "06:00"),
				ended_at: manila("2026-09-26", "16:30"),
				created_at: manila("2026-09-26", "16:30"),
				duration_seconds: 10.5 * 3600,
			}),
		);
		const grid = buildReviewGrid(sheet(), list, { nowMs: NOW_MS });
		const flags = reviewFlags(sheet(), list, grid, { nowMs: NOW_MS });
		expect(flags.overDays.map((d) => d.date)).toEqual([
			"2026-09-24",
			"2026-09-26",
		]);
		expect(flags.long).toBe(1);
		expect(flags.late).toBe(1);
		expect([...flags.flaggedIds].sort()).toEqual(["e6", "long"]);
		expect(flagsLineParts(flags, { weekly: true, ...OPTS })).toEqual([
			"Thu is 11h 40m",
			"Sat is 10h 30m",
			"1 entry over 10h",
			"1 entry added later",
		]);
	});

	it("names stopped and running timers, and counts many days", () => {
		const list = [
			entry({ id: "a", flagged_reason: "auto_stopped_24h" }),
			entry({ id: "b", flagged_reason: "auto_stopped_24h" }),
		];
		const flags = reviewFlags(
			sheet(),
			list,
			{
				days: ["2026-09-21", "2026-09-22", "2026-09-23"],
				dayTotals: {
					"2026-09-21": 9 * 3600,
					"2026-09-22": 9 * 3600,
					"2026-09-23": 9 * 3600,
				},
			},
			{ nowMs: NOW_MS },
		);
		expect(flagsLineParts(flags, { weekly: false, ...OPTS })).toEqual([
			"3 days over 8h",
			"2 timers stopped automatically",
		]);
	});

	it("doesn't call imported time 'added later'", () => {
		const late = entry({
			created_at: manila("2026-10-01", "09:00"),
		});
		expect(addedLater(late, TZ)).toBe(true);
		const flags = reviewFlags(
			sheet({ origin: "legacy_migration" }),
			[late],
			{ days: [], dayTotals: {} },
			{ nowMs: NOW_MS },
		);
		expect(flags.late).toBe(0);
	});

	it("is empty when nothing is flagged", () => {
		const list = [entry()];
		const grid = buildReviewGrid(sheet(), list, { nowMs: NOW_MS });
		expect(
			flagsLineParts(reviewFlags(sheet(), list, grid, { nowMs: NOW_MS })),
		).toEqual([]);
	});
});

describe("header", () => {
	const grid = buildReviewGrid(sheet(), entries(), { nowMs: NOW_MS });

	it("reads 'Submitted Sep 28, 10:14 · 18:00 · 4 projects'", () => {
		expect(headerFacts(sheet(), grid, { now: NOW })).toEqual([
			"Submitted Sep 28, 10:14",
			"18:00",
			"4 projects",
		]);
	});

	it("follows submission_kind", () => {
		expect(
			headerFacts(sheet({ submission_kind: "legacy" }), grid, { now: NOW })[0],
		).toBe("Imported Sep 28, 10:14");
		expect(
			headerFacts(sheet({ submission_kind: "auto" }), grid, { now: NOW })[0],
		).toBe("Sent automatically Sep 28, 10:14");
		expect(
			headerFacts(sheet({ submission_kind: "on_deletion" }), grid, {
				now: NOW,
			})[0],
		).toBe("Sent when the account was closed Sep 28, 10:14");
		expect(
			headerFacts(sheet({ status: "open", submitted_at: null }), grid, {
				now: NOW,
			}),
		).toEqual(["18:00", "4 projects"]);
	});

	it("adds the approved time when it differs", () => {
		expect(
			headerFacts(
				sheet({ status: "approved", payable_seconds: 17 * 3600 }),
				grid,
				{ now: NOW },
			),
		).toContain("17:00 approved");
	});

	it("names the person, or 'Delivery team' when masked", () => {
		expect(reviewPersonName(deciderDetail())).toBe("Maria Santos");
		const masked = deciderDetail({
			entries: [
				entry({
					identity: "masked",
					member: null,
					member_user_id: null,
					member_label: "Delivery team",
				}),
			],
		});
		expect(reviewPersonName(masked)).toBe("Delivery team");
		expect(reviewNames(memberDetail())).toMatchObject({
			"22222222-2222-4222-8222-222222222222": "Ana Reyes",
		});
	});
});

describe("rulesView", () => {
	it("reads the snapshot written at submit", () => {
		expect(rulesView(deciderDetail())?.text).toBe(
			"Rules at submit: weekly · team owners & admins approve · manual time up to 7 days back",
		);
		expect(
			rulesView(
				deciderDetail({
					rules: rules({ rounding_minutes: 15, allow_manual_entries: false }),
				}),
			)?.text,
		).toBe(
			"Rules at submit: weekly · team owners & admins approve · manual time off · rounds to the nearest 15 min",
		);
	});

	it("is absent while the sheet is open", () => {
		expect(rulesView(deciderDetail({ rules: null }))).toBeNull();
	});

	it("points agreement sheets at the terms, web only", () => {
		const agreement = deciderDetail({
			sheet: sheet({
				scope_kind: "engagement",
				scope_label_snapshot: "Acme Corp",
				engagement_id: ENGAGEMENT_ID,
				approver_scope: "hirer",
			}),
		});
		expect(rulesView(agreement)).toEqual({
			text: "Rules from this agreement",
			engagementId: ENGAGEMENT_ID,
		});
		const asMember = {
			...agreement,
			viewer: { is_member: true, can_decide: false, actions: [] },
		};
		expect(rulesView(asMember)?.text).toBe(
			"Rules from your agreement with Acme Corp",
		);
		expect(rulesView(asMember, { native: true })?.engagementId).toBeNull();
	});

	it("names the agreement on the member's open sheet too", () => {
		expect(
			rulesView(
				memberDetail({
					sheet: sheet({
						status: "open",
						submitted_at: null,
						scope_kind: "engagement",
						scope_label_snapshot: "Acme Corp",
						engagement_id: ENGAGEMENT_ID,
						approver_scope: "hirer",
					}),
					rules: null,
					viewer: { is_member: true, can_decide: false, actions: ["submit"] },
				}),
			)?.text,
		).toBe("Rules from your agreement with Acme Corp");
	});
});

describe("limits, overtime and cost", () => {
	const grid = { totalSeconds: 43.5 * 3600 };

	it("reads a policy limit as an indicator and an agreement limit as a cap", () => {
		const policy = deciderDetail({
			rules: rules({
				weekly_limit_minutes: 2400,
				sources: { weekly_limit_minutes: "team" },
			}),
		});
		expect(sheetWeeklyLimit(policy, grid)).toEqual({
			source: "policy",
			label: "Prodigitality Services Inc. Team",
			limitMinutes: 2400,
			loggedSeconds: 43.5 * 3600,
		});
		const agreement = deciderDetail({
			rules: rules({
				weekly_limit_minutes: 2400,
				sources: { weekly_limit_minutes: "contract" },
			}),
		});
		expect(sheetWeeklyLimit(agreement, grid)?.source).toBe("agreement");
		expect(
			sheetWeeklyLimit(
				deciderDetail({
					sheet: sheet({ period_kind: "monthly" }),
					rules: rules({ weekly_limit_minutes: 2400 }),
				}),
				grid,
			),
		).toBeNull();
		expect(sheetWeeklyLimit(deciderDetail(), grid)).toBeNull();
	});

	it("takes overtime from the freeze preview only", () => {
		expect(sheetOvertime(deciderDetail())).toBeNull();
		expect(
			sheetOvertime(
				deciderDetail({
					freeze_preview: {
						timesheet_id: "s",
						over_cap_seconds: 3.5 * 3600,
						entries: [
							{
								entry_id: "e1",
								rounded_seconds: 30 * 3600,
								payable_seconds: 30 * 3600,
								over_cap_seconds: 0,
							},
							{
								entry_id: "e2",
								rounded_seconds: 13.5 * 3600,
								payable_seconds: 10 * 3600,
								over_cap_seconds: 3.5 * 3600,
							},
						],
					},
				}),
			),
		).toEqual({
			overSeconds: 3.5 * 3600,
			payableSeconds: 40 * 3600,
			countedSeconds: 43.5 * 3600,
		});
	});

	it("heads the panel with the preview's rounded time and overtime", () => {
		const reading = {
			source: "agreement" as const,
			label: "Acme Corp",
			limitMinutes: 2400,
			// Raw logged time: 43:20. Rounded per entry (15 min): 43:30.
			loggedSeconds: 43 * 3600 + 20 * 60,
		};
		expect(
			overLimitHead(
				{ overSeconds: 3.5 * 3600, countedSeconds: 43.5 * 3600 },
				reading,
			),
		).toBe(
			"Weekly limit 40h in the agreement with Acme Corp · 43:30 logged · 3:30 over",
		);
		// Without rounded figures it falls back to the logged time, but the
		// overtime is still the preview's.
		expect(
			overLimitHead({ overSeconds: 3.5 * 3600, countedSeconds: null }, reading),
		).toBe(
			"Weekly limit 40h in the agreement with Acme Corp · 43:20 logged · 3:30 over",
		);
		expect(
			overLimitHead(
				{ overSeconds: 3600, countedSeconds: 41 * 3600 },
				{ ...reading, label: null },
			),
		).toBe("Weekly limit 40h in the agreement · 41:00 logged · 1:00 over");
		// A member cap (no agreement reading).
		expect(overLimitHead({ overSeconds: 2 * 3600 })).toBe(
			"2:00 over the limit",
		);
		expect(
			overLimitHead(
				{ overSeconds: 2 * 3600 },
				{ ...reading, source: "policy" },
			),
		).toBe("2:00 over the limit");
	});

	it("estimates cost from the preview, or the entries when every one is visible", () => {
		expect(sheetCost(deciderDetail())).toBeNull();
		expect(
			sheetCost(
				deciderDetail({
					freeze_preview: {
						timesheet_id: "s",
						entries: [],
						over_cap_seconds: 0,
						amounts_by_currency: { PHP: 6885, USD: 120 },
					},
				}),
			),
		).toEqual({ kind: "estimate", amounts: { PHP: 6885, USD: 120 } });
		const visible = (over = {}) =>
			entry({
				cost: "visible",
				rate_snapshot: 450,
				rate_type_snapshot: "hourly",
				currency_snapshot: "PHP",
				...over,
			});
		expect(
			sheetCost(memberDetail({ entries: [visible(), visible({ id: "b" })] }), {
				nowMs: NOW_MS,
			}),
		).toEqual({ kind: "estimate", amounts: { PHP: 3600 } });
		expect(
			sheetCost(memberDetail({ entries: [visible(), entry({ id: "b" })] })),
		).toBeNull();
		expect(
			sheetCost(
				deciderDetail({
					sheet: sheet({ status: "approved" }),
					freeze_preview: undefined,
					entries: [
						visible({ payable_seconds: 4 * 3600, amount_snapshot: 1800 }),
					],
				}),
			),
		).toEqual({ kind: "final", amounts: { PHP: 1800 } });
	});
});

describe("history", () => {
	it("lists events oldest first, with Resubmitted and notes", () => {
		const items = historyItems(
			[
				event({
					id: 3,
					event: "submitted",
					from_status: "returned",
					created_at: "2026-10-01T01:00:00.000Z",
				}),
				event({
					id: 1,
					event: "legacy_import",
					created_at: "2026-09-29T01:00:00.000Z",
				}),
				event({
					id: 2,
					event: "returned",
					note: "Split Thu",
					actor_user_id: "d",
					created_at: "2026-09-30T02:00:00.000Z",
				}),
			],
			{ timeZone: TZ, now: NOW },
		);
		expect(items.map((i) => [i.text, i.day, i.note])).toEqual([
			["Imported from per-entry review", "Sep 29", null],
			["Returned", "Sep 30", "Split Thu"],
			["Resubmitted", "Oct 1", null],
		]);
		expect(items[1].when).toBe("Sep 30, 10:00");
	});

	it("finds the newest event", () => {
		expect(
			latestEvent([
				event({ id: 1, created_at: "2026-09-28T00:00:00.000Z" }),
				event({ id: 2, created_at: "2026-09-29T00:00:00.000Z" }),
			])?.id,
		).toBe(2);
		expect(latestEvent([])).toBeNull();
	});
});

describe("reviewButtons", () => {
	it("maps viewer.actions to the buttons, primary last", () => {
		expect(
			reviewButtons(["approve", "return"], "submitted").map((b) => b.label),
		).toEqual(["Return…", "Approve…"]);
		expect(reviewButtons(["withdraw"], "submitted")[0].label).toBe("Withdraw");
		expect(reviewButtons(["reopen"], "approved")[0].label).toBe("Reopen");
		expect(reviewButtons(["request_reopen"], "approved")[0].label).toBe(
			"Ask to reopen",
		);
		expect(reviewButtons(["submit"], "returned")[0]).toEqual({
			id: "submit",
			label: "Resubmit",
			primary: true,
		});
		expect(reviewButtons(["auto_submit"], "open")).toEqual([]);
		expect(reviewButtons([], "submitted")).toEqual([]);
	});

	it("links settled refusals to the project's invoices or the team's payouts", () => {
		// Several projects, none marked billed yet: the invoices hub.
		const href = settledHrefFor(sheet(), entries());
		expect(href({ kind: "invoice", id: "i1" })).toBe(
			"/engagements/finance/invoices",
		);
		expect(href({ kind: "payout", id: "p1" })).toBe("/teams/t1/time/payouts");
		expect(
			settledHrefFor(sheet({ team_id: null }))({ kind: "payout", id: "p" }),
		).toBeNull();
		// A billed entry names the project (its Invoices tab edits a draft and
		// voids an issued invoice; the editor alone can do neither without it).
		const billed = entries().map((e) =>
			e.id === "e3" ? { ...e, locked_reason: "billed" as const } : e,
		);
		expect(settledHrefFor(sheet(), billed)({ kind: "invoice", id: "i1" })).toBe(
			"/engagements/finance/invoices?projectId=p2",
		);
		// One project on the sheet: that project.
		expect(
			settledHrefFor(sheet(), [entry(), entry({ id: "e2" })])({
				kind: "invoice",
				id: "i1",
			}),
		).toBe("/engagements/finance/invoices?projectId=p1");
	});
});
