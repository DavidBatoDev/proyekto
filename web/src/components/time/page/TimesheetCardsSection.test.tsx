/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeApiError } from "@/services/time.service";
import type { TimesheetSummary } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({
			children,
			to,
			params,
			className,
		}: {
			children?: ReactNode;
			to: string;
			params?: Record<string, string>;
			className?: string;
		}) => {
			let href = to;
			for (const [key, value] of Object.entries(params ?? {})) {
				href = href.replace(`$${key}`, value);
			}
			return (
				<a href={href} className={className}>
					{children}
				</a>
			);
		},
	};
});

import { TimesheetCardsSection } from "./TimesheetCardsSection";

const NOW = new Date("2026-10-06T03:00:00.000Z");
const TZ = "Asia/Manila";

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
		period_start: "2026-09-28",
		period_end: "2026-10-04",
		timezone: TZ,
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
		created_at: "2026-09-28T00:00:00.000Z",
		updated_at: "2026-09-28T00:00:00.000Z",
		entry_count: 3,
		running_count: 0,
		logged_seconds: 28 * 3600 + 45 * 60,
		...over,
	};
}

beforeEach(() => {
	useAuthStore.setState({ user: { id: "u1" } as never });
});

afterEach(() => {
	cleanup();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
});

describe("TimesheetCardsSection", () => {
	it("renders nothing without sheets (Just me has none)", () => {
		const { container } = render(<TimesheetCardsSection sheets={[]} />);
		expect(container.innerHTML).toBe("");
	});

	it("lists one card per sheet under the heading and wires Submit, Fix and Withdraw", () => {
		const onSubmit = vi.fn();
		const onFix = vi.fn();
		const onWithdraw = vi.fn();
		const open = sheet();
		const returned = sheet({
			id: "s2",
			scope_kind: "engagement",
			scope_ref: "e1",
			scope_label_snapshot: "Acme Corp",
			status: "returned",
			decision_note: "Split Thu",
			decided_by: "ana",
		});
		const submitted = sheet({
			id: "s3",
			scope_kind: "workspace",
			scope_ref: "w1",
			scope_label_snapshot: "Acme",
			status: "submitted",
			submitted_at: "2026-10-05T01:00:00.000Z",
		});
		render(
			<TimesheetCardsSection
				sheets={[open, returned, submitted]}
				onSubmit={onSubmit}
				onFix={onFix}
				onWithdraw={onWithdraw}
				names={{ ana: "Ana Reyes" }}
				now={NOW}
				userTimezone={TZ}
			/>,
		);
		expect(
			screen.getByRole("heading", { name: "Timesheets in this week" }),
		).toBeTruthy();
		expect(screen.getAllByTestId("timesheet-card")).toHaveLength(3);
		expect(screen.getByText("Acme Corp · agreement")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Submit" }));
		expect(onSubmit).toHaveBeenCalledWith(open);
		fireEvent.click(screen.getByRole("button", { name: "Fix" }));
		expect(onFix).toHaveBeenCalledWith(returned);
		fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
		expect(onWithdraw).toHaveBeenCalledWith(submitted);
	});

	it("marks the card being fixed and the busy one", () => {
		render(
			<TimesheetCardsSection
				sheets={[sheet({ status: "returned" })]}
				onFix={vi.fn()}
				fixingId="s1"
				isBusy={(id) => id === "s1"}
				now={NOW}
				userTimezone={TZ}
			/>,
		);
		const card = screen.getByTestId("timesheet-card");
		expect(card.className).toContain("ring-2");
		expect(screen.getByLabelText("Working")).toBeTruthy();
	});

	it("shows a skeleton while loading and a reason card with Try again on failure", () => {
		const { rerender } = render(<TimesheetCardsSection sheets={[]} loading />);
		expect(
			screen.getByRole("heading", { name: "Timesheets in this week" }),
		).toBeTruthy();
		const onRetry = vi.fn();
		rerender(
			<TimesheetCardsSection
				sheets={[]}
				error={
					new TimeApiError({ status: 500, code: "TIME_INTERNAL", message: "x" })
				}
				onRetry={onRetry}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(onRetry).toHaveBeenCalled();
	});
});
