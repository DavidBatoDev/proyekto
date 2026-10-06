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

import {
	type EngagementAssignment,
	engagementAssignmentsService,
} from "@/services/engagementAssignments.service";
import { TimeApiError } from "@/services/time.service";
import { EndAssignmentDialog } from "./EndAssignmentDialog";

function row(over: Partial<EngagementAssignment> = {}): EngagementAssignment {
	return {
		id: "a1",
		engagement_id: "eng-1",
		project_id: "p1",
		project_title_snapshot: "Acme Website",
		worker_user_id: "talent-1",
		worker_label: "Leo Cruz",
		client_engagement_id: null,
		talent_engagement_id: "eng-1",
		team_id: null,
		role_title: null,
		status: "active",
		started_at: "2026-10-01T01:00:00.000Z",
		ended_at: null,
		...over,
	};
}

function renderDialog(
	props: Partial<Parameters<typeof EndAssignmentDialog>[0]> = {},
) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const onClose = vi.fn();
	const onEnded = vi.fn();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	render(
		<EndAssignmentDialog
			engagementId="eng-1"
			assignment={row()}
			workerName="Leo Cruz"
			onClose={onClose}
			onEnded={onEnded}
			{...props}
		/>,
		{ wrapper },
	);
	return { client, onClose, onEnded };
}

function dialog() {
	return screen.getByRole("dialog");
}

function confirm() {
	fireEvent.click(
		within(dialog()).getByRole("button", { name: "End assignment" }),
	);
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	for (const fn of Object.values(toast)) fn.mockReset();
});

describe("EndAssignmentDialog", () => {
	it("warns that the worker's running timer stops at the end time (L37)", () => {
		renderDialog();
		expect(within(dialog()).getByText("End assignment?")).toBeTruthy();
		expect(
			within(dialog()).getByText(
				"After it ends, Leo Cruz can't log time on Acme Website under this agreement.",
			),
		).toBeTruthy();
		expect(
			within(dialog()).getByText(
				"Ending this stops Leo Cruz's running timer at the end time.",
			),
		).toBeTruthy();
		expect(
			within(dialog()).getByText("Leave empty to end it now."),
		).toBeTruthy();
	});

	it("speaks to the viewer about their own assignment", () => {
		renderDialog({ workerName: null });
		expect(
			within(dialog()).getByText(
				"Ending this stops your running timer at the end time.",
			),
		).toBeTruthy();
		expect(
			within(dialog()).getByText(
				"After it ends, you can't log time on Acme Website under this agreement.",
			),
		).toBeTruthy();
	});

	it("sends the end and reason, toasts, refreshes and closes", async () => {
		const end = vi
			.spyOn(engagementAssignmentsService, "end")
			.mockResolvedValue(row({ status: "ended" }));
		const { client, onEnded } = renderDialog();
		const invalidate = vi.spyOn(client, "invalidateQueries");

		fireEvent.change(within(dialog()).getByLabelText("Ends"), {
			target: { value: "2026-10-05T18:00" },
		});
		fireEvent.change(within(dialog()).getByLabelText("Reason"), {
			target: { value: "The work is done" },
		});
		confirm();

		await waitFor(() => expect(onEnded).toHaveBeenCalledTimes(1));
		expect(end).toHaveBeenCalledWith("eng-1", "a1", {
			ended_at: new Date("2026-10-05T18:00").toISOString(),
			reason: "The work is done",
		});
		expect(toast.success).toHaveBeenCalledWith(
			"The assignment to Acme Website has ended.",
		);
		const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey);
		expect(keys).toEqual(
			expect.arrayContaining([
				["engagement", "eng-1"],
				["project", "members", "p1"],
				["time", "me", "running"],
			]),
		);
	});

	it("treats an assignment that already ended as done", async () => {
		vi.spyOn(engagementAssignmentsService, "end").mockRejectedValue(
			new TimeApiError({
				status: 409,
				code: "ASSIGNMENT_NOT_ACTIVE" as never,
				message: "This assignment has already ended.",
			}),
		);
		const { onEnded } = renderDialog();
		confirm();
		await waitFor(() => expect(onEnded).toHaveBeenCalledTimes(1));
		expect(toast.info).toHaveBeenCalledWith(
			"This assignment has already ended.",
		);
		expect(toast.success).not.toHaveBeenCalled();
	});

	it("keeps the dialog open with the server's reason for a refused end", async () => {
		vi.spyOn(engagementAssignmentsService, "end").mockRejectedValue(
			new TimeApiError({
				status: 400,
				code: "HTTP_400" as never,
				message:
					"Time is logged under this assignment after that. Pick a later end.",
			}),
		);
		const { onEnded } = renderDialog();
		confirm();
		expect((await within(dialog()).findByRole("alert")).textContent).toBe(
			"Time is logged under this assignment after that. Pick a later end.",
		);
		expect(onEnded).not.toHaveBeenCalled();
	});

	it("explains a 403 without printing a code", async () => {
		vi.spyOn(engagementAssignmentsService, "end").mockRejectedValue(
			new TimeApiError({
				status: 403,
				code: "HTTP_403" as never,
				message: "Only the agreement's hirer can end this assignment.",
			}),
		);
		renderDialog();
		confirm();
		expect((await within(dialog()).findByRole("alert")).textContent).toBe(
			"Only the agreement's hirer can end this assignment.",
		);
	});
});
