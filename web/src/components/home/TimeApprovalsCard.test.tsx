/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";
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

const workspaceState = vi.hoisted(() => ({
	current: {
		workspace: { id: "w1", slug: "acme" } as {
			id: string;
			slug: string;
		} | null,
		workspaces: [],
		isLoading: false,
	},
}));
vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useCurrentWorkspace: () => workspaceState.current,
}));

import { DASHBOARD_DEMO_DATASET } from "@/lib/tours/demo/dashboardDemoDataset";
import {
	TourDemoProvider,
	useTourDemoControls,
} from "@/lib/tours/demo/TourDemoContext";
import { TimeApiError, timeService } from "@/services/time.service";
import type { ApprovalRow, TimeOverview } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";
import { TimeApprovalsCard } from "./TimeApprovalsCard";

const TZ = "Asia/Manila";
const NOW = new Date("2026-10-06T03:00:00.000Z");

function overview(over: Partial<TimeOverview> = {}): TimeOverview {
	return {
		can_log: false,
		approver_mode: true,
		contexts: [],
		approvals_waiting: 3,
		workspace_time_admin: [],
		...over,
	};
}

function row(over: Partial<ApprovalRow> = {}): ApprovalRow {
	return {
		id: "sheet-1",
		member_user_id: "u1",
		member_display_name_snapshot: "Maria Santos",
		scope_kind: "team",
		scope_ref: "t1",
		team_id: "t1",
		workspace_id: null,
		engagement_id: null,
		scope_label_snapshot: "Prodigitality Services Inc. Team",
		policy_workspace_id: "w1",
		period_kind: "weekly",
		period_start: "2026-09-28",
		period_end: "2026-10-04",
		timezone: TZ,
		week_start: 1,
		status: "submitted",
		approver_scope: "team",
		revision: 2,
		submitted_at: "2026-10-04T02:00:00.000Z",
		submitted_by: "u1",
		submission_kind: "manual",
		decided_at: null,
		decided_by: null,
		decision_kind: null,
		decision_note: null,
		overtime_approved: false,
		total_seconds: 38 * 3600 + 15 * 60,
		payable_seconds: null,
		origin: "app",
		created_at: "2026-09-28T01:00:00.000Z",
		updated_at: "2026-10-04T02:00:00.000Z",
		entry_count: 12,
		running_count: 0,
		logged_seconds: 38 * 3600 + 15 * 60,
		member: { id: "u1", display_name: "Maria Santos", avatar_url: null },
		policy_workspace: { id: "w1", name: "Prodigitality Workspace" },
		flags: { needs_review: 0, over_cap_seconds: 0, running: 0 },
		...over,
	};
}

const LEO = row({
	id: "sheet-2",
	member_user_id: "u2",
	member_display_name_snapshot: "Leo Cruz",
	member: { id: "u2", display_name: "Leo Cruz", avatar_url: null },
	scope_kind: "engagement",
	scope_ref: "e1",
	team_id: null,
	engagement_id: "e1",
	scope_label_snapshot: "Acme Corp",
	approver_scope: "hirer",
	policy_workspace_id: "w2",
	policy_workspace: { id: "w2", name: "Pixel Studio" },
	total_seconds: 12 * 3600,
	logged_seconds: 12 * 3600,
	submitted_at: "2026-10-06T01:00:00.000Z",
});

const clients: QueryClient[] = [];

function DemoOn({ children }: { children: ReactNode }) {
	const demo = useTourDemoControls();
	useEffect(() => {
		demo.enter(DASHBOARD_DEMO_DATASET);
	}, [demo.enter]);
	return <>{children}</>;
}

function renderCard(options: { demo?: boolean } = {}) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	clients.push(client);
	const card = <TimeApprovalsCard now={NOW} userTimezone={TZ} />;
	return render(
		<QueryClientProvider client={client}>
			<TourDemoProvider>
				{options.demo ? <DemoOn>{card}</DemoOn> : card}
			</TourDemoProvider>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	useAuthStore.setState({ user: { id: "viewer" } as User });
	workspaceState.current = {
		workspace: { id: "w1", slug: "acme" },
		workspaces: [],
		isLoading: false,
	};
});

afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
});

