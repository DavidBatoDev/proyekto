/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import { TimesheetCard, timesheetCardLabel } from "./TimesheetCard";

const MEMBER = "member-1";
const TZ = "Asia/Manila";
// Thu Oct 1 2026, 11:00 in Manila: inside the Sep 28 – Oct 4 week.
const MID_WEEK = new Date("2026-10-01T03:00:00.000Z");
// Sun Oct 4 2026, 11:00 in Manila: the period's last day.
const LAST_DAY = new Date("2026-10-04T03:00:00.000Z");

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
		period_start: "2026-09-28",
		period_end: "2026-10-04",
		timezone: TZ,
		week_start: 1,
		status: "open",
		approver_scope: null,
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
		created_at: "2026-09-28T01:00:00.000Z",
		updated_at: "2026-09-28T01:00:00.000Z",
		entry_count: 5,
		running_count: 0,
		logged_seconds: 103_500,
		...over,
	};
}

function renderCard(
	props: Partial<Parameters<typeof TimesheetCard>[0]> = {},
	over: Partial<TimesheetSummary> = {},
) {
	return render(
		<TimesheetCard
			sheet={sheet(over)}
			now={MID_WEEK}
			userTimezone={TZ}
			{...props}
		/>,
	);
}

beforeEach(() => {
	useAuthStore.setState({ user: { id: MEMBER } as never });
});

afterEach(() => {
	cleanup();
	useAuthStore.setState({ user: null });
	vi.clearAllMocks();
});

