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
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));
vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		success: vi.fn(),
		error: vi.fn(),
		warning: vi.fn(),
		info: vi.fn(),
	}),
}));
const plan = vi.hoisted(() => ({ hasExport: true }));
vi.mock("@/hooks/useEntitlements", () => ({
	useEntitlements: (workspaceId?: string | null) => ({
		status: workspaceId ? "ready" : "unavailable",
		usage: workspaceId ? { workspace_id: workspaceId, features: [] } : null,
		plan: workspaceId ? "pro" : null,
		upgradePlan: "business",
		isComplimentary: false,
		hasFeature: () => plan.hasExport,
	}),
}));

import { TimeApiError, timeService } from "@/services/time.service";
import type { ReportQuery } from "@/services/time.types";
import {
	entry,
	group,
	maskedAgreementEntry,
	NOW,
	PROJECT_ID,
	summary,
	TEAM_ID,
	U1,
	U2,
	WORKSPACE_ID,
} from "./__fixtures__/reportFixtures";
import { TimeReport } from "./TimeReport";

function renderWithClient(ui: ReactElement) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

const teamSummary = summary({
	total_seconds: 43_200,
	payable_seconds: 30_600,
	groups: [
		group({
			key: U1,
			label: "Maria Santos",
			total_seconds: 36_000,
			payable_seconds: 30_600,
			amounts_by_currency: { PHP: 6885 },
		}),
		group({ key: U2, label: "Leo Cruz", total_seconds: 7_200 }),
	],
	sheet_status_counts: { open: 1, submitted: 1, returned: 0, approved: 2 },
	under_agreements_seconds: 136_800,
});

const approvedSummary = summary({
	total_seconds: 32_000,
	payable_seconds: 30_600,
	groups: [group({ key: U1, total_seconds: 32_000, payable_seconds: 30_600 })],
});

function mockSummaries() {
	return vi
		.spyOn(timeService, "getReportSummary")
		.mockImplementation(async (q: ReportQuery) =>
			q.status === "approved" ? approvedSummary : teamSummary,
		);
}

function mockEntries() {
	return vi.spyOn(timeService, "getReportEntries").mockResolvedValue({
		items: [entry({ payable_seconds: 3600 })],
		total: 1,
		page: 1,
		limit: 50,
	});
}

beforeEach(() => {
	plan.hasExport = true;
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

const teamScope = { kind: "team" as const, id: TEAM_ID };

describe("TimeReport (team scope)", () => {
	it("splits Approved from Not yet approved and never adds them", async () => {
		const getSummary = mockSummaries();
		mockEntries();
		renderWithClient(
			<TimeReport
				scope={teamScope}
				search={{}}
				onSearchChange={vi.fn()}
				timezone="Asia/Manila"
				now={NOW}
			/>,
		);
		const approved = await screen.findByRole("group", { name: "Approved" });
		await waitFor(() => expect(approved.textContent).toContain("8:30"));
		const pending = screen.getByRole("group", { name: "Not yet approved" });
		await waitFor(() => expect(pending.textContent).toContain("3:06"));
		expect(screen.getByRole("group", { name: "Cost" }).textContent).toContain(
			"PHP 6,885.00",
		);
		// 43,200 s logged (12:00) is never shown as a total.
		expect(document.body.textContent).not.toContain("12:00");
		expect(document.body.textContent).toContain(
			"Timesheets: 1 open · 1 submitted · 2 approved",
		);

		const maria = screen.getByRole("rowheader", { name: "Maria Santos" });
		expect(
			[...(maria.parentElement?.querySelectorAll("td") ?? [])].map(
				(td) => td.textContent,
			),
		).toEqual(["8:30", "1:06", "PHP 6,885.00"]);

		expect(getSummary).toHaveBeenCalledWith(
			expect.objectContaining({
				scope: teamScope,
				from: "2026-10-01",
				to: "2026-10-31",
				group_by: "member",
			}),
		);
		expect(getSummary).toHaveBeenCalledWith(
			expect.objectContaining({ status: "approved", group_by: "member" }),
		);
	});

	it("shows the hours-only Under agreements line and the entries", async () => {
		mockSummaries();
		mockEntries();
		renderWithClient(
			<TimeReport
				scope={teamScope}
				search={{}}
				onSearchChange={vi.fn()}
				now={NOW}
			/>,
		);
		const under = await screen.findByRole("region", {
			name: "Under agreements",
		});
		expect(under.textContent).toContain("38:00");
		const entries = screen.getByRole("region", { name: "Entries" });
		await waitFor(() => expect(entries.textContent).toContain("Fix login bug"));
		// Team reports have no For filter and no For column.
		expect(screen.queryByRole("button", { name: "For: all" })).toBeNull();
		expect(
			within(entries).queryByRole("columnheader", { name: "For" }),
		).toBeNull();
	});

	it("sends filter changes to the host's URL", async () => {
		mockSummaries();
		mockEntries();
		const onSearchChange = vi.fn();
		renderWithClient(
			<TimeReport
				scope={teamScope}
				search={{}}
				onSearchChange={onSearchChange}
				now={NOW}
			/>,
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "Maria Santos" }),
		);
		expect(onSearchChange).toHaveBeenCalledWith({ person: U1 });
		fireEvent.click(screen.getByRole("button", { name: "Group by person" }));
		fireEvent.click(screen.getByRole("option", { name: "Group by week" }));
		expect(onSearchChange).toHaveBeenCalledWith({ group: "week" });
	});

	it("reads no split under a status filter", async () => {
		const getSummary = mockSummaries();
		mockEntries();
		renderWithClient(
			<TimeReport
				scope={teamScope}
				search={{ status: "submitted", person: U1, group: "day" }}
				onSearchChange={vi.fn()}
				now={NOW}
			/>,
		);
		const pending = await screen.findByRole("group", {
			name: "Not yet approved",
		});
		await waitFor(() => expect(pending.textContent).toContain("12:00"));
		for (const [query] of getSummary.mock.calls) {
			expect(query.status).not.toBe("approved");
		}
		expect(getSummary).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "submitted",
				member_user_id: U1,
				group_by: "day",
			}),
		);
	});

	it("a failed Not yet approved read says so and retries, never a bare dash", async () => {
		let failApproved = true;
		const getSummary = vi
			.spyOn(timeService, "getReportSummary")
			.mockImplementation(async (q: ReportQuery) => {
				if (q.status !== "approved") return teamSummary;
				if (failApproved) {
					throw new TimeApiError({
						status: 403,
						code: "missing_permission",
						message: "x",
					});
				}
				return approvedSummary;
			});
		mockEntries();
		renderWithClient(
			<TimeReport
				scope={teamScope}
				search={{}}
				onSearchChange={vi.fn()}
				timezone="Asia/Manila"
				now={NOW}
			/>,
		);
		const tile = await screen.findByRole("group", { name: "Not yet approved" });
		const retry = await within(tile).findByRole("button", {
			name: "Try again",
		});
		expect(within(tile).getByRole("alert").textContent).toBe(
			"You don't have permission to do that.",
		);
		expect(tile.textContent).not.toContain("—");

		failApproved = false;
		fireEvent.click(retry);
		await waitFor(() => expect(tile.textContent).toContain("3:06"));
		expect(within(tile).queryByRole("button")).toBeNull();
		expect(
			getSummary.mock.calls.filter(([q]) => q.status === "approved").length,
		).toBeGreaterThanOrEqual(2);
	});

	it("shows a reason card for a report the viewer can't open", async () => {
		vi.spyOn(timeService, "getReportSummary").mockRejectedValue(
			new TimeApiError({ status: 404, code: "TIME_NOT_FOUND", message: "x" }),
		);
		mockEntries();
		renderWithClient(
			<TimeReport
				scope={teamScope}
				search={{}}
				onSearchChange={vi.fn()}
				now={NOW}
			/>,
		);
		expect(
			await screen.findByText("This doesn't exist or you can't open it."),
		).toBeTruthy();
	});
});

