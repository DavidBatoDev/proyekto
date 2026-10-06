/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));
vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import { TimeApiError, timeService } from "@/services/time.service";
import type {
	LoggingForResult,
	LoggingOption,
	TimeEntryView,
	TimesheetSummary,
} from "@/services/time.types";
import {
	CHANGE_FOR_COPY,
	ChangeForDialog,
	changeForErrorCopy,
	changeForRowState,
	sharedForResult,
	targetSheetFor,
} from "./ChangeForDialog";

const TZ = "Asia/Manila";

function entry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return {
		id: "e1",
		context_kind: "team",
		context_ref: "t1",
		context_label_snapshot: "Design",
		timesheet_id: "s-team",
		work_item: "task",
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
		updated_at: "2026-10-05T04:30:00.000Z",
		timesheet: {
			id: "s-team",
			status: "open",
			period_start: "2026-10-05",
			period_end: "2026-10-11",
			decision_kind: null,
			decided_by: null,
			decided_at: null,
			decision_note: null,
			scope_label_snapshot: "Design",
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
		cost: "hidden",
		...over,
	};
}

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
		sheet_scope:
			kind === "personal"
				? null
				: kind === "assignment"
					? { kind: "engagement", ref: "eng-1" }
					: { kind: kind === "team" ? "team" : "workspace", ref: id ?? "" },
		rate_source: kind === "assignment" ? "engagement_cost" : "none",
		workspace_tag: null,
		approver_hint: kind === "assignment" ? "hirer" : "workspace",
		...over,
	};
}

const team = option("team", "t1", "Design");
const workspace = option("workspace", "w1", "Acme");
const personal = option("personal", null, "Just me");
const agreement = option("assignment", "a1", "Acme Corp");

function result(options: LoggingOption[]): LoggingForResult {
	return {
		options,
		selected: options.length === 1 ? options[0] : null,
		prefill: null,
		unavailable: [],
	};
}

function sheet(over: Partial<TimesheetSummary> = {}): TimesheetSummary {
	return {
		id: "s-ws",
		member_user_id: "u1",
		member_display_name_snapshot: "Maria",
		scope_kind: "workspace",
		scope_ref: "w1",
		team_id: null,
		workspace_id: "w1",
		engagement_id: null,
		scope_label_snapshot: "Acme",
		policy_workspace_id: "w1",
		period_kind: "weekly",
		period_start: "2026-10-05",
		period_end: "2026-10-11",
		timezone: TZ,
		week_start: 1,
		status: "open",
		approver_scope: "workspace",
		revision: 3,
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
		created_at: "2026-10-05T00:00:00Z",
		updated_at: "2026-10-05T00:00:00Z",
		entry_count: 1,
		running_count: 0,
		logged_seconds: 3600,
		...over,
	};
}

function renderDialog(
	props: Partial<Parameters<typeof ChangeForDialog>[0]> & {
		entries: TimeEntryView[];
	},
) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const onClose = vi.fn();
	const onDone = vi.fn();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	render(
		<ChangeForDialog
			open
			timeZone={TZ}
			onClose={onClose}
			onDone={onDone}
			{...props}
		/>,
		{ wrapper },
	);
	return { client, onClose, onDone };
}

function picker() {
	return within(
		screen.getByRole("group", { name: "Choose who this time is for" }),
	);
}

async function pick(label: string) {
	const text = await waitFor(() => picker().getByText(label));
	const input = text.closest("label")?.querySelector("input");
	if (!input) throw new Error(`no radio for ${label}`);
	fireEvent.click(input);
}

function rowStatus(entryId: string): string | null {
	return (
		document
			.querySelector(`[data-entry-id="${entryId}"]`)
			?.getAttribute("data-row-status") ?? null
	);
}

function rowText(entryId: string): string {
	return (
		document.querySelector(`[data-entry-id="${entryId}"]`)?.textContent ?? ""
	);
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	for (const fn of Object.values(toast)) fn.mockReset();
});

describe("sharedForResult", () => {
	it("keeps one project's answer as is", () => {
		const one = result([team, workspace]);
		expect(sharedForResult([one])).toBe(one);
	});

	it("keeps only the choices every project offers", () => {
		const shared = sharedForResult([
			result([team, workspace, personal]),
			result([workspace, personal]),
		]);
		expect(shared?.options.map((o) => o.label)).toEqual(["Acme", "Just me"]);
		expect(shared?.unavailable).toEqual([]);
	});

	it("waits until every project has answered", () => {
		expect(sharedForResult([result([team]), undefined])).toBeNull();
		expect(sharedForResult([])).toBeNull();
	});
});

