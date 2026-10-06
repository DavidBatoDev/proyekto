/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));
vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import { timeKeys } from "@/queries/time";
import { TimeApiError, timeService } from "@/services/time.service";
import type {
	ResolvedTimePolicy,
	TimeEntryView,
	UpdatedEntry,
} from "@/services/time.types";
import {
	buildEntryPatch,
	checkDraft,
	draftFromEntry,
	durationPreview,
	EDIT_ENTRY_COPY,
	EditEntryModal,
	entryLockCopy,
	fromWallClock,
	timeZoneHint,
	toWallClock,
} from "./EditEntryModal";

const TZ = "Asia/Manila";

function entry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return {
		id: "e1",
		context_kind: "team",
		context_ref: "t1",
		context_label_snapshot: "Prodigitality Services Inc. Team",
		timesheet_id: "s1",
		work_item: "task",
		// 09:00–12:30 in Manila (UTC+8).
		started_at: "2026-10-05T01:00:00.000Z",
		ended_at: "2026-10-05T04:30:00.000Z",
		paused_at: null,
		duration_seconds: 12_600,
		break_seconds: 0,
		break_minutes: 0,
		payable_seconds: null,
		source: "manual",
		work_type_snapshot: "real_work",
		legacy_status: null,
		payout_id: null,
		flagged_reason: null,
		project_id: "p1",
		team_id: "t1",
		workspace_id: null,
		engagement_assignment_id: null,
		created_at: "2026-10-05T04:30:00.000Z",
		updated_at: "2026-10-05T04:30:01.123456+00:00",
		timesheet: {
			id: "s1",
			status: "open",
			period_start: "2026-10-05",
			period_end: "2026-10-11",
			decision_kind: null,
			decided_by: null,
			decided_at: null,
			decision_note: null,
			scope_label_snapshot: "Prodigitality Services Inc. Team",
		},
		locked_reason: null,
		identity: "visible",
		member_user_id: "u1",
		member_display_name_snapshot: "Maria",
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
		cost: "visible",
		...over,
	};
}

function policy(over: Partial<ResolvedTimePolicy> = {}): ResolvedTimePolicy {
	return {
		tracking_enabled: true,
		period_kind: "weekly",
		week_start: 1,
		timezone: TZ,
		period_anchor: null,
		approval_required: true,
		approver_scope: "team",
		allow_manual_entries: true,
		retroactive_days: null,
		rounding_minutes: 0,
		weekly_limit_minutes: null,
		reminder_days: 1,
		hidden_presets: [],
		tracking_mode: null,
		sources: {},
		plan: { time_tracking: true, time_team_rules: true },
		policy_workspace_id: "w1",
		team_override_applied: false,
		member: null,
		client_hours_detail_level: null,
		...over,
	};
}

function renderModal(
	props: Partial<Parameters<typeof EditEntryModal>[0]> = {},
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
	const onClose = vi.fn();
	const onSaved = vi.fn();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	const utils = render(
		<EditEntryModal
			open
			entry={entry()}
			timeZone={TZ}
			onClose={onClose}
			onSaved={onSaved}
			{...props}
		/>,
		{ wrapper },
	);
	return { ...utils, onClose, onSaved, client };
}

function commitTime(label: string, value: string) {
	const input = screen.getByLabelText(label) as HTMLInputElement;
	fireEvent.focus(input);
	fireEvent.change(input, { target: { value } });
	fireEvent.keyDown(input, { key: "Enter" });
}

beforeEach(() => {
	vi.spyOn(timeService, "getProjectPolicy").mockRejectedValue(
		new TimeApiError({ status: 404, code: "TIME_NOT_FOUND", message: "x" }),
	);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	for (const fn of Object.values(toast)) fn.mockReset();
});

