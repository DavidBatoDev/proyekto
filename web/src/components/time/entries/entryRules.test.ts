import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import type { TimeEntryView } from "@/services/time.types";
import {
	ACCENT_CLASS,
	amountRecord,
	ENTRY_COPY,
	entryAccent,
	entryActions,
	entryAmount,
	entryBadgeKinds,
	entryLockCopy,
	entryLockReason,
	entryMemberLabel,
	entrySelection,
	entrySheetLine,
	entryStatusLabel,
	entryTitle,
	groupEntries,
	NEEDS_REVIEW_GROUP_KEY,
	NEEDS_REVIEW_SECONDS,
	needsReview,
	needsReviewCaption,
	needsReviewCopy,
	needsReviewReason,
	workItemLabel,
} from "./entryRules";

const TZ = "Asia/Manila";
const NOW = new Date("2026-10-06T04:00:00.000Z");
const NOW_MS = NOW.getTime();

// Thu Oct 1 2026, 09:00–12:30 in Manila.
function entry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return {
		id: "e1",
		context_kind: "team",
		context_ref: "t1",
		context_label_snapshot: "Prodigitality Services Inc. Team",
		timesheet_id: "s1",
		work_item: "task",
		started_at: "2026-10-01T01:00:00.000Z",
		ended_at: "2026-10-01T04:30:00.000Z",
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
		created_at: "2026-10-01T04:30:00.000Z",
		updated_at: "2026-10-01T04:30:00.000Z",
		timesheet: {
			id: "s1",
			status: "open",
			period_start: "2026-09-28",
			period_end: "2026-10-04",
			decision_kind: null,
			decided_by: null,
			decided_at: null,
			decision_note: null,
			scope_label_snapshot: "Prodigitality Services Inc. Team",
		},
		locked_reason: null,
		identity: "visible",
		member_user_id: "u1",
		member_display_name_snapshot: "Maria Santos",
		member: {
			id: "u1",
			display_name: "Maria Santos",
			avatar_url: null,
		},
		member_label: null,
		content: "visible",
		task_id: "task-1",
		note: null,
		task: {
			id: "task-1",
			title: "Fix login bug",
			work_type: "real_work",
			status: "todo",
		},
		project: { id: "p1", title: "Acme Website" },
		content_label: null,
		cost: "visible",
		rate_snapshot: 450,
		rate_type_snapshot: "hourly",
		currency_snapshot: "PHP",
		amount_snapshot: null,
		...over,
	};
}

function sheet(
	status: NonNullable<TimeEntryView["timesheet"]>["status"],
	over: Partial<NonNullable<TimeEntryView["timesheet"]>> = {},
): TimeEntryView["timesheet"] {
	return {
		id: "s1",
		status,
		period_start: "2026-09-28",
		period_end: "2026-10-04",
		decision_kind: null,
		decided_by: null,
		decided_at: null,
		decision_note: null,
		scope_label_snapshot: "Prodigitality Services Inc. Team",
		...over,
	};
}

describe("entryTitle", () => {
	it("reads the task, a preset, a missing title and hidden content", () => {
		expect(entryTitle(entry())).toEqual({
			text: "Fix login bug",
			kind: "task",
		});
		expect(
			entryTitle(entry({ task: null, task_id: null, work_item: "meeting" })),
		).toEqual({ text: "Meeting", kind: "preset" });
		expect(entryTitle(entry({ task: null }))).toEqual({
			text: "Untitled task",
			kind: "missing",
		});
		expect(
			entryTitle(
				entry({
					content: "hidden",
					task: null,
					task_id: null,
					project: null,
					content_label: "A project you can't open",
				}),
			),
		).toEqual({ text: "A project you can't open", kind: "hidden" });
		// The server's label is optional; the copy stands in.
		expect(
			entryTitle(entry({ content: "hidden", task: null, content_label: null }))
				.text,
		).toBe(ENTRY_COPY.hiddenContent);
		expect(workItemLabel("admin")).toBe("Admin");
	});
});