describe("TimesheetCard", () => {
	it("shows the scope, period, logged time and 'Open · until <last day>'", () => {
		renderCard({ onSubmit: vi.fn() });
		const card = screen.getByTestId("timesheet-card");
		expect(card.getAttribute("data-status")).toBe("open");
		// 32 characters exactly: shown in full on a card.
		expect(screen.getByText("Prodigitality Services Inc. Team")).toBeTruthy();
		expect(screen.getByText("Sep 28–Oct 4")).toBeTruthy();
		expect(screen.getByText("28:45")).toBeTruthy();
		expect(screen.getByTestId("timesheet-card-status").textContent).toBe(
			"Open",
		);
		expect(screen.getByTestId("timesheet-card-sublabel").textContent).toBe(
			"until Oct 4",
		);
		// Manual routing before the last day: no Submit yet.
		expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
	});

	it("links the label to the review screen", () => {
		renderCard();
		const link = screen.getByRole("link");
		expect(link.getAttribute("href")).toBe("/time/timesheets/s1");
	});

	it("offers Submit from the period's last day", () => {
		const onSubmit = vi.fn();
		renderCard({ onSubmit, now: LAST_DAY });
		fireEvent.click(screen.getByRole("button", { name: "Submit" }));
		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({ id: "s1" }),
		);
	});

	it("an overdue sheet says so and can be submitted", () => {
		renderCard(
			{ onSubmit: vi.fn(), now: new Date("2026-10-06T03:00:00.000Z") },
			{},
		);
		expect(screen.getByTestId("timesheet-card-sublabel").textContent).toBe(
			"overdue",
		);
		expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
	});

	it("an auto/self route (A1) sends itself and can be sent early", () => {
		renderCard(
			{ onSubmit: vi.fn() },
			{
				scope_kind: "workspace",
				scope_label_snapshot: "Acme",
				routing_preview: {
					approver_scope: "self",
					cost_money: false,
					deciders: [],
				},
			},
		);
		expect(screen.getByTestId("timesheet-card-sublabel").textContent).toBe(
			"sends itself Oct 5",
		);
		expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
	});

	it("uses the reminder days for the sends-itself date", () => {
		renderCard(
			{ reminderDays: 3 },
			{
				routing_preview: {
					approver_scope: "auto",
					cost_money: false,
					deciders: [],
				},
			},
		);
		expect(screen.getByTestId("timesheet-card-sublabel").textContent).toBe(
			"sends itself Oct 7",
		);
	});

	it("never offers Submit on an empty sheet", () => {
		renderCard({ onSubmit: vi.fn(), now: LAST_DAY }, { entry_count: 0 });
		expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
	});

	it("a returned sheet is amber with the note, Fix and Resubmit", () => {
		const onFix = vi.fn();
		const onSubmit = vi.fn();
		renderCard(
			{ onFix, onSubmit, names: { "d-1": "Ana Reyes" } },
			{
				status: "returned",
				approver_scope: "team",
				decided_by: "d-1",
				decision_note: "Split Thursday",
			},
		);
		const card = screen.getByTestId("timesheet-card");
		expect(card.className).toContain("border-l-warning");
		expect(screen.getByTestId("timesheet-card-sublabel").textContent).toBe(
			"Returned by Ana · 'Split Thursday'",
		);
		fireEvent.click(screen.getByRole("button", { name: "Fix" }));
		fireEvent.click(screen.getByRole("button", { name: "Resubmit" }));
		expect(onFix).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledTimes(1);
	});

	it("a submitted sheet waits on its deciders (A2) and can be withdrawn", () => {
		const onWithdraw = vi.fn();
		renderCard(
			{ onWithdraw, onSubmit: vi.fn() },
			{
				status: "submitted",
				approver_scope: "hirer",
				scope_kind: "engagement",
				scope_label_snapshot: "Acme Corp",
				submission_kind: "manual",
				deciders: [{ id: "d-1", display_name: "Ana Reyes" }],
			},
		);
		expect(screen.getByTestId("timesheet-card").className).toContain(
			"border-l-muted-foreground/50",
		);
		expect(screen.getByTestId("timesheet-card-sublabel").textContent).toBe(
			"Waiting on Ana Reyes",
		);
		expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
		expect(onWithdraw).toHaveBeenCalledTimes(1);
	});

	it("an empty decider list says no one else can approve", () => {
		renderCard(
			{},
			{ status: "submitted", approver_scope: "workspace", deciders: [] },
		);
		expect(screen.getByTestId("timesheet-card-sublabel").textContent).toBe(
			"No one else can approve this. Add a workspace admin.",
		);
	});

	it("an approved sheet is green with its sublabel and no actions", () => {
		renderCard(
			{ onSubmit: vi.fn(), onWithdraw: vi.fn(), onFix: vi.fn() },
			{
				status: "approved",
				decision_kind: "self",
				approver_scope: "self",
			},
		);
		expect(screen.getByTestId("timesheet-card").className).toContain(
			"border-l-success",
		);
		expect(screen.getByTestId("timesheet-card-sublabel").textContent).toBe(
			"Self-approved",
		);
		expect(screen.queryAllByRole("button")).toHaveLength(0);
	});

	it("someone else's sheet gets no member actions", () => {
		renderCard(
			{ onWithdraw: vi.fn(), viewerId: "someone-else" },
			{ status: "submitted", approver_scope: "team" },
		);
		expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
	});

	it("shows a busy spinner and disables the buttons", () => {
		renderCard({ onSubmit: vi.fn(), now: LAST_DAY, busy: true });
		expect(
			(screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(screen.getByLabelText("Working")).toBeTruthy();
	});

	it("names the timezone when the sheet's is not the reader's", () => {
		renderCard({ userTimezone: "America/New_York" });
		expect(screen.getByText("Sep 28–Oct 4 (Asia/Manila)")).toBeTruthy();
	});
});

describe("timesheetCardLabel", () => {
	it("cuts long names at 32 with the full name as the tooltip", () => {
		const label = timesheetCardLabel({
			scope_kind: "team",
			scope_label_snapshot: "Prodigitality Services International Team",
		});
		expect(label.text).toBe("Prodigitality Services Internati…");
		expect(label.title).toBe("Prodigitality Services International Team");
	});

	it("adds ' · agreement' on web and nothing on native", () => {
		const engagement = {
			scope_kind: "engagement" as const,
			scope_label_snapshot: "Acme Corp",
		};
		expect(timesheetCardLabel(engagement).text).toBe("Acme Corp · agreement");
		expect(timesheetCardLabel(engagement, { native: true }).text).toBe(
			"Acme Corp",
		);
		expect(timesheetCardLabel(engagement).title).toBeUndefined();
	});
});
