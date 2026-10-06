/* @vitest-environment jsdom */

/**
 * BudgetSplitPanel (W3-1b): removing a member from the project here changes
 * who can log time on it, so the time keys that depend on it are refreshed.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	mutate: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("@/hooks/useToast", () => ({ useToast: () => mocks.toast }));
vi.mock("@/hooks/useAutosave", () => ({ useAutosave: () => "idle" }));
vi.mock("@/components/common/FormFields", () => ({
	AutosaveIndicator: () => null,
}));
vi.mock("@/hooks/useProjectQueries", () => ({
	useProjectRemoveMemberMutation: () => ({
		isPending: false,
		mutate: mocks.mutate,
	}),
	useProjectMembersQuery: () => ({
		data: [{ id: "row-1", user_id: "u1" }],
	}),
}));
vi.mock("@/hooks/useProjectRoster", () => ({
	useProjectRoster: () => ({
		rows: [
			{
				teamId: "t1",
				member: {
					user_id: "u1",
					position: null,
					user: { display_name: "Ana Reyes" },
				},
			},
		],
		isPending: false,
	}),
	rosterMemberLabel: (member: { user?: { display_name?: string } }) =>
		member.user?.display_name ?? "Someone",
}));
vi.mock("@/services/contract.service", () => ({
	contractService: {
		listByProject: () => Promise.resolve([]),
		getEconomics: () =>
			Promise.resolve({
				company_percent: 40,
				allocation_mode: "equal",
				allocations: [],
			}),
		updateEconomics: vi.fn(),
	},
}));
vi.mock("@/services/project.service", () => ({
	projectService: { get: () => Promise.resolve({ currency: "USD" }) },
}));

import { BudgetSplitPanel } from "./BudgetSplitPanel";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	mocks.mutate.mockReset();
});

describe("BudgetSplitPanel › Remove from the project", () => {
	it("refreshes who can log here, the For options, the loggable projects and the overview", async () => {
		vi.spyOn(window, "confirm").mockReturnValue(true);
		mocks.mutate.mockImplementation(
			(_id: string, options?: { onSuccess?: () => void }) =>
				options?.onSuccess?.(),
		);
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const invalidate = vi.spyOn(client, "invalidateQueries");
		render(
			<QueryClientProvider client={client}>
				<BudgetSplitPanel projectId="p1" />
			</QueryClientProvider>,
		);
		fireEvent.click(
			await screen.findByRole("button", {
				name: "Remove Ana Reyes from the project",
			}),
		);
		expect(mocks.mutate).toHaveBeenCalledWith("row-1", expect.anything());
		expect(mocks.toast.success).toHaveBeenCalledWith("Removed from project");
		for (const queryKey of [
			["time", "loggers"],
			["time", "logging-for"],
			["time", "me", "projects"],
			["time", "me", "overview"],
		]) {
			expect(invalidate).toHaveBeenCalledWith({ queryKey });
		}
	});
});