describe("entryMemberLabel", () => {
	it("never names a masked worker", () => {
		expect(entryMemberLabel(entry())).toBe("Maria Santos");
		expect(
			entryMemberLabel(
				entry({
					identity: "masked",
					member: null,
					member_user_id: null,
					member_display_name_snapshot: null,
					member_label: "Delivery team",
				}),
			),
		).toBe("Delivery team");
		expect(
			entryMemberLabel(entry({ identity: "masked", member_label: null })),
		).toBe("Delivery team");
	});
});

describe("lock matrix", () => {
	it("trusts the server's locked_reason", () => {
		expect(entryLockReason(entry({ locked_reason: "billed" }))).toBe("billed");
		expect(entryLockReason(entry({ locked_reason: null }))).toBeNull();
	});

	it("derives the reason in trg_40's order when the row lacks it", () => {
		const derive = (over: Partial<TimeEntryView>) => {
			const row = entry(over) as Partial<TimeEntryView>;
			delete row.locked_reason;
			return entryLockReason(row as TimeEntryView);
		};
		expect(derive({ payout_id: "po1", timesheet: sheet("approved") })).toBe(
			"paid",
		);
		expect(derive({ legacy_status: "paid_outside" })).toBe("paid");
		expect(derive({ legacy_status: "rejected" })).toBe("legacy");
		expect(derive({ payable_seconds: 3600 })).toBe("frozen");
		expect(derive({ timesheet: sheet("submitted") })).toBe("sheet_submitted");
		expect(derive({ timesheet: sheet("returned") })).toBeNull();
		expect(derive({ timesheet: null })).toBeNull();
	});

	it("tells the member why a row is locked", () => {
		const submitted = entry({
			timesheet: sheet("submitted"),
			locked_reason: "sheet_submitted",
		});
		expect(
			entryLockCopy(submitted, {
				timeZone: TZ,
				now: NOW,
				sheet: { id: "s1", submitted_at: "2026-10-06T02:00:00.000Z" },
			}),
		).toBe("Submitted Oct 6. Withdraw to change.");
		// Without the sheet row the date is unknown.
		expect(entryLockCopy(submitted, { timeZone: TZ, now: NOW })).toBe(
			"Submitted. Withdraw to change.",
		);
		const approved = entry({
			timesheet: sheet("approved", {
				decided_at: "2026-10-06T02:00:00.000Z",
			}),
			payable_seconds: 12600,
			locked_reason: "frozen",
		});
		expect(entryLockCopy(approved, { timeZone: TZ, now: NOW })).toBe(
			"Approved Oct 6. Ask to reopen to change.",
		);
		expect(
			entryLockCopy(entry({ payout_id: "po1", locked_reason: "paid" })),
		).toBe("This time has been paid, so it can't change.");
		expect(
			entryLockCopy(
				entry({ legacy_status: "paid_outside", locked_reason: "paid" }),
			),
		).toBe("This time was paid outside Proyekto, so it can't change.");
		expect(
			entryLockCopy(entry({ locked_reason: "billed" }), { native: false }),
		).toBe("This time is on an invoice, so it can't change.");
		expect(
			entryLockCopy(entry({ locked_reason: "billed" }), { native: true }),
		).toBe("This time is already being billed, so it can't change.");
		expect(entryLockCopy(entry())).toBeNull();
	});
});

describe("entryActions", () => {
	const ids = (rules: ReturnType<typeof entryActions>) =>
		rules.map((r) => r.id);

	it("an open row of your own offers every edit", () => {
		expect(
			ids(entryActions(entry(), { mode: "mine", canOpenTask: true })),
		).toEqual([
			"view",
			"comment",
			"edit",
			"change_task",
			"change_for",
			"delete",
			"open_task",
		]);
		// No roadmap link without a task or permission.
		expect(ids(entryActions(entry(), { mode: "mine" }))).not.toContain(
			"open_task",
		);
	});

	it("a locked row keeps only View details and Comment", () => {
		for (const locked_reason of [
			"sheet_submitted",
			"sheet_approved",
			"paid",
			"billed",
			"legacy",
			"frozen",
		] as const) {
			expect(
				ids(
					entryActions(entry({ locked_reason }), {
						mode: "mine",
						canOpenTask: true,
					}),
				),
			).toEqual(["view", "comment"]);
		}
	});

	it("review and readonly never edit", () => {
		for (const mode of ["review", "readonly"] as const) {
			expect(ids(entryActions(entry(), { mode, canOpenTask: true }))).toEqual([
				"view",
				"comment",
			]);
		}
	});

	it("a running row stops, and its times wait for the stop", () => {
		const rules = entryActions(
			entry({ ended_at: null, duration_seconds: null }),
			{ mode: "mine" },
		);
		expect(ids(rules)).toEqual([
			"stop",
			"view",
			"comment",
			"edit",
			"change_task",
			"delete",
		]);
		const edit = rules.find((r) => r.id === "edit");
		expect(edit).toMatchObject({
			disabled: true,
			reason: ENTRY_COPY.stopToEdit,
		});
	});

	it("a pending row disables its writes", () => {
		const rules = entryActions(entry(), { mode: "mine", pending: true });
		expect(rules.filter((r) => r.disabled).map((r) => r.id)).toEqual([
			"edit",
			"change_task",
			"change_for",
			"delete",
		]);
	});
});

