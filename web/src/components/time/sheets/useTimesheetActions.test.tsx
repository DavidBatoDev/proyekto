/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeApiError, timeService } from "@/services/time.service";
import type {
	ApprovalRow,
	TimesheetRow,
	TimesheetSummary,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));

import {
	describeSheetFailure,
	sheetPersonName,
	sheetSuccessToast,
	useTimesheetActions,
} from "./useTimesheetActions";

const MEMBER = "member-1";
const DECIDER = "decider-1";

function sheet(over: Partial<TimesheetSummary> = {}): TimesheetSummary {
	return {
		id: "s1",
		member_user_id: MEMBER,
		member_display_name_snapshot: "Maria Santos",
		scope_kind: "team",
		scope_ref: "t1",
		team_id: "t1",
		workspace_id: "w1",
		engagement_id: null,
		scope_label_snapshot: "Prodigitality Services Inc. Team",
		policy_workspace_id: "w1",
		period_kind: "weekly",
		period_start: "2026-09-21",
		period_end: "2026-09-27",
		timezone: "Asia/Manila",
		week_start: 1,
		status: "open",
		approver_scope: null,
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
		created_at: "2026-09-21T01:00:00.000Z",
		updated_at: "2026-09-21T01:00:00.000Z",
		entry_count: 4,
		running_count: 0,
		logged_seconds: 137_700,
		...over,
	};
}

function row(over: Partial<TimesheetRow> = {}): TimesheetRow {
	const { entry_count, running_count, logged_seconds, ...base } = sheet();
	void entry_count;
	void running_count;
	void logged_seconds;
	return { ...base, ...over };
}

function approvalRow(over: Partial<ApprovalRow> = {}): ApprovalRow {
	return {
		...sheet({ status: "submitted" }),
		member: { id: MEMBER, display_name: "Maria Santos", avatar_url: null },
		policy_workspace: null,
		...over,
	};
}

let client: QueryClient;

function setup(viewer: string, options = {}) {
	useAuthStore.setState({ user: { id: viewer } as never });
	client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const wrapper = ({ children }: { children: ReactNode }) =>
		createElement(QueryClientProvider, { client }, children);
	return renderHook(() => useTimesheetActions(options), { wrapper });
}

function invalidatedPrefixes(spy: { mock: { calls: unknown[][] } }) {
	return spy.mock.calls.map((call) =>
		JSON.stringify((call[0] as { queryKey: unknown }).queryKey),
	);
}

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(new Date("2026-09-28T03:00:00.000Z"));
});

afterEach(() => {
	cleanup();
	client?.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
	vi.clearAllMocks();
	vi.useRealTimers();
});

