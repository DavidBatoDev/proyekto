/* @vitest-environment jsdom */

// The welcome line's time fragments (ux.md › Approvals): "· 3 timesheets
// waiting" for deciders, "· Submit last week (28h 45m)" for loggers with an
// overdue Open sheet that does not send itself.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({
			children,
			to,
			params,
			search,
			hash,
			...rest
		}: {
			children?: ReactNode;
			to: string;
			params?: Record<string, string>;
			search?: Record<string, string>;
			hash?: string;
		} & Record<string, unknown>) => {
			let href = to;
			for (const [key, value] of Object.entries(params ?? {})) {
				href = href.replace(`$${key}`, value);
			}
			const query = new URLSearchParams(search ?? {}).toString();
			if (query) href += `?${query}`;
			if (hash) href += `#${hash}`;
			return (
				<a href={href} {...rest}>
					{children}
				</a>
			);
		},
	};
});
vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useCurrentWorkspace: () => ({
		workspace: { id: "w1", slug: "acme" },
		workspaces: [],
		isLoading: false,
	}),
}));
vi.mock("@/components/home/DashboardCreateActions", () => ({
	DashboardCreateActions: () => null,
}));
vi.mock("@/components/tour/TourDemoBanner", () => ({
	TourDemoBanner: () => null,
}));

import { addDays, localDate, weekWindow } from "@/lib/timePeriods";
import { timeService } from "@/services/time.service";
import type { TimeOverview, TimesheetSummary } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";
import { DashboardWidgets } from "./DashboardWidgets";

const USER = "viewer";
const clients: QueryClient[] = [];

function overview(over: Partial<TimeOverview> = {}): TimeOverview {
	return {
		can_log: false,
		approver_mode: false,
		contexts: [],
		approvals_waiting: 0,
		workspace_time_admin: [],
		...over,
	};
}

/** An Open sheet for last week (Mon–Sun, UTC), whatever today is. */
function lastWeekSheet(over: Partial<TimesheetSummary> = {}): TimesheetSummary {
	const thisWeek = weekWindow(localDate(new Date(), "UTC"), 1);
	const start = addDays(thisWeek.start, -7);
	return {
		id: "s1",
		member_user_id: USER,
		member_display_name_snapshot: "Me",
		scope_kind: "team",
		scope_ref: "t1",
		team_id: "t1",
		workspace_id: null,
		engagement_id: null,
		scope_label_snapshot: "Northwind Studio",
		policy_workspace_id: "w1",
		period_kind: "weekly",
		period_start: start,
		period_end: addDays(start, 6),
		timezone: "UTC",
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
		created_at: `${start}T01:00:00.000Z`,
		updated_at: `${start}T01:00:00.000Z`,
		entry_count: 9,
		running_count: 0,
		logged_seconds: 28 * 3600 + 45 * 60,
		routing_preview: {
			approver_scope: "team",
			cost_money: false,
			deciders: [{ id: "a1", display_name: "Ana Reyes" }],
		},
		...over,
	};
}

function renderWidgets() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	clients.push(client);
	// The dashboard's own lists, fresh in the cache so nothing else fetches.
	client.setQueryData(["dashboard", "projects", USER], []);
	client.setQueryData(["dashboard", "roadmaps-preview", USER], []);
	client.setQueryData(["dashboard", "meetings-preview", USER], []);
	return render(
		<QueryClientProvider client={client}>
			<DashboardWidgets />
		</QueryClientProvider>,
	);
}

function welcomeLine(): HTMLElement {
	const welcome = document.querySelector('[data-tour="dashboard-welcome"]');
	const line = welcome?.querySelector(":scope > p");
	if (!line) throw new Error("no welcome line");
	return line as HTMLElement;
}

beforeEach(() => {
	useAuthStore.setState({
		user: { id: USER } as User,
		profile: null,
	});
});

afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
});

describe("DashboardWidgets › time on the welcome line", () => {
	it("tells a decider how many timesheets wait, linking to Waiting for you", async () => {
		vi.spyOn(timeService, "getOverview").mockResolvedValue(
			overview({ approvals_waiting: 3 }),
		);
		vi.spyOn(timeService, "listApprovals").mockResolvedValue({
			items: [],
			total: 3,
			page: 1,
			limit: 2,
		});
		const listMyTimesheets = vi.spyOn(timeService, "listMyTimesheets");

		renderWidgets();

		const link = await screen.findByRole("link", {
			name: "3 timesheets waiting",
		});
		expect(link.getAttribute("href")).toBe("/time#waiting");
		expect(welcomeLine().textContent).toContain(" · 3 timesheets waiting");
		// Not a logger: no timesheet read for the nudge.
		expect(listMyTimesheets).not.toHaveBeenCalled();
	});

	it("nudges a logger to submit last week, linking to that week", async () => {
		vi.spyOn(timeService, "getOverview").mockResolvedValue(
			overview({ can_log: true }),
		);
		const listApprovals = vi.spyOn(timeService, "listApprovals");
		const sheet = lastWeekSheet();
		const listMyTimesheets = vi
			.spyOn(timeService, "listMyTimesheets")
			.mockResolvedValue([sheet]);

		renderWidgets();

		const link = await screen.findByRole("link", {
			name: "Submit last week (28h 45m)",
		});
		expect(link.getAttribute("href")).toBe(`/time?week=${sheet.period_start}`);
		expect(listMyTimesheets).toHaveBeenCalledWith({
			from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
		});
		// Nothing waits on them: no queue read, no count.
		expect(listApprovals).not.toHaveBeenCalled();
		expect(screen.queryByText(/timesheets? waiting/)).toBeNull();
	});

	it("leaves a sheet that sends itself alone", async () => {
		vi.spyOn(timeService, "getOverview").mockResolvedValue(
			overview({ can_log: true }),
		);
		const listMyTimesheets = vi
			.spyOn(timeService, "listMyTimesheets")
			.mockResolvedValue([
				lastWeekSheet({
					routing_preview: {
						approver_scope: "self",
						cost_money: false,
						deciders: [],
					},
				}),
			]);

		renderWidgets();

		await waitFor(() => expect(listMyTimesheets).toHaveBeenCalled());
		await waitFor(() =>
			expect(welcomeLine().textContent).toContain(
				"Nothing assigned to you right now",
			),
		);
		expect(screen.queryByText(/^Submit /)).toBeNull();
	});

	it("adds nothing for someone who neither logs nor approves", async () => {
		const getOverview = vi
			.spyOn(timeService, "getOverview")
			.mockResolvedValue(overview());
		const listApprovals = vi.spyOn(timeService, "listApprovals");
		const listMyTimesheets = vi.spyOn(timeService, "listMyTimesheets");

		renderWidgets();

		await waitFor(() => expect(getOverview).toHaveBeenCalled());
		expect(welcomeLine().textContent).toBe("Nothing assigned to you right now");
		expect(listApprovals).not.toHaveBeenCalled();
		expect(listMyTimesheets).not.toHaveBeenCalled();
	});
});