describe("targetSheetFor", () => {
	it("finds the sheet of the target scope that holds the entry's day", () => {
		const hit = sheet();
		const other = sheet({
			id: "s2",
			period_start: "2026-09-28",
			period_end: "2026-10-04",
		});
		expect(targetSheetFor(entry(), workspace, [other, hit])).toBe(hit);
		expect(targetSheetFor(entry(), personal, [hit])).toBeNull();
		expect(targetSheetFor(entry(), team, [hit])).toBeNull();
	});

	it("reads the day in the sheet's own timezone", () => {
		// 2026-10-04T17:00Z is Oct 5, 01:00 in Manila.
		const late = entry({ started_at: "2026-10-04T17:00:00.000Z" });
		expect(targetSheetFor(late, workspace, [sheet()])?.id).toBe("s-ws");
		expect(
			targetSheetFor(late, workspace, [sheet({ timezone: "UTC" })]),
		).toBeNull();
	});
});

describe("changeForRowState", () => {
	const ctx = { timeZone: TZ, native: false };

	it("blocks rows that can't move, in order", () => {
		expect(
			changeForRowState(entry({ project_id: null }), workspace, ctx),
		).toEqual({ status: "blocked", reason: CHANGE_FOR_COPY.noProject });
		expect(
			changeForRowState(entry({ locked_reason: "billed" }), workspace, ctx)
				.reason,
		).toBe("This time is already being billed, so it can't change.");
		expect(
			changeForRowState(
				entry({ timesheet: { ...entry().timesheet!, status: "submitted" } }),
				workspace,
				ctx,
			).reason,
		).toBe("Submitted. Withdraw to change.");
	});

	it("waits for a target, then skips rows already on it", () => {
		expect(changeForRowState(entry(), null, ctx).status).toBe("pending");
		expect(changeForRowState(entry(), team, ctx)).toEqual({
			status: "same",
			reason: "Already for Design.",
		});
		expect(
			changeForRowState(
				entry({ context_kind: "personal", context_ref: null }),
				personal,
				ctx,
			).reason,
		).toBe("Already for Just me.");
	});

	it("blocks a row whose target sheet is submitted or approved (L2)", () => {
		expect(
			changeForRowState(entry(), workspace, {
				...ctx,
				timesheets: [sheet({ status: "submitted" })],
			}),
		).toEqual({
			status: "blocked",
			reason:
				"This week's Acme timesheet is submitted. Withdraw it to add time.",
		});
		expect(
			changeForRowState(entry(), workspace, {
				...ctx,
				timesheets: [sheet({ status: "returned" })],
			}).status,
		).toBe("eligible");
	});

	it("checks an agreement's dates (L58)", () => {
		expect(
			changeForRowState(entry(), agreement, { ...ctx, checking: true }).status,
		).toBe("checking");
		expect(
			changeForRowState(entry(), agreement, { ...ctx, notCovered: true }),
		).toEqual({
			status: "blocked",
			reason: "Logged before this agreement started.",
		});
		expect(changeForRowState(entry(), agreement, ctx).status).toBe("eligible");
	});
});

describe("changeForErrorCopy", () => {
	it("reads the agreement refusal as the L58 sentence", () => {
		const err = new TimeApiError({
			status: 422,
			code: "LOGGING_FOR_INVALID",
			message:
				"This time is from before the agreement, so it can't move onto it.",
		});
		expect(changeForErrorCopy(err, agreement, { native: false })).toEqual({
			message: "Logged before this agreement started.",
			retryable: false,
		});
		const generic = new TimeApiError({
			status: 422,
			code: "LOGGING_FOR_INVALID",
			message: "x",
		});
		expect(
			changeForErrorCopy(generic, workspace, { native: false }).message,
		).toBe(CHANGE_FOR_COPY.notAvailableOnDay);
	});

	it("names the target sheet on a period lock and retries only transient failures", () => {
		const locked = new TimeApiError({
			status: 409,
			code: "TIMESHEET_LOCKED",
			message: "x",
			extras: {
				reason: "period",
				timesheet_id: "s",
				sheet_status: "submitted",
			},
		});
		expect(changeForErrorCopy(locked, workspace, { native: false })).toEqual({
			message:
				"This week's Acme timesheet is submitted. Withdraw it to add time.",
			retryable: false,
		});
		const offline = new TimeApiError({
			status: 0,
			code: "NETWORK_ERROR",
			message: "x",
		});
		expect(
			changeForErrorCopy(offline, workspace, { native: false }).retryable,
		).toBe(true);
	});
});

