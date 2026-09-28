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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PLAN_LIMITS } from "@/lib/planLimits";
import { isoToDateInput } from "@/lib/planLimitsAdmin";
import type { AdminWorkspaceRow } from "@/services/admin.service";
import { CompPlanDialog } from "./CompPlanDialog";

const mocks = vi.hoisted(() => ({
	getWorkspace: vi.fn(),
	setWorkspaceComp: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@/services/admin.service", () => ({
	adminService: {
		getWorkspace: mocks.getWorkspace,
		setWorkspaceComp: mocks.setWorkspaceComp,
	},
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({ success: mocks.toastSuccess, error: mocks.toastError }),
}));

vi.mock("@/hooks/usePlanLimits", () => ({
	usePublicPlanLimits: () => ({
		limits: DEFAULT_PLAN_LIMITS,
		isLive: false,
		version: null,
	}),
}));

const baseRow: AdminWorkspaceRow = {
	id: "ws-1",
	name: "Acme",
	slug: "acme",
	created_at: "2026-01-01T00:00:00Z",
	owner: { id: "u-1", email: "owner@acme.test" },
	members: 12,
	pending_invites: 0,
	projects: 4,
	teams: 3,
	subscription: {
		plan: "free",
		status: null,
		has_provider_subscription: false,
	},
	complimentary: null,
	effective_plan: "free",
	plan_source: "default",
	over_limit: ["members", "projects", "teams"],
};

function renderDialog(workspace: AdminWorkspaceRow, onClose = vi.fn()) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<CompPlanDialog open workspace={workspace} onClose={onClose} />
		</QueryClientProvider>,
	);
	return { onClose };
}

const submitButton = (name: string) =>
	screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => {
	mocks.getWorkspace.mockResolvedValue({
		...baseRow,
		largest_roadmaps: [],
		audit: [],
	});
	mocks.setWorkspaceComp.mockImplementation(async () => ({
		workspace: baseRow,
		warnings: [],
	}));
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("CompPlanDialog", () => {
	it("requires a note before comping", async () => {
		const { onClose } = renderDialog(baseRow);
		expect(submitButton("Comp plan").disabled).toBe(true);

		const note = screen.getByLabelText("Note (required)");
		fireEvent.change(note, { target: { value: "   " } });
		expect(submitButton("Comp plan").disabled).toBe(true);

		fireEvent.click(screen.getByRole("radio", { name: /Business/ }));
		fireEvent.change(note, { target: { value: "  Design partner  " } });
		expect(submitButton("Comp plan").disabled).toBe(false);
		fireEvent.click(submitButton("Comp plan"));

		await waitFor(() =>
			expect(mocks.setWorkspaceComp).toHaveBeenCalledTimes(1),
		);
		expect(mocks.setWorkspaceComp.mock.calls[0]).toEqual([
			"ws-1",
			{ plan: "business", until: null, note: "Design partner" },
		]);
		await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
		expect(mocks.toastSuccess).toHaveBeenCalledWith(
			"Acme is on a complimentary Business plan.",
		);
	});

	it("sends an end date as the end of that day", async () => {
		renderDialog(baseRow);
		fireEvent.change(screen.getByLabelText("Ends on (optional)"), {
			target: { value: "2099-03-31" },
		});
		fireEvent.change(screen.getByLabelText("Note (required)"), {
			target: { value: "Trial extension" },
		});
		fireEvent.click(submitButton("Comp plan"));

		await waitFor(() =>
			expect(mocks.setWorkspaceComp).toHaveBeenCalledTimes(1),
		);
		const input = mocks.setWorkspaceComp.mock.calls[0][1];
		expect(input.plan).toBe("pro");
		expect(isoToDateInput(input.until)).toBe("2099-03-31");
		expect(new Date(input.until).getHours()).toBe(23);
	});

	it("warns that comping doesn't cancel a paid subscription", () => {
		renderDialog({
			...baseRow,
			subscription: {
				plan: "pro",
				status: "active",
				has_provider_subscription: true,
			},
			effective_plan: "pro",
			plan_source: "subscription",
		});
		expect(
			screen.getByText(/Comping doesn't cancel their paid subscription\./),
		).toBeTruthy();
	});

	it("says nothing about billing when there is no subscription", () => {
		renderDialog(baseRow);
		expect(
			screen.queryByText(/Comping doesn't cancel their paid subscription/),
		).toBeNull();
	});

	it("shows the warnings a save returns instead of closing", async () => {
		mocks.setWorkspaceComp.mockResolvedValue({
			workspace: baseRow,
			warnings: ["workspace_has_live_subscription"],
		});
		const { onClose } = renderDialog(baseRow);
		fireEvent.change(screen.getByLabelText("Note (required)"), {
			target: { value: "Partner" },
		});
		fireEvent.click(submitButton("Comp plan"));

		const dialog = await screen.findByRole("dialog", {
			name: "Complimentary plan saved",
		});
		expect(
			within(dialog).getByText(/also has a live paid subscription/),
		).toBeTruthy();
		expect(onClose).not.toHaveBeenCalled();
		fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("starts an edit from the current comp", () => {
		const until = "2099-12-31T23:59:59.999Z";
		renderDialog({
			...baseRow,
			complimentary: {
				plan: "enterprise",
				since: "2026-09-01T00:00:00Z",
				until,
				active: true,
			},
			effective_plan: "enterprise",
			plan_source: "complimentary",
		});
		expect(
			screen.getByRole("dialog", { name: "Edit complimentary plan" }),
		).toBeTruthy();
		expect(
			(screen.getByRole("radio", { name: /Enterprise/ }) as HTMLInputElement)
				.checked,
		).toBe(true);
		expect(
			(screen.getByLabelText("Ends on (optional)") as HTMLInputElement).value,
		).toBe(isoToDateInput(until));
		expect(submitButton("Save comp").disabled).toBe(true);
	});

	it("shows usage against the chosen tier", () => {
		renderDialog(baseRow);
		// Pro: 12 members of Unlimited, 4 projects of 10, 3 teams of 3.
		const teams = screen.getByText("Teams", { selector: "dt" }).parentElement;
		expect(teams?.textContent).toContain("3 / 3");
	});
});