describe("wall clock helpers", () => {
	it("shows an instant in the given timezone and reads it back", () => {
		expect(toWallClock("2026-10-05T01:00:00.000Z", TZ)).toBe(
			"2026-10-05T09:00",
		);
		expect(fromWallClock("2026-10-05T09:00", TZ)).toBe(
			"2026-10-05T01:00:00.000Z",
		);
		// After the US fall-back (Nov 1 2026), New York is UTC−5.
		expect(fromWallClock("2026-11-02T12:00", "America/New_York")).toBe(
			"2026-11-02T17:00:00.000Z",
		);
	});

	it("treats unreadable values as empty", () => {
		expect(toWallClock(null, TZ)).toBe("");
		expect(toWallClock("nope", TZ)).toBe("");
		expect(fromWallClock("2026-10-05", TZ)).toBeNull();
		expect(fromWallClock("", TZ)).toBeNull();
	});

	it("names the timezone only when it isn't the device's", () => {
		expect(timeZoneHint(TZ, TZ)).toBeNull();
		expect(timeZoneHint("America/New_York", TZ)).toBe(
			"Times are in America/New_York.",
		);
	});
});

describe("buildEntryPatch", () => {
	it("is null when nothing changed", () => {
		const e = entry();
		expect(buildEntryPatch(e, draftFromEntry(e, TZ), TZ)).toBeNull();
	});

	it("sends only what changed, with the opened revision", () => {
		const e = entry();
		const draft = { ...draftFromEntry(e, TZ), end: "2026-10-05T13:00" };
		expect(buildEntryPatch(e, draft, TZ)).toEqual({
			ended_at: "2026-10-05T05:00:00.000Z",
			expected_updated_at: e.updated_at,
		});
		expect(
			buildEntryPatch(e, { ...draftFromEntry(e, TZ), note: "  Pairing " }, TZ),
		).toEqual({ note: "Pairing", expected_updated_at: e.updated_at });
		expect(
			buildEntryPatch(e, { ...draftFromEntry(e, TZ), breakMinutes: "15" }, TZ),
		).toEqual({ break_seconds: 900, expected_updated_at: e.updated_at });
	});

	it("clears a note with null", () => {
		const e = entry({ note: "Old" });
		expect(
			buildEntryPatch(e, { ...draftFromEntry(e, TZ), note: "  " }, TZ),
		).toEqual({ note: null, expected_updated_at: e.updated_at });
	});

	it("keeps an untouched start's exact seconds", () => {
		const e = entry({ started_at: "2026-10-05T01:00:37.000Z" });
		const check = checkDraft(e, draftFromEntry(e, TZ), TZ);
		expect(check.startIso).toBe("2026-10-05T01:00:37.000Z");
		expect(check.error).toBeNull();
	});

	it("refuses an end before the start and a break as long as the block", () => {
		const e = entry();
		const backwards = { ...draftFromEntry(e, TZ), end: "2026-10-05T08:00" };
		expect(checkDraft(e, backwards, TZ).error).toBe(
			EDIT_ENTRY_COPY.rangeInvalid,
		);
		expect(buildEntryPatch(e, backwards, TZ)).toBeNull();
		const longBreak = { ...draftFromEntry(e, TZ), breakMinutes: "210" };
		expect(checkDraft(e, longBreak, TZ).error).toBe(
			EDIT_ENTRY_COPY.breakTooLong,
		);
		const badBreak = { ...draftFromEntry(e, TZ), breakMinutes: "1.5" };
		expect(checkDraft(e, badBreak, TZ).error).toBe(
			EDIT_ENTRY_COPY.breakInvalid,
		);
		const noEnd = { ...draftFromEntry(e, TZ), end: "" };
		expect(checkDraft(e, noEnd, TZ).error).toBe(EDIT_ENTRY_COPY.endRequired);
	});

	it("lets a running timer keep an empty end and never sends its break", () => {
		const e = entry({
			ended_at: null,
			duration_seconds: null,
			break_seconds: 600,
		});
		const draft = { ...draftFromEntry(e, TZ), start: "2026-10-05T08:30" };
		expect(draft.end).toBe("");
		expect(buildEntryPatch(e, draft, TZ)).toEqual({
			started_at: "2026-10-05T00:30:00.000Z",
			expected_updated_at: e.updated_at,
		});
		const stopped = { ...draft, end: "2026-10-05T10:00", breakMinutes: "0" };
		expect(buildEntryPatch(e, stopped, TZ)).toEqual({
			started_at: "2026-10-05T00:30:00.000Z",
			ended_at: "2026-10-05T02:00:00.000Z",
			expected_updated_at: e.updated_at,
		});
	});

	it("previews the net duration", () => {
		const e = entry();
		expect(durationPreview(checkDraft(e, draftFromEntry(e, TZ), TZ))).toBe(
			"3h 30m logged",
		);
		const withBreak = { ...draftFromEntry(e, TZ), breakMinutes: "15" };
		expect(durationPreview(checkDraft(e, withBreak, TZ))).toBe(
			"3h 30m minus 15m break = 3h 15m logged",
		);
	});
});