describe("entrySelection", () => {
	it("selects only open, finished rows of your own", () => {
		expect(entrySelection(entry(), "mine")).toEqual({
			selectable: true,
			reason: null,
		});
		expect(
			entrySelection(entry({ ended_at: null, duration_seconds: null }), "mine"),
		).toEqual({ selectable: false, reason: ENTRY_COPY.stopFirst });
		expect(
			entrySelection(
				entry({
					timesheet: sheet("submitted"),
					locked_reason: "sheet_submitted",
				}),
				"mine",
			),
		).toEqual({ selectable: false, reason: "Submitted. Withdraw to change." });
		expect(entrySelection(entry(), "review")).toEqual({
			selectable: false,
			reason: null,
		});
	});
});

describe("needs review", () => {
	it("joins at exactly 10 hours, or when flagged", () => {
		expect(NEEDS_REVIEW_SECONDS).toBe(36000);
		expect(needsReview(entry({ duration_seconds: 36000 }), NOW_MS)).toBe(true);
		expect(needsReview(entry({ duration_seconds: 35999 }), NOW_MS)).toBe(false);
		expect(
			needsReviewReason(entry({ flagged_reason: "auto_stopped_24h" }), NOW_MS),
		).toBe("auto_stopped_24h");
		expect(
			needsReviewReason(entry({ flagged_reason: "something_new" }), NOW_MS),
		).toBe("flagged");
	});

	it("a running timer joins at 10 hours of work", () => {
		const running = entry({
			ended_at: null,
			duration_seconds: null,
			started_at: new Date(NOW_MS - 10 * 3600_000).toISOString(),
		});
		expect(needsReview(running, NOW_MS)).toBe(true);
		expect(needsReview(running, NOW_MS - 60_000)).toBe(false);
		// Breaks are not work.
		expect(needsReview({ ...running, break_seconds: 600 }, NOW_MS)).toBe(false);
	});

	it("explains each entry and the group", () => {
		expect(needsReviewCopy(entry({ duration_seconds: 40000 }))).toBe(
			"Over 10 hours. Check the end time.",
		);
		expect(needsReviewCopy(entry({ flagged_reason: "auto_stopped_24h" }))).toBe(
			"Stopped automatically after 24 hours. Check the end time.",
		);
		expect(
			needsReviewCopy(
				entry({
					context_kind: "assignment",
					context_label_snapshot: "Acme Corp",
					flagged_reason: "stopped_by_assignment_end",
				}),
			),
		).toBe("Stopped when your agreement with Acme Corp ended.");
		expect(needsReviewCopy(entry())).toBeNull();

		expect(
			needsReviewCaption([entry({ duration_seconds: 40000 })], NOW_MS),
		).toBe("one entry ran over 10h");
		expect(
			needsReviewCaption(
				[
					entry({ id: "a", duration_seconds: 40000 }),
					entry({ id: "b", duration_seconds: 50000 }),
					entry({ id: "c", flagged_reason: "auto_stopped_24h" }),
				],
				NOW_MS,
			),
		).toBe("2 entries ran over 10h · one timer was stopped automatically");
	});
});