describe("useTimesheetActions › single actions", () => {
	it("submits with the sheet's revision, invalidates the sheet event and names the approvers", async () => {
		const submit = vi
			.spyOn(timeService, "submitTimesheet")
			.mockResolvedValue(
				row({ status: "submitted", approver_scope: "team", revision: 4 }),
			);
		const { result } = setup(MEMBER);
		const spy = vi.spyOn(client, "invalidateQueries");

		let outcome: Awaited<ReturnType<typeof result.current.submit>> | undefined;
		await act(async () => {
			outcome = await result.current.submit(
				sheet({
					routing_preview: {
						approver_scope: "team",
						cost_money: false,
						deciders: [{ id: DECIDER, display_name: "Ana Reyes" }],
					},
				}),
			);
		});

		expect(submit).toHaveBeenCalledWith("s1", { expected_revision: 3 });
		expect(outcome?.ok).toBe(true);
		expect(toast.success).toHaveBeenCalledWith(
			"Sent to Prodigitality Services Inc. Team's owners and admins for approval.",
		);
		const keys = invalidatedPrefixes(spy);
		expect(keys).toContain(JSON.stringify(["time", "timesheet"]));
		expect(keys).toContain(JSON.stringify(["time", "approvals"]));
		expect(keys).toContain(JSON.stringify(["payouts"]));
	});

	it("an auto or self route reads 'Approved · 38:15'", async () => {
		vi.spyOn(timeService, "submitTimesheet").mockResolvedValue(
			row({
				status: "approved",
				approver_scope: "self",
				total_seconds: 137_700,
			}),
		);
		const { result } = setup(MEMBER);
		await act(async () => {
			await result.current.submit(sheet());
		});
		expect(toast.success).toHaveBeenCalledWith("Approved · 38:15");
	});

	it("approves with a note and the overtime box", async () => {
		const approve = vi
			.spyOn(timeService, "approveTimesheet")
			.mockResolvedValue(
				row({ status: "approved", payable_seconds: 144_000, revision: 5 }),
			);
		const { result } = setup(DECIDER);
		await act(async () => {
			await result.current.approve(sheet({ status: "submitted" }), {
				note: "  Thanks  ",
				approveOvertime: true,
			});
		});
		expect(approve).toHaveBeenCalledWith("s1", {
			expected_revision: 3,
			note: "Thanks",
			approve_overtime: true,
		});
		expect(toast.success).toHaveBeenCalledWith("Approved · 40:00 frozen");
	});

	it("never sends approve_overtime on other actions or an empty note", async () => {
		const reopen = vi
			.spyOn(timeService, "reopenTimesheet")
			.mockResolvedValue(row({ status: "open" }));
		const { result } = setup(MEMBER);
		await act(async () => {
			await result.current.reopen(sheet({ status: "approved" }), {
				note: "   ",
				approveOvertime: true,
			});
		});
		expect(reopen).toHaveBeenCalledWith("s1", { expected_revision: 3 });
		expect(toast.success).toHaveBeenCalledWith("Reopened. You can edit again.");
	});

	it("a decider's reopen names the person", async () => {
		vi.spyOn(timeService, "reopenTimesheet").mockResolvedValue(
			row({ status: "returned" }),
		);
		const { result } = setup(DECIDER);
		await act(async () => {
			await result.current.reopen(sheet({ status: "approved" }), {
				note: "Split Thursday",
			});
		});
		expect(toast.success).toHaveBeenCalledWith(
			"Reopened. Maria can edit again.",
		);
	});

	it("return needs a note before any request", async () => {
		const ret = vi.spyOn(timeService, "returnTimesheet");
		const { result } = setup(DECIDER);
		let outcome:
			| Awaited<ReturnType<typeof result.current.returnSheet>>
			| undefined;
		await act(async () => {
			outcome = await result.current.returnSheet(
				sheet({ status: "submitted" }),
				{
					note: " ",
				},
			);
		});
		expect(ret).not.toHaveBeenCalled();
		expect(outcome?.ok).toBe(false);
		if (outcome && !outcome.ok) {
			expect(outcome.failure.kind).toBe("note");
			expect(outcome.failure.message).toBe(
				"Add a note so Maria knows what to change.",
			);
		}
		expect(result.current.failure?.kind).toBe("note");
	});

	it("returns with the note and toasts 'Returned to Maria'", async () => {
		const ret = vi
			.spyOn(timeService, "returnTimesheet")
			.mockResolvedValue(row({ status: "returned" }));
		const { result } = setup(DECIDER);
		await act(async () => {
			await result.current.returnSheet(sheet({ status: "submitted" }), {
				note: "Split Thursday",
			});
		});
		expect(ret).toHaveBeenCalledWith("s1", {
			expected_revision: 3,
			note: "Split Thursday",
		});
		expect(toast.success).toHaveBeenCalledWith("Returned to Maria");
	});

	it("withdraw and ask-to-reopen use their own toasts", async () => {
		vi.spyOn(timeService, "withdrawTimesheet").mockResolvedValue(
			row({ status: "open" }),
		);
		const request = vi
			.spyOn(timeService, "requestReopenTimesheet")
			.mockResolvedValue(row({ status: "approved" }));
		const { result } = setup(MEMBER);
		await act(async () => {
			await result.current.withdraw(sheet({ status: "submitted" }));
		});
		expect(toast.success).toHaveBeenLastCalledWith(
			"Withdrawn. You can edit again.",
		);
		await act(async () => {
			await result.current.requestReopen(sheet({ status: "approved" }), {
				note: "Wrong project",
			});
		});
		expect(request).toHaveBeenCalledWith("s1", {
			expected_revision: 3,
			note: "Wrong project",
		});
		expect(toast.success).toHaveBeenLastCalledWith(
			"Asked to reopen. The approvers have your note.",
		);
	});

	it("toastOnSuccess: false stays quiet", async () => {
		vi.spyOn(timeService, "withdrawTimesheet").mockResolvedValue(row());
		const { result } = setup(MEMBER, { toastOnSuccess: false });
		await act(async () => {
			await result.current.withdraw(sheet({ status: "submitted" }));
		});
		expect(toast.success).not.toHaveBeenCalled();
	});
});