describe("entryLockCopy", () => {
	it("says why each lock holds", () => {
		const of = (over: Partial<TimeEntryView>) =>
			entryLockCopy(entry(over), { timeZone: TZ, native: false });
		expect(of({})).toBeNull();
		expect(of({ locked_reason: "paid" })).toBe(
			"This time has already been paid, so it can't change.",
		);
		expect(of({ locked_reason: "paid", legacy_status: "paid_outside" })).toBe(
			"Paid outside Proyekto, so it can't change.",
		);
		expect(of({ locked_reason: "billed" })).toBe(
			"This time is already being billed, so it can't change.",
		);
		expect(of({ locked_reason: "legacy" })).toBe(
			"Not approved (legacy), so it can't change.",
		);
		expect(of({ locked_reason: "frozen" })).toBe(
			"This time is approved, so it can't change.",
		);
		expect(of({ locked_reason: "sheet_submitted" })).toBe(
			"Submitted. Withdraw to change.",
		);
		const approved = entry({
			locked_reason: "sheet_approved",
			timesheet: {
				...entry().timesheet!,
				status: "approved",
				decided_at: "2026-10-06T02:00:00.000Z",
			},
		});
		expect(entryLockCopy(approved, { timeZone: TZ, native: false })).toMatch(
			/^Approved Oct 6(, 2026)?\. Ask to reopen to change\.$/,
		);
	});
});

