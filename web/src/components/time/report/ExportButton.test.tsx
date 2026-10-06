/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ native: false }));
vi.mock("@/lib/platform", () => ({ isNativeApp: () => platform.native }));

const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));

const plan = vi.hoisted(() => ({ hasExport: true }));
vi.mock("@/hooks/useEntitlements", () => ({
	useEntitlements: (workspaceId?: string | null) => ({
		status: workspaceId ? "ready" : "unavailable",
		usage: workspaceId
			? {
					workspace_id: workspaceId,
					features: [
						{
							key: "time_reports_export",
							label: "Workspace time reports and export",
							available_on: "business",
						},
					],
				}
			: null,
		plan: workspaceId ? "pro" : null,
		upgradePlan: "business",
		isComplimentary: false,
		hasFeature: () => plan.hasExport,
	}),
}));

vi.mock("@/services/time.service", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/services/time.service")>();
	return { ...actual, saveTimeExport: vi.fn() };
});

import {
	saveTimeExport,
	TimeApiError,
	timeService,
} from "@/services/time.service";
import { TEAM_ID, WORKSPACE_ID } from "./__fixtures__/reportFixtures";
import { ExportButton } from "./ExportButton";

const query = {
	scope: { kind: "team" as const, id: TEAM_ID },
	from: "2026-09-01",
	to: "2026-09-30",
	member_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

function renderWithClient(ui: ReactElement) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

beforeEach(() => {
	platform.native = false;
	plan.hasExport = true;
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.mocked(saveTimeExport).mockReset();
	toast.error.mockReset();
});

describe("ExportButton", () => {
	it("exports the filtered report in the chosen format and saves the file", async () => {
		const file = {
			blob: new Blob(["a,b"]),
			filename: "proyekto-time-team.xlsx",
			contentType: "application/octet-stream",
		};
		const exportReport = vi
			.spyOn(timeService, "exportReport")
			.mockResolvedValue(file);
		renderWithClient(
			<ExportButton query={query} planWorkspace={{ id: WORKSPACE_ID }} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "Export" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "Excel (.xlsx)" }));
		await waitFor(() => expect(saveTimeExport).toHaveBeenCalledWith(file));
		expect(exportReport).toHaveBeenCalledWith({ ...query, format: "xlsx" });
	});

	it("shows the plan notice instead of exporting when the plan lacks it", () => {
		plan.hasExport = false;
		const exportReport = vi.spyOn(timeService, "exportReport");
		renderWithClient(
			<ExportButton
				query={query}
				planWorkspace={{ id: WORKSPACE_ID, name: "Acme" }}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Export" }));
		expect(document.body.textContent).toContain(
			"Workspace-wide time reports and export are part of Business.",
		);
		expect(screen.queryByRole("menuitem")).toBeNull();
		expect(exportReport).not.toHaveBeenCalled();
	});

	it("toasts a refusal in plain words but leaves plan limits to the global prompt", async () => {
		vi.spyOn(timeService, "exportReport")
			.mockRejectedValueOnce(
				new TimeApiError({
					status: 400,
					code: "HTTP_400",
					message:
						"This export has more than 10,000 entries. Pick a shorter range.",
				}),
			)
			.mockRejectedValueOnce(
				new TimeApiError({
					status: 403,
					code: "plan_limit",
					message: "Upgrade",
					response: {
						status: 403,
						data: {
							error: {
								code: "plan_limit",
								limit_key: "time_reports_export",
								kind: "feature",
								plan: "pro",
							},
						},
					},
				}),
			);
		renderWithClient(<ExportButton query={query} />);
		fireEvent.click(screen.getByRole("button", { name: "Export" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "CSV" }));
		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith(
				"This export has more than 10,000 entries. Pick a shorter range.",
			),
		);
		fireEvent.click(screen.getByRole("button", { name: "Export" }));
		fireEvent.click(screen.getByRole("menuitem", { name: "CSV" }));
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Export" })).toBeTruthy(),
		);
		expect(toast.error).toHaveBeenCalledTimes(1);
		expect(saveTimeExport).not.toHaveBeenCalled();
	});

	it("renders nothing on native", () => {
		platform.native = true;
		const { container } = renderWithClient(<ExportButton query={query} />);
		expect(container.innerHTML).toBe("");
	});
});
