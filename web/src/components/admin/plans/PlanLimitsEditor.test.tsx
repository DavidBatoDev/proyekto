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
import {
	DEFAULT_PLAN_LIMITS,
	LIMIT_DEFINITIONS,
	PLAN_ORDER,
	type PlanId,
} from "@/lib/planLimits";
import type { AdminLimitCell, AdminPlanLimits } from "@/lib/planLimitsAdmin";
import { PlanLimitsEditor } from "./PlanLimitsEditor";

const mocks = vi.hoisted(() => ({
	getMe: vi.fn(),
	getPlanLimits: vi.fn(),
	updatePlanLimits: vi.fn(),
	toastSuccess: vi.fn(),
	toastWarning: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@/services/admin.service", () => ({
	adminService: {
		getMe: mocks.getMe,
		getPlanLimits: mocks.getPlanLimits,
		updatePlanLimits: mocks.updatePlanLimits,
	},
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		success: mocks.toastSuccess,
		warning: mocks.toastWarning,
		error: mocks.toastError,
		info: vi.fn(),
		showToast: vi.fn(),
	}),
}));

const VERSION = "2026-09-22T09:33:37.123Z";

function matrix(): AdminPlanLimits {
	const cells = {} as Record<PlanId, Record<string, AdminLimitCell>>;
	for (const plan of PLAN_ORDER) {
		cells[plan] = {};
		for (const [key, cell] of Object.entries(DEFAULT_PLAN_LIMITS[plan])) {
			cells[plan][key] = { ...cell, updated_at: VERSION, updated_by: null };
		}
	}
	return {
		plans: [...PLAN_ORDER],
		keys: LIMIT_DEFINITIONS.map((definition, index) => ({
			key: definition.key,
			kind: definition.kind,
			label: definition.label,
			unit: definition.unit?.plural ?? null,
			group: definition.group,
			sort_order: index,
			description: null,
			enforced: definition.enforced,
			min: definition.min ?? null,
		})),
		cells,
		version: VERSION,
		drift: { missing_in_db: [], unknown_to_code: [] },
	};
}