describe("ChangeForDialog", () => {
	it("moves the rows that can move and skips the rest", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			result([team, workspace]),
		);
		const update = vi
			.spyOn(timeService, "updateEntry")
			.mockImplementation(async (id) => ({ ...entry({ id }), warnings: [] }));
		const rows = [
			entry({ id: "e1" }),
			entry({
				id: "e2",
				context_kind: "workspace",
				context_ref: "w1",
				context_label_snapshot: "Acme",
			}),
			entry({
				id: "e3",
				locked_reason: "sheet_submitted",
				timesheet: { ...entry().timesheet!, status: "submitted" },
			}),
		];
		const { onClose, onDone, client } = renderDialog({ entries: rows });
		const invalidate = vi.spyOn(client, "invalidateQueries");

		expect(screen.getByText("3 entries selected")).toBeTruthy();
		await pick("Acme");
		expect(
			screen.getByText("Rates are re-estimated for the new choice."),
		).toBeTruthy();

		expect(rowStatus("e1")).toBe("eligible");
		expect(rowStatus("e2")).toBe("same");
		expect(rowText("e2")).toContain("Already for Acme.");
		expect(rowStatus("e3")).toBe("blocked");

		fireEvent.click(screen.getByRole("button", { name: "Change 1 entry" }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(update).toHaveBeenCalledTimes(1);
		expect(update).toHaveBeenCalledWith("e1", {
			logging_for: { kind: "workspace", id: "w1" },
			expected_updated_at: "2026-10-05T04:30:00.000Z",
		});
		expect(toast.success).toHaveBeenCalledWith("1 entry is now for Acme.");
		expect(onDone).toHaveBeenCalledWith({
			target: { kind: "workspace", id: "w1" },
			changed: ["e1"],
			failed: [],
			skipped: ["e2", "e3"],
		});
		expect(invalidate).toHaveBeenCalledWith({
			queryKey: ["time", "me", "entries"],
		});
	});

	it("a move past a weekly limit warns once, never blocks (A6)", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			result([team, workspace]),
		);
		vi.spyOn(timeService, "updateEntry").mockImplementation(async (id) => ({
			...entry({ id }),
			warnings: [
				{
					code: "POLICY_WEEKLY_LIMIT",
					limit_minutes: 2400,
					logged_minutes: 2460,
					label: "Acme",
				},
			],
		}));
		const { onClose } = renderDialog({
			entries: [entry({ id: "e1" }), entry({ id: "e2" })],
		});
		await pick("Acme");
		fireEvent.click(screen.getByRole("button", { name: "Change 2 entries" }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(toast.success).toHaveBeenCalledWith("2 entries are now for Acme.");
		expect(toast.warning).toHaveBeenCalledTimes(1);
		// The sentence is lib/timeErrors' (W0-B), whatever its exact wording.
		expect(toast.warning).toHaveBeenCalledWith(
			expect.stringMatching(/Acme.*40h.*41h this week\./),
		);
	});

	it("reports each row's result and stays open when one fails", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			result([team, workspace]),
		);
		vi.spyOn(timeService, "updateEntry").mockImplementation(async (id) => {
			if (id === "e2") {
				throw new TimeApiError({
					status: 409,
					code: "TIMESHEET_LOCKED",
					message: "x",
					extras: {
						reason: "period",
						timesheet_id: "s-ws",
						sheet_status: "submitted",
					},
				});
			}
			return { ...entry({ id }), warnings: [] };
		});
		const { onClose, onDone } = renderDialog({
			entries: [entry({ id: "e1" }), entry({ id: "e2" })],
		});
		await pick("Acme");
		fireEvent.click(screen.getByRole("button", { name: "Change 2 entries" }));

		await waitFor(() => expect(rowStatus("e2")).toBe("failed"));
		expect(rowStatus("e1")).toBe("done");
		expect(rowText("e2")).toContain(
			"This week's Acme timesheet is submitted. Withdraw it to add time.",
		);
		expect(onClose).not.toHaveBeenCalled();
		expect(toast.success).not.toHaveBeenCalled();
		// A lock isn't transient: no Try again.
		expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();

		fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
		expect(onDone).toHaveBeenCalledWith({
			target: { kind: "workspace", id: "w1" },
			changed: ["e1"],
			failed: ["e2"],
			skipped: [],
		});
		expect(onClose).toHaveBeenCalled();
	});

	it("tries a transient failure again, only for that row", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			result([team, workspace]),
		);
		const update = vi
			.spyOn(timeService, "updateEntry")
			.mockImplementationOnce(async (id) => ({
				...entry({ id }),
				warnings: [],
			}))
			.mockRejectedValueOnce(
				new TimeApiError({ status: 0, code: "NETWORK_ERROR", message: "x" }),
			)
			.mockImplementationOnce(async (id) => ({
				...entry({ id }),
				warnings: [],
			}));
		const { onClose } = renderDialog({
			entries: [entry({ id: "e1" }), entry({ id: "e2" })],
		});
		await pick("Acme");
		fireEvent.click(screen.getByRole("button", { name: "Change 2 entries" }));
		const retry = await screen.findByRole("button", { name: /Try again/ });
		fireEvent.click(retry);
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(update.mock.calls.map(([id]) => id)).toEqual(["e1", "e2", "e2"]);
		expect(toast.success).toHaveBeenCalledWith("2 entries are now for Acme.");
	});

	it("re-reads a stale row once and moves it on the fresh revision", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			result([team, workspace]),
		);
		const update = vi
			.spyOn(timeService, "updateEntry")
			.mockRejectedValueOnce(
				new TimeApiError({
					status: 409,
					code: "STALE_REVISION",
					message: "x",
					extras: { entry_id: "e1" },
				}),
			)
			.mockImplementationOnce(async (id) => ({
				...entry({ id }),
				warnings: [],
			}));
		vi.spyOn(timeService, "getEntry").mockResolvedValue(
			entry({ updated_at: "2026-10-05T09:00:00.000Z" }),
		);
		const { onClose } = renderDialog({ entries: [entry()] });
		await pick("Acme");
		fireEvent.click(screen.getByRole("button", { name: "Change 1 entry" }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(update).toHaveBeenLastCalledWith("e1", {
			logging_for: { kind: "workspace", id: "w1" },
			expected_updated_at: "2026-10-05T09:00:00.000Z",
		});
	});

	it("disables rows from before an agreement (L58)", async () => {
		const early = entry({
			id: "early",
			started_at: "2026-09-10T01:00:00.000Z",
		});
		const late = entry({ id: "late" });
		vi.spyOn(timeService, "getLoggingFor").mockImplementation(
			async (_projectId, options) => {
				if (!options?.at) return result([team, agreement]);
				return options.at === early.started_at
					? result([team])
					: result([team, agreement]);
			},
		);
		const update = vi
			.spyOn(timeService, "updateEntry")
			.mockImplementation(async (id) => ({ ...entry({ id }), warnings: [] }));
		const { onClose } = renderDialog({ entries: [early, late] });
		await pick("Acme Corp");

		await waitFor(() => expect(rowStatus("early")).toBe("blocked"));
		expect(rowText("early")).toContain("Logged before this agreement started.");
		expect(rowStatus("late")).toBe("eligible");
		expect(timeService.getLoggingFor).toHaveBeenCalledWith("p1", {
			at: early.started_at,
		});

		fireEvent.click(screen.getByRole("button", { name: "Change 1 entry" }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(update).toHaveBeenCalledTimes(1);
		expect(update).toHaveBeenCalledWith("late", {
			logging_for: { kind: "assignment", id: "a1" },
			expected_updated_at: late.updated_at,
		});
	});

	it("blocks rows whose target sheet is already submitted", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			result([team, workspace]),
		);
		renderDialog({
			entries: [entry()],
			timesheets: [sheet({ status: "approved" })],
		});
		await pick("Acme");
		expect(rowStatus("e1")).toBe("blocked");
		expect(rowText("e1")).toContain(
			"This week's Acme timesheet is approved, so its time can't change.",
		);
		expect(
			(
				screen.getByRole("button", {
					name: "Change 0 entries",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("offers only the choices every selected project shares", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockImplementation(
			async (projectId) =>
				projectId === "p1"
					? result([team, workspace, personal])
					: result([workspace, personal]),
		);
		renderDialog({
			entries: [entry({ id: "e1" }), entry({ id: "e2", project_id: "p2" })],
		});
		await waitFor(() => expect(picker().getByText("Acme")).toBeTruthy());
		expect(picker().getByText("Just me")).toBeTruthy();
		expect(picker().queryByText("Design")).toBeNull();
	});

	it("says so when the projects share no choice", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockImplementation(
			async (projectId) =>
				projectId === "p1" ? result([team]) : result([agreement]),
		);
		renderDialog({
			entries: [entry({ id: "e1" }), entry({ id: "e2", project_id: "p2" })],
		});
		expect(
			await screen.findByText(CHANGE_FOR_COPY.noSharedOptions),
		).toBeTruthy();
	});
});