describe("TimeApprovalsCard", () => {
	it("renders nothing, and asks for no rows, when nothing waits", async () => {
		const getOverview = vi
			.spyOn(timeService, "getOverview")
			.mockResolvedValue(overview({ approvals_waiting: 0, can_log: true }));
		const listApprovals = vi.spyOn(timeService, "listApprovals");
		vi.spyOn(timeService, "listMyTimesheets").mockResolvedValue([]);

		const { container } = renderCard();

		await waitFor(() => expect(getOverview).toHaveBeenCalled());
		expect(container.innerHTML).toBe("");
		expect(listApprovals).not.toHaveBeenCalled();
	});

	it("lists the first two waiting sheets, the count and +N more", async () => {
		vi.spyOn(timeService, "getOverview").mockResolvedValue(overview());
		const listApprovals = vi
			.spyOn(timeService, "listApprovals")
			.mockResolvedValue({ items: [row(), LEO], total: 3, page: 1, limit: 2 });

		renderCard();

		const rows = await screen.findAllByTestId("time-approvals-row");
		expect(listApprovals).toHaveBeenCalledWith({
			status: "submitted",
			limit: 2,
		});
		expect(rows).toHaveLength(2);
		expect(screen.getByRole("heading").textContent).toContain(
			"Waiting for your approval",
		);
		expect(screen.getByTestId("time-approvals-count").textContent).toBe("3");

		const [maria, leo] = rows;
		expect(maria.getAttribute("href")).toBe("/time/timesheets/sheet-1");
		expect(maria.textContent).toContain("Maria Santos");
		// Cut at the chip length, full name in the tooltip.
		expect(maria.textContent).toContain("Prodigitality Services…");
		expect(maria.querySelector("[title]")?.getAttribute("title")).toBe(
			"Prodigitality Services Inc. Team",
		);
		expect(maria.textContent).toContain("Sep 28–Oct 4");
		expect(maria.textContent).toContain("38:15");
		expect(maria.textContent).toContain("2 days ago");

		expect(leo.getAttribute("href")).toBe("/time/timesheets/sheet-2");
		expect(leo.textContent).toContain("Acme Corp");
		expect(leo.textContent).not.toContain("agreement");
		expect(leo.textContent).toContain("12:00");
		expect(leo.textContent).toContain("today");

		const reviewAll = screen.getByRole("link", { name: /Review all/ });
		expect(reviewAll.getAttribute("href")).toBe("/time#waiting");
		const more = screen.getByRole("link", { name: "+1 more" });
		expect(more.getAttribute("href")).toBe("/time#waiting");
	});

	it("tags only the rows from another workspace (E27)", async () => {
		vi.spyOn(timeService, "getOverview").mockResolvedValue(overview());
		vi.spyOn(timeService, "listApprovals").mockResolvedValue({
			items: [row(), LEO],
			total: 2,
			page: 1,
			limit: 2,
		});

		renderCard();

		await screen.findAllByTestId("time-approvals-row");
		const tags = screen.getAllByTestId("for-workspace-tag");
		expect(tags).toHaveLength(1);
		expect(tags[0].textContent).toBe("Pixel Studio");
		// Exactly the total: no "+N more".
		expect(screen.queryByText(/more$/)).toBeNull();
	});

	it("tags nothing while the dashboard's workspace is still loading", async () => {
		workspaceState.current = {
			workspace: null,
			workspaces: [],
			isLoading: true,
		};
		vi.spyOn(timeService, "getOverview").mockResolvedValue(overview());
		vi.spyOn(timeService, "listApprovals").mockResolvedValue({
			items: [row(), LEO],
			total: 2,
			page: 1,
			limit: 2,
		});

		renderCard();

		await screen.findAllByTestId("time-approvals-row");
		expect(screen.queryByTestId("for-workspace-tag")).toBeNull();
	});

	it("holds the overview's count over a skeleton while the rows load", async () => {
		vi.spyOn(timeService, "getOverview").mockResolvedValue(
			overview({ approvals_waiting: 5 }),
		);
		vi.spyOn(timeService, "listApprovals").mockReturnValue(
			new Promise(() => {}),
		);

		renderCard();

		const count = await screen.findByTestId("time-approvals-count");
		expect(count.textContent).toBe("5");
		expect(
			screen.getByTestId("time-approvals-card").querySelector("[aria-busy]"),
		).not.toBeNull();
		expect(screen.queryByTestId("time-approvals-row")).toBeNull();
	});

	it("keeps the header and Review all when the rows fail to load", async () => {
		vi.spyOn(timeService, "getOverview").mockResolvedValue(overview());
		const listApprovals = vi
			.spyOn(timeService, "listApprovals")
			.mockRejectedValue(
				new TimeApiError({
					status: 403,
					code: "missing_permission",
					message: "No.",
				}),
			);

		renderCard();

		await waitFor(() => expect(listApprovals).toHaveBeenCalled());
		await waitFor(() =>
			expect(
				screen.getByTestId("time-approvals-card").querySelector("[aria-busy]"),
			).toBeNull(),
		);
		expect(screen.getByTestId("time-approvals-count").textContent).toBe("3");
		expect(screen.getByRole("link", { name: /Review all/ })).toBeTruthy();
		expect(screen.queryByTestId("time-approvals-row")).toBeNull();
		expect(screen.queryByText(/more$/)).toBeNull();
	});

	it("shows the tour fixtures during a replay, without asking the server", async () => {
		vi.spyOn(timeService, "getOverview").mockResolvedValue(
			overview({ approvals_waiting: 0 }),
		);
		const listApprovals = vi.spyOn(timeService, "listApprovals");

		renderCard({ demo: true });

		const rows = await screen.findAllByTestId("time-approvals-row");
		expect(rows.map((el) => el.textContent)).toEqual([
			expect.stringContaining("Maria Santos"),
			expect.stringContaining("Leo Cruz"),
		]);
		expect(screen.getByText("+1 more")).toBeTruthy();
		// The fixture from "another workspace" carries its tag.
		expect(screen.getByTestId("for-workspace-tag").textContent).toBe(
			"Pixel Studio",
		);
		expect(listApprovals).not.toHaveBeenCalled();
	});
});