describe("groupEntries", () => {
	const morning = entry({ id: "a" });
	// Thu Oct 1, 17:00 UTC = Fri Oct 2, 01:00 in Manila.
	const lateNight = entry({
		id: "b",
		started_at: "2026-10-01T17:00:00.000Z",
		ended_at: "2026-10-01T18:00:00.000Z",
		duration_seconds: 3600,
	});
	const afternoon = entry({
		id: "c",
		started_at: "2026-10-01T05:00:00.000Z",
		ended_at: "2026-10-01T06:00:00.000Z",
		duration_seconds: 3600,
	});
	const long = entry({
		id: "d",
		started_at: "2026-09-30T00:00:00.000Z",
		ended_at: "2026-09-30T12:00:00.000Z",
		duration_seconds: 12 * 3600,
	});

	it("cuts days in the given timezone, newest first", () => {
		const groups = groupEntries([morning, lateNight, afternoon], {
			timeZone: TZ,
			nowMs: NOW_MS,
			now: NOW,
		});
		expect(groups.map((g) => [g.key, g.label])).toEqual([
			["2026-10-02", "Fri Oct 2"],
			["2026-10-01", "Thu Oct 1"],
		]);
		expect(groups[1].entries.map((e) => e.id)).toEqual(["c", "a"]);
	});

	it("reads chronologically with order 'oldest'", () => {
		const groups = groupEntries([morning, lateNight, afternoon], {
			timeZone: TZ,
			order: "oldest",
			nowMs: NOW_MS,
			now: NOW,
		});
		expect(groups.map((g) => g.key)).toEqual(["2026-10-01", "2026-10-02"]);
		expect(groups[0].entries.map((e) => e.id)).toEqual(["a", "c"]);
	});

	it("the same instants fall on other days in another timezone", () => {
		const groups = groupEntries([morning, lateNight], {
			timeZone: "UTC",
			nowMs: NOW_MS,
			now: NOW,
		});
		expect(groups.map((g) => g.key)).toEqual(["2026-10-01"]);
	});

	it("pulls Needs review rows out of their day, into a leading group", () => {
		const groups = groupEntries([morning, long], {
			timeZone: TZ,
			nowMs: NOW_MS,
			now: NOW,
		});
		expect(groups[0]).toMatchObject({
			key: NEEDS_REVIEW_GROUP_KEY,
			kind: "review",
			label: "Needs review (1)",
			caption: "one entry ran over 10h",
		});
		expect(groups[0].entries.map((e) => e.id)).toEqual(["d"]);
		expect(groups.slice(1).flatMap((g) => g.entries.map((e) => e.id))).toEqual([
			"a",
		]);
		// …unless the caller keeps them in place.
		expect(
			groupEntries([morning, long], {
				timeZone: TZ,
				nowMs: NOW_MS,
				pullNeedsReview: false,
			}).every((g) => g.kind === "day"),
		).toBe(true);
	});

	it("marks groups with a running entry", () => {
		const running = entry({
			id: "r",
			ended_at: null,
			duration_seconds: null,
			started_at: new Date(NOW_MS - 3600_000).toISOString(),
		});
		const groups = groupEntries([running, morning], {
			timeZone: TZ,
			nowMs: NOW_MS,
			now: NOW,
		});
		expect(groups.find((g) => g.entries.includes(running))?.running).toBe(true);
	});
});