describe("useTimesheetActions › refusals", () => {
	it("a stale revision names the person for a decider and refreshes the sheet", async () => {
		vi.spyOn(timeService, "approveTimesheet").mockRejectedValue(
			new TimeApiError({
				status: 409,
				code: "STALE_REVISION",
				message: "This timesheet changed.",
				extras: { timesheet_id: "s1", expected: 3, actual: 4 },
			}),
		);
		const { result } = setup(DECIDER);
		const spy = vi.spyOn(client, "invalidateQueries");
		let outcome: Awaited<ReturnType<typeof result.current.approve>> | undefined;
		await act(async () => {
			outcome = await result.current.approve(sheet({ status: "submitted" }));
		});
		expect(outcome?.ok).toBe(false);
		expect(result.current.failure).toMatchObject({
			kind: "stale",
			timesheetId: "s1",
			personName: "Maria Santos",
			message: "Maria changed this timesheet while you were looking.",
		});
		expect(invalidatedPrefixes(spy)).toContain(
			JSON.stringify(["time", "timesheet"]),
		);
		expect(toast.error).not.toHaveBeenCalled();
		expect(toast.success).not.toHaveBeenCalled();
	});

	it("on the member's own sheet a stale revision names nobody", async () => {
		vi.spyOn(timeService, "withdrawTimesheet").mockRejectedValue(
			new TimeApiError({
				status: 409,
				code: "STALE_REVISION",
				message: "x",
				extras: { timesheet_id: "s1" },
			}),
		);
		const { result } = setup(MEMBER);
		await act(async () => {
			await result.current.withdraw(sheet({ status: "submitted" }));
		});
		expect(result.current.failure?.message).toBe(
			"This timesheet changed while you were looking.",
		);
		expect(result.current.failure?.personName).toBeNull();
	});

	it("a transition refused because the state moved reads as stale", async () => {
		vi.spyOn(timeService, "approveTimesheet").mockRejectedValue(
			new TimeApiError({
				status: 409,
				code: "TIMESHEET_TRANSITION_INVALID",
				message: "x",
				extras: { reason: "state", timesheet_id: "s1" },
			}),
		);
		const { result } = setup(DECIDER);
		await act(async () => {
			await result.current.approve(sheet({ status: "submitted" }));
		});
		expect(result.current.failure?.kind).toBe("stale");
	});

	it("a settled reopen carries the A12 copy and its link", async () => {
		vi.spyOn(timeService, "reopenTimesheet").mockRejectedValue(
			new TimeApiError({
				status: 409,
				code: "TIMESHEET_HAS_SETTLED_ENTRIES",
				message: "x",
				extras: {
					timesheet_id: "s1",
					reason: "billed",
					invoice_id: "inv-1",
					invoice_number: "INV-0042",
					invoice_status: "draft",
				},
			}),
		);
		const { result } = setup(DECIDER);
		await act(async () => {
			await result.current.reopen(sheet({ status: "approved" }), {
				note: "x",
			});
		});
		expect(result.current.failure).toMatchObject({
			kind: "settled",
			message:
				"These hours are on draft invoice INV-0042. Remove them from the draft to reopen.",
			settled: { link: { kind: "invoice", id: "inv-1" } },
		});
	});

	it("other refusals use the shared copy, and toastOnError toasts them", async () => {
		vi.spyOn(timeService, "submitTimesheet").mockRejectedValue(
			new TimeApiError({
				status: 409,
				code: "TIMESHEET_TRANSITION_INVALID",
				message: "x",
				extras: { reason: "running_entry" },
			}),
		);
		const onFailure = vi.fn();
		const { result } = setup(MEMBER, { toastOnError: true, onFailure });
		await act(async () => {
			await result.current.submit(sheet());
		});
		const message =
			"A timer is still running on this timesheet. Stop it first.";
		expect(result.current.failure).toMatchObject({ kind: "other", message });
		expect(toast.error).toHaveBeenCalledWith(message);
		expect(onFailure).toHaveBeenCalledTimes(1);
	});

	it("clearFailure and the next call clear the last refusal", async () => {
		vi.spyOn(timeService, "withdrawTimesheet")
			.mockRejectedValueOnce(
				new TimeApiError({ status: 500, code: "TIME_INTERNAL", message: "x" }),
			)
			.mockResolvedValueOnce(row());
		const { result } = setup(MEMBER);
		await act(async () => {
			await result.current.withdraw(sheet({ status: "submitted" }));
		});
		expect(result.current.failure?.message).toBe(
			"Proyekto couldn't save this time. Try again.",
		);
		act(() => result.current.clearFailure());
		expect(result.current.failure).toBeNull();
	});
});