describe("EditEntryModal", () => {
	it("shows the entry's times in the view's timezone", () => {
		renderModal();
		expect(
			(screen.getByLabelText("Start time") as HTMLInputElement).value,
		).toBe("9:00 AM");
		expect((screen.getByLabelText("End time") as HTMLInputElement).value).toBe(
			"12:30 PM",
		);
		expect(screen.getByText("Fix login bug")).toBeTruthy();
		expect(screen.getByText("3h 30m logged")).toBeTruthy();
	});

	it("saves only the changed note with expected_updated_at", async () => {
		const saved: UpdatedEntry = { ...entry({ note: "Pairing" }), warnings: [] };
		const update = vi
			.spyOn(timeService, "updateEntry")
			.mockResolvedValue(saved);
		const { onClose, onSaved, client } = renderModal();
		const save = screen.getByRole("button", { name: /Save changes/ });
		expect((save as HTMLButtonElement).disabled).toBe(true);

		fireEvent.change(screen.getByPlaceholderText("What did you work on?"), {
			target: { value: "Pairing" },
		});
		fireEvent.click(save);

		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(update).toHaveBeenCalledWith("e1", {
			note: "Pairing",
			expected_updated_at: "2026-10-05T04:30:01.123456+00:00",
		});
		expect(toast.success).toHaveBeenCalledWith("Time entry updated.");
		expect(onSaved).toHaveBeenCalledWith(saved);
		expect(
			(client.getQueryData(timeKeys.entry("e1")) as TimeEntryView).note,
		).toBe("Pairing");
	});

	it("saves a new end typed in the time field", async () => {
		const update = vi
			.spyOn(timeService, "updateEntry")
			.mockResolvedValue({ ...entry(), warnings: [] });
		const { onClose } = renderModal();
		commitTime("End time", "1:00 PM");
		expect(screen.getByText("4h logged")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(update).toHaveBeenCalledWith("e1", {
			ended_at: "2026-10-05T05:00:00.000Z",
			expected_updated_at: "2026-10-05T04:30:01.123456+00:00",
		});
	});

	it("shows a weekly-limit warning from the PATCH like create's", async () => {
		vi.spyOn(timeService, "updateEntry").mockResolvedValue({
			...entry(),
			warnings: [
				{
					code: "POLICY_WEEKLY_LIMIT",
					limit_minutes: 2400,
					logged_minutes: 2460,
					label: "Prodigitality",
				},
			],
		});
		const { onClose } = renderModal();
		commitTime("End time", "1:00 PM");
		fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(toast.warning).toHaveBeenCalledWith(
			"Prodigitality has a 40h weekly limit. You've logged 41h this week.",
		);
	});

	it("on STALE_REVISION offers Reload, which resets to the latest copy", async () => {
		const update = vi
			.spyOn(timeService, "updateEntry")
			.mockRejectedValueOnce(
				new TimeApiError({
					status: 409,
					code: "STALE_REVISION",
					message: "This entry changed. Reload to see the latest version.",
					extras: { entry_id: "e1", updated_at: "2026-10-05T06:00:00Z" },
				}),
			)
			.mockResolvedValueOnce({ ...entry(), warnings: [] });
		const fresh = entry({
			note: "From my phone",
			updated_at: "2026-10-05T06:00:00.000Z",
		});
		const get = vi.spyOn(timeService, "getEntry").mockResolvedValue(fresh);
		const { onClose } = renderModal();

		fireEvent.change(screen.getByPlaceholderText("What did you work on?"), {
			target: { value: "Mine" },
		});
		fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain(
			"This entry changed. Reload to see the latest version.",
		);
		expect(onClose).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Reload" }));
		await waitFor(() =>
			expect(
				(
					screen.getByPlaceholderText(
						"What did you work on?",
					) as HTMLTextAreaElement
				).value,
			).toBe("From my phone"),
		);
		expect(get).toHaveBeenCalledWith("e1");
		expect(screen.queryByRole("alert")).toBeNull();

		fireEvent.change(screen.getByPlaceholderText("What did you work on?"), {
			target: { value: "Merged" },
		});
		fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(update).toHaveBeenLastCalledWith("e1", {
			note: "Merged",
			expected_updated_at: "2026-10-05T06:00:00.000Z",
		});
	});

	it("explains a lock the server raises", async () => {
		vi.spyOn(timeService, "updateEntry").mockRejectedValue(
			new TimeApiError({
				status: 409,
				code: "TIMESHEET_LOCKED",
				message: "This entry is on a submitted or approved timesheet.",
				extras: { reason: "entry", lock: "sheet_submitted", entry_id: "e1" },
			}),
		);
		renderModal();
		fireEvent.change(screen.getByPlaceholderText("What did you work on?"), {
			target: { value: "x" },
		});
		fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain(
			"This entry is on a submitted or approved timesheet.",
		);
	});

	it("opens a locked entry read-only with its reason", () => {
		renderModal({
			entry: entry({
				locked_reason: "sheet_submitted",
				timesheet: { ...entry().timesheet!, status: "submitted" },
			}),
		});
		expect(
			screen.getAllByText("Submitted. Withdraw to change.").length,
		).toBeGreaterThan(0);
		expect(screen.queryByRole("button", { name: /Save changes/ })).toBeNull();
		// The header ✕ and the footer's Close.
		expect(screen.getAllByRole("button", { name: "Close" }).length).toBe(2);
		expect(
			(screen.getByLabelText("Start time") as HTMLInputElement).disabled,
		).toBe(true);
	});

	it("keeps a running timer's end empty and hides its break", () => {
		renderModal({
			entry: entry({ ended_at: null, duration_seconds: null }),
		});
		expect((screen.getByLabelText("End time") as HTMLInputElement).value).toBe(
			"",
		);
		expect(screen.queryByText(EDIT_ENTRY_COPY.breakMinutes)).toBeNull();
		expect(screen.getByText(EDIT_ENTRY_COPY.runningEndHint)).toBeTruthy();
	});

	it("hands Change For to the page", () => {
		const onChangeFor = vi.fn();
		renderModal({ onChangeFor });
		fireEvent.click(screen.getByRole("button", { name: "Change For…" }));
		expect(onChangeFor).toHaveBeenCalledWith(
			expect.objectContaining({ id: "e1" }),
		);
	});

	it("names the retroactive window when the policy has one", async () => {
		vi.spyOn(timeService, "getProjectPolicy").mockResolvedValue(
			policy({ retroactive_days: 7 }),
		);
		renderModal();
		expect(
			await screen.findByText(
				"Prodigitality Services Inc. Team accepts time up to 7 days back.",
			),
		).toBeTruthy();
		expect(timeService.getProjectPolicy).toHaveBeenCalledWith("p1", {
			kind: "team",
			id: "t1",
		});
	});
});