describe("status and accent", () => {
	it("uses the sheet status, and primary while running", () => {
		expect(entryAccent(entry({ ended_at: null }))).toBe("running");
		expect(entryAccent(entry({ timesheet: sheet("submitted") }))).toBe(
			"submitted",
		);
		expect(entryAccent(entry({ timesheet: sheet("returned") }))).toBe(
			"returned",
		);
		expect(entryAccent(entry({ timesheet: sheet("approved") }))).toBe(
			"approved",
		);
		expect(entryAccent(entry({ timesheet: null }))).toBe("none");
		// Theme tokens, never hex.
		for (const cls of Object.values(ACCENT_CLASS)) {
			expect(cls).not.toMatch(/#|\[/);
		}
		expect(ACCENT_CLASS.approved).toBe("border-l-success");
		expect(ACCENT_CLASS.returned).toBe("border-l-warning");
	});

	it("says the status in words", () => {
		expect(entryStatusLabel(entry({ ended_at: null }))).toBe("Running");
		expect(
			entryStatusLabel(
				entry({ ended_at: null, paused_at: "2026-10-01T02:00:00.000Z" }),
			),
		).toBe("On break");
		expect(entryStatusLabel(entry({ timesheet: sheet("returned") }))).toBe(
			"Returned",
		);
		expect(entryStatusLabel(entry({ timesheet: null }))).toBe(
			"Not on a timesheet",
		);
	});

	it("builds the detail's sheet line", () => {
		expect(
			entrySheetLine(entry({ timesheet: sheet("submitted") }), {
				now: NOW,
				userTimezone: TZ,
			}),
		).toEqual({
			status: "submitted",
			text: "Submitted · Prodigitality Services Inc. Team · Sep 28–Oct 4",
			note: null,
		});
		const agreement = entry({
			context_kind: "assignment",
			timesheet: sheet("returned", {
				scope_label_snapshot: "Acme Corp",
				decision_note: "Split Thursday",
			}),
		});
		expect(
			entrySheetLine(agreement, { native: false, now: NOW, userTimezone: TZ }),
		).toEqual({
			status: "returned",
			text: "Returned · Acme Corp · agreement · Sep 28–Oct 4",
			note: "Split Thursday",
		});
		expect(
			entrySheetLine(agreement, { native: true, now: NOW, userTimezone: TZ })
				?.text,
		).toBe("Returned · Acme Corp · Sep 28–Oct 4");
		expect(entrySheetLine(entry({ timesheet: null }))).toBeNull();
	});
});

describe("entryAmount", () => {
	it("estimates from the rate before approval", () => {
		expect(entryAmount(entry(), NOW_MS)).toEqual({
			amount: 1575,
			currency: "PHP",
			final: false,
		});
		expect(amountRecord(entryAmount(entry(), NOW_MS))).toEqual({ PHP: 1575 });
	});

	it("reads amount_snapshot once approved", () => {
		expect(
			entryAmount(
				entry({ payable_seconds: 12600, amount_snapshot: 1500 }),
				NOW_MS,
			),
		).toEqual({ amount: 1500, currency: "PHP", final: true });
		// Fixed fee or client-governed time freezes without an amount.
		expect(
			entryAmount(
				entry({ payable_seconds: 12600, amount_snapshot: null }),
				NOW_MS,
			),
		).toBeNull();
	});

	it("shows nothing it can't price or may not show", () => {
		expect(
			entryAmount(entry({ rate_type_snapshot: "fixed" }), NOW_MS),
		).toBeNull();
		expect(entryAmount(entry({ rate_snapshot: 0 }), NOW_MS)).toBeNull();
		expect(entryAmount(entry({ cost: "hidden" }), NOW_MS)).toBeNull();
		expect(amountRecord(null)).toBeNull();
	});
});

describe("entryBadgeKinds", () => {
	it("Paid on rows and the detail, web and native", () => {
		const paid = entry({ payout_id: "po1", locked_reason: "paid" });
		expect(entryBadgeKinds(paid, { native: false })).toEqual(["paid"]);
		expect(entryBadgeKinds(paid, { native: true })).toEqual(["paid"]);
	});

	it("Billed on the web only, for cost viewers", () => {
		const billed = entry({ locked_reason: "billed" });
		expect(entryBadgeKinds(billed, { native: false })).toEqual(["billed"]);
		expect(entryBadgeKinds(billed, { native: true })).toEqual([]);
		expect(
			entryBadgeKinds({ ...billed, cost: "hidden" }, { native: false }),
		).toEqual([]);
	});

	it("legacy markers in the detail only", () => {
		const outside = entry({
			legacy_status: "paid_outside",
			locked_reason: "paid",
		});
		const rejected = entry({
			legacy_status: "rejected",
			locked_reason: "legacy",
		});
		expect(entryBadgeKinds(outside, { native: false })).toEqual([]);
		expect(entryBadgeKinds(rejected, { native: false })).toEqual([]);
		expect(
			entryBadgeKinds(outside, { native: false, variant: "detail" }),
		).toEqual(["paid_outside"]);
		expect(
			entryBadgeKinds(rejected, { native: true, variant: "detail" }),
		).toEqual(["legacy_rejected"]);
	});
});