describe("TimeReport (workspace scope)", () => {
	it("shows the plan notice instead of reading without the export feature", () => {
		plan.hasExport = false;
		const getSummary = vi.spyOn(timeService, "getReportSummary");
		renderWithClient(
			<TimeReport
				scope={{ kind: "workspace", id: WORKSPACE_ID }}
				search={{}}
				onSearchChange={vi.fn()}
				planWorkspace={{ id: WORKSPACE_ID, name: "Acme" }}
				now={NOW}
			/>,
		);
		expect(document.body.textContent).toContain(
			"Workspace-wide time reports and export are part of Business.",
		);
		expect(getSummary).not.toHaveBeenCalled();
	});
});

describe("TimeReport (project Everyone)", () => {
	it("renders one section per context from every entry", async () => {
		vi.spyOn(timeService, "getReportSummary").mockResolvedValue(
			summary({ scope: { kind: "project", id: PROJECT_ID } }),
		);
		const getEntries = vi
			.spyOn(timeService, "getReportEntries")
			.mockResolvedValue({
				items: [
					entry({
						id: "a",
						payable_seconds: 3600,
						cost: "visible",
						currency_snapshot: "PHP",
						amount_snapshot: 500,
					}),
					maskedAgreementEntry({
						id: "b",
						payable_seconds: 7200,
						duration_seconds: 7200,
					}),
				],
				total: 2,
				page: 1,
				limit: 200,
			});
		renderWithClient(
			<TimeReport
				scope={{ kind: "project", id: PROJECT_ID }}
				layout="sections"
				search={{}}
				onSearchChange={vi.fn()}
				now={NOW}
			/>,
		);
		const agreement = await screen.findByRole("region", {
			name: "Delivery team · agreement with Acme Corp",
		});
		expect(agreement.textContent).toContain("(hours only)");
		expect(
			screen.getByRole("region", { name: "Design · team" }).textContent,
		).toContain("PHP 500.00");
		await waitFor(() =>
			expect(
				screen.getByRole("group", { name: "Approved" }).textContent,
			).toContain("3:00"),
		);
		expect(getEntries).toHaveBeenCalledWith(
			expect.objectContaining({ page: 1, limit: 200 }),
		);
		// Sections replace the group-by control; the For filter is offered.
		expect(screen.queryByRole("button", { name: /^Group by/ })).toBeNull();
		expect(screen.getByRole("button", { name: "For: all" })).toBeTruthy();
	});
});