describe("useTimesheetActions › bulk approve", () => {
	const maria = approvalRow({ id: "s1", revision: 3 });
	const leo = approvalRow({
		id: "s2",
		revision: 7,
		member_user_id: "member-2",
		member_display_name_snapshot: "Leo",
		member: { id: "member-2", display_name: "Leo Cruz", avatar_url: null },
	});

	it("sends ids and revisions in order, all or nothing", async () => {
		const bulk = vi
			.spyOn(timeService, "approveTimesheetsBulk")
			.mockResolvedValue([row({ id: "s1" }), row({ id: "s2" })]);
		const { result } = setup(DECIDER);
		await act(async () => {
			await result.current.approveBulk([maria, leo], { note: "ok" });
		});
		expect(bulk).toHaveBeenCalledWith({
			ids: ["s1", "s2"],
			expected_revisions: [3, 7],
			note: "ok",
		});
		expect(toast.success).toHaveBeenCalledWith("Approved 2 timesheets");
	});

	it("a stale sheet names its person (A10)", async () => {
		vi.spyOn(timeService, "approveTimesheetsBulk").mockRejectedValue(
			new TimeApiError({
				status: 409,
				code: "STALE_REVISION",
				message: "x",
				extras: { timesheet_id: "s2", expected: 7, actual: 8 },
			}),
		);
		const { result } = setup(DECIDER);
		let outcome:
			| Awaited<ReturnType<typeof result.current.approveBulk>>
			| undefined;
		await act(async () => {
			outcome = await result.current.approveBulk([maria, leo]);
		});
		expect(outcome?.ok).toBe(false);
		if (outcome && !outcome.ok) {
			expect(outcome.failure).toMatchObject({
				kind: "stale",
				timesheetId: "s2",
				personName: "Leo Cruz",
				message: "Nothing was approved: Leo Cruz's timesheet changed.",
			});
		}
	});

	it("a stale sheet without a name still says nothing was approved", () => {
		const failure = describeSheetFailure(
			"approve_bulk",
			new TimeApiError({
				status: 409,
				code: "STALE_REVISION",
				message: "x",
				extras: { reason: "entry_set" },
			}),
			[maria, leo],
			DECIDER,
		);
		expect(failure.message).toBe("Nothing was approved: a timesheet changed.");
		expect(failure.timesheetId).toBeNull();
	});

	it("an empty selection never calls the API", async () => {
		const bulk = vi.spyOn(timeService, "approveTimesheetsBulk");
		const { result } = setup(DECIDER);
		await act(async () => {
			await result.current.approveBulk([]);
		});
		expect(bulk).not.toHaveBeenCalled();
		expect(result.current.failure?.kind).toBe("other");
	});

	it("tracks what is pending and shares one request for a double click", async () => {
		let resolve!: (rows: TimesheetRow[]) => void;
		const bulk = vi.spyOn(timeService, "approveTimesheetsBulk").mockReturnValue(
			new Promise((res) => {
				resolve = res;
			}),
		);
		const { result } = setup(DECIDER);
		let first!: Promise<unknown>;
		let second!: Promise<unknown>;
		act(() => {
			first = result.current.approveBulk([maria, leo]);
			second = result.current.approveBulk([maria, leo]);
		});
		await waitFor(() =>
			expect(result.current.isPending("approve_bulk", "s2")).toBe(true),
		);
		expect(result.current.isPending("approve")).toBe(false);
		expect(bulk).toHaveBeenCalledTimes(1);
		expect(first).toBe(second);
		await act(async () => {
			resolve([row({ id: "s1" }), row({ id: "s2" })]);
			await first;
		});
		expect(result.current.pending).toBeNull();
	});
});

describe("pure helpers", () => {
	it("sheetPersonName prefers the queue's member name", () => {
		expect(sheetPersonName(approvalRow())).toBe("Maria Santos");
		expect(
			sheetPersonName({ member: null, member_display_name_snapshot: " Leo " }),
		).toBe("Leo");
		expect(sheetPersonName(null)).toBeNull();
	});

	it("sheetSuccessToast for a workspace route names the workspace", () => {
		expect(
			sheetSuccessToast(
				"submit",
				[
					row({
						status: "submitted",
						approver_scope: "workspace",
						scope_kind: "workspace",
						scope_label_snapshot: "Acme",
					}),
				],
				[sheet({ scope_kind: "workspace", scope_label_snapshot: "Acme" })],
			),
		).toBe("Sent to Acme's workspace owners and admins for approval.");
	});

	it("sheetSuccessToast for a hirer route names the person", () => {
		expect(
			sheetSuccessToast(
				"submit",
				[row({ status: "submitted", approver_scope: "hirer" })],
				[
					sheet({
						scope_kind: "engagement",
						scope_label_snapshot: "Acme Corp",
						routing_preview: {
							approver_scope: "hirer",
							cost_money: true,
							deciders: [{ id: "d", display_name: "Ana Reyes" }],
						},
					}),
				],
			),
		).toBe("Sent to Ana Reyes for approval.");
	});
});
