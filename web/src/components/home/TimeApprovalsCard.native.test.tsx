/* @vitest-environment jsdom */

// Native copy rules (ux.md › Mobile; web blueprint §4) for the dashboard's
// time surfaces: the approvals card and the welcome line. No contract, rate,
// payout or invoice; no amounts (agreement sheets included); no /engagements
// links. Everything links into /time, an `app` surface.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => true }));
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
import { DASHBOARD_DEMO_DATASET } from "@/lib/tours/demo/dashboardDemoDataset";
import { timeService } from "@/services/time.service";
import type { ApprovalRow, TimesheetSummary } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";
import { DashboardWidgets } from "./DashboardWidgets";
import { TimeApprovalsCard } from "./TimeApprovalsCard";

const BANNED = /\b(contracts?|rates?|payouts?|invoices?)\b/i;
const AMOUNT = /\b[A-Z]{3}\s?[\d,]+(\.\d+)?\b|[$€£₱]\s?\d/;
const USER = "viewer";
const clients: QueryClient[] = [];

function assertNativeSafe() {
	const text = document.body.textContent ?? "";
	expect(text).not.toMatch(BANNED);
	expect(text).not.toMatch(AMOUNT);
	for (const el of Array.from(
		document.body.querySelectorAll("[title],[aria-label]"),
	)) {
		expect(el.getAttribute("title") ?? "").not.toMatch(BANNED);
		expect(el.getAttribute("aria-label") ?? "").not.toMatch(BANNED);
	}
	expect(document.body.querySelector('a[href*="/engagements"]')).toBeNull();
	const links = Array.from(document.body.querySelectorAll("a[href]"));
	expect(links.length).toBeGreaterThan(0);
	for (const link of links) {
		expect(link.getAttribute("href")).toMatch(/^\/time(?:[/?#]|$)/);
	}
}

const [fixtureMaria, fixtureLeo] = (
	DASHBOARD_DEMO_DATASET.timeApprovals as { rows: ApprovalRow[] }
).rows;

// An agreement sheet whose counterparty is a person's client: the row must
// show hours and the counterparty only.
const AGREEMENT: ApprovalRow = {
	...fixtureLeo,
	id: "sheet-agreement",
	scope_label_snapshot: "Acme Corp",
	total_seconds: 43 * 3600 + 30 * 60,
	logged_seconds: 43 * 3600 + 30 * 60,
	flags: { needs_review: 0, over_cap_seconds: 3 * 3600 + 30 * 60, running: 0 },
};

function lastWeekSheet(): TimesheetSummary {
	const start = addDays(weekWindow(localDate(new Date(), "UTC"), 1).start, -7);
	return {
		...fixtureMaria,
		id: "mine",
		member_user_id: USER,
		scope_kind: "engagement",
		scope_label_snapshot: "Acme Corp",
		period_start: start,
		period_end: addDays(start, 6),
		timezone: "UTC",
		status: "open",
		approver_scope: null,
		submitted_at: null,
		submission_kind: null,
		total_seconds: null,
		logged_seconds: 28 * 3600 + 45 * 60,
		routing_preview: {
			approver_scope: "hirer",
			cost_money: true,
			deciders: [{ id: "a1", display_name: "Ana Reyes" }],
		},
	};
}

beforeEach(() => {
	useAuthStore.setState({ user: { id: USER } as User, profile: null });
});

afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
});

describe("dashboard time on the installed app", () => {
	it("keeps the approvals card and the welcome line free of money words", async () => {
		vi.spyOn(timeService, "getOverview").mockResolvedValue({
			can_log: true,
			approver_mode: false,
			contexts: [],
			approvals_waiting: 3,
			workspace_time_admin: [],
		});
		vi.spyOn(timeService, "listApprovals").mockResolvedValue({
			items: [fixtureMaria, AGREEMENT],
			total: 3,
			page: 1,
			limit: 2,
		});
		vi.spyOn(timeService, "listMyTimesheets").mockResolvedValue([
			lastWeekSheet(),
		]);

		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		clients.push(client);
		client.setQueryData(["dashboard", "projects", USER], []);
		client.setQueryData(["dashboard", "roadmaps-preview", USER], []);
		client.setQueryData(["dashboard", "meetings-preview", USER], []);
		render(
			<QueryClientProvider client={client}>
				<DashboardWidgets leadContent={<TimeApprovalsCard />} />
			</QueryClientProvider>,
		);

		const rows = await screen.findAllByTestId("time-approvals-row");
		expect(rows).toHaveLength(2);
		expect(rows[1].textContent).toContain("Acme Corp");
		expect(rows[1].textContent).toContain("43:30");
		await screen.findByRole("link", { name: "Submit last week (28h 45m)" });
		expect(
			screen
				.getByRole("link", { name: "3 timesheets waiting" })
				.getAttribute("href"),
		).toBe("/time#waiting");
		expect(screen.getByText("+1 more")).toBeTruthy();

		assertNativeSafe();
	});
});