function renderEditor(accessLevel: string) {
	mocks.getMe.mockResolvedValue({ id: "a-1", access_level: accessLevel });
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<PlanLimitsEditor />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	mocks.getPlanLimits.mockResolvedValue(matrix());
	mocks.updatePlanLimits.mockImplementation(async () => ({
		...matrix(),
		warnings: [],
	}));
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const field = (label: string) =>
	screen.getByLabelText(label) as HTMLInputElement;

async function findField(label: string) {
	const input = (await screen.findByLabelText(label)) as HTMLInputElement;
	await waitFor(() => expect(input.disabled).toBe(false));
	return input;
}

async function openReview() {
	fireEvent.click(await screen.findByRole("button", { name: "Review & save" }));
	return screen.findByRole("dialog");
}

const button = (name: string) =>
	screen.getByRole("button", { name }) as HTMLButtonElement;

describe("PlanLimitsEditor", () => {
	it("Unlimited sets the cell to null", async () => {
		renderEditor("super_admin");
		const input = await findField("Free Projects");
		expect(input.value).toBe("2");

		fireEvent.click(field("Free Projects unlimited"));
		expect(input.disabled).toBe(true);
		expect(input.value).toBe("");
		expect(screen.getByText("1 unsaved change")).toBeTruthy();

		const dialog = await openReview();
		expect(
			within(dialog).getByText("Free · Projects: 2 → Unlimited"),
		).toBeTruthy();
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Save changes" }),
		);

		await waitFor(() =>
			expect(mocks.updatePlanLimits).toHaveBeenCalledTimes(1),
		);
		expect(mocks.updatePlanLimits.mock.calls[0][0]).toEqual({
			changes: [
				{ plan: "free", key: "projects", value: null, display_label: null },
			],
			note: undefined,
			base_version: VERSION,
		});
	});

	it("saves only the changed cells, in one PUT with base_version", async () => {
		renderEditor("super_admin");
		const projects = await findField("Free Projects");

		fireEvent.change(projects, { target: { value: "3" } });
		// Edited and put back: not a change.
		const teams = field("Free Teams");
		fireEvent.change(teams, { target: { value: "5" } });
		fireEvent.change(teams, { target: { value: "2" } });
		// Turning an enforced feature off tightens it.
		fireEvent.click(
			screen.getByRole("switch", { name: "Pro Change requests" }),
		);

		expect(screen.getByText("2 unsaved changes")).toBeTruthy();

		const dialog = await openReview();
		expect(within(dialog).getByText("Free · Projects: 2 → 3")).toBeTruthy();
		expect(
			within(dialog).getByText("Pro · Change requests: On → Off"),
		).toBeTruthy();
		expect(
			within(dialog).getByText(
				"Workspaces already over it keep everything; only new creation is blocked.",
			),
		).toBeTruthy();
		fireEvent.change(within(dialog).getByLabelText(/Note for the audit log/), {
			target: { value: "  Q4 pricing  " },
		});
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Save changes" }),
		);

		await waitFor(() =>
			expect(mocks.updatePlanLimits).toHaveBeenCalledTimes(1),
		);
		expect(mocks.updatePlanLimits.mock.calls[0][0]).toEqual({
			changes: [
				{ plan: "free", key: "projects", value: 3, display_label: null },
				{
					plan: "pro",
					key: "change_requests",
					enabled: false,
					display_label: null,
				},
			],
			note: "Q4 pricing",
			base_version: VERSION,
		});
		await waitFor(() =>
			expect(mocks.toastSuccess).toHaveBeenCalledWith(
				"Plan limits saved. Public pricing updates within about 5 minutes.",
			),
		);
		expect(screen.queryByText(/unsaved change/)).toBeNull();
	});

	it("warns about tier inversions before saving", async () => {
		renderEditor("super_admin");
		fireEvent.change(await findField("Free Projects"), {
			target: { value: "50" },
		});

		const dialog = await openReview();
		expect(
			within(dialog).getByText("Free is more generous than Pro for Projects."),
		).toBeTruthy();
	});

	it("blocks review while a cell is invalid", async () => {
		renderEditor("super_admin");
		fireEvent.change(await findField("Free Members"), {
			target: { value: "0" },
		});
		expect(screen.getByText("At least 1, or Unlimited.")).toBeTruthy();
		expect(button("Review & save").disabled).toBe(true);
	});

	it("shows the stale banner on a 409 and keeps the draft through a reload", async () => {
		mocks.updatePlanLimits.mockRejectedValue(
			Object.assign(
				new Error("Someone saved the plan limits after you loaded them."),
				{ status: 409, code: "plan_limits_stale" },
			),
		);
		renderEditor("super_admin");
		fireEvent.change(await findField("Free Projects"), {
			target: { value: "3" },
		});

		const dialog = await openReview();
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Save changes" }),
		);

		const banner = await screen.findByRole("alert");
		expect(banner.textContent).toContain(
			"Changed by someone else since you opened this page.",
		);
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(button("Review & save").disabled).toBe(true);

		expect(mocks.getPlanLimits).toHaveBeenCalledTimes(1);
		fireEvent.click(within(banner).getByRole("button", { name: /Reload/ }));
		await waitFor(() => expect(mocks.getPlanLimits).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
		expect(screen.getByText("1 unsaved change")).toBeTruthy();
		expect(field("Free Projects").value).toBe("3");
		expect(button("Review & save").disabled).toBe(false);
	});

	it("is read-only unless the admin is a super admin", async () => {
		renderEditor("support");
		await screen.findByText(/Only a super admin can change plan limits/);

		expect(field("Free Projects").disabled).toBe(true);
		expect(field("Free Projects unlimited").disabled).toBe(true);
		expect(
			(
				screen.getByRole("switch", {
					name: "Pro Change requests",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		expect(screen.queryByRole("button", { name: "Review & save" })).toBeNull();
		expect(screen.queryByLabelText("Edit pricing labels")).toBeNull();
	});

	it("marks enforced and pricing-only rows", async () => {
		renderEditor("super_admin");
		const samlRow = (await screen.findByText("SAML and SCIM")).closest("tr");
		expect(
			within(samlRow as HTMLElement).getByText("Pricing only"),
		).toBeTruthy();
		const projectsRow = screen.getByText("Projects").closest("tr");
		expect(
			within(projectsRow as HTMLElement).getByText("Enforced"),
		).toBeTruthy();
	});
});
