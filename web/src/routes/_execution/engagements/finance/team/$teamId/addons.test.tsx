/* @vitest-environment jsdom */

/**
 * The finance Add-ons Time toggle writes the same team flag as Team settings ›
 * Time, so it refreshes the same reads (W1-review-c finding 3): the team
 * settings page, the sidebar's team list and the team's For option. A plan
 * refusal is prompted globally, and a downgraded workspace hears the downgrade
 * sentence (ux.md › Plan copy), not the upgrade one.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { WorkspaceEntitlements } from "@/lib/entitlements";
import { PlanLimitError } from "@/lib/planLimitErrors";
import type { Team } from "@/services/teams.service";

const mocks = vi.hoisted(() => ({
	getTeam: vi.fn(),
	updateTeam: vi.fn(),
	hasTimeTracking: true,
	toast: {
		success: vi.fn(),
		error: vi.fn(),
		warning: vi.fn(),
		info: vi.fn(),
	},
}));

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

vi.mock("@/contexts/ToastContext", () => ({ useToast: () => mocks.toast }));

vi.mock("@/hooks/useEntitlements", () => ({
	useEntitlements: (): WorkspaceEntitlements =>
		({
			status: "ready",
			usage: { workspace_id: "w1", features: [] },
			plan: "free",
			planName: "Free",
			planSource: null,
			isComplimentary: false,
			limits: null,
			upgradePlan: null,
			usedFor: () => null,
			meter: () => null,
			remaining: () => null,
			canCreate: () => true,
			hasFeature: (key: string) =>
				key === "time_tracking" ? mocks.hasTimeTracking : true,
		}) as unknown as WorkspaceEntitlements,
}));

vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useMyWorkspacesQuery: () => ({
		data: [{ id: "w1", name: "Acme", slug: "acme", my_role: "owner" }],
	}),
}));

vi.mock("@/services/teams.service", () => ({
	getTeam: mocks.getTeam,
	updateTeam: mocks.updateTeam,
}));

vi.mock("@/stores/authStore", () => ({
	useProfile: () => ({ id: "owner-1" }),
}));

vi.mock("@/components/finance/nav/FinanceTrail", () => ({
	FinanceTrail: () => null,
}));

// Partial: createFileRoute needs the real router internals.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	Link: ({ to, children }: { to: string; children?: ReactNode }) => (
		<a href={to}>{children}</a>
	),
}));

import { Route } from "./addons";

// The router plugin code-splits the page, so `component` is a lazy wrapper:
// load its chunk once up front rather than inside the first test's timeout.
beforeAll(async () => {
	const component = Route.options.component as unknown as {
		preload?: () => Promise<void>;
	};
	await component.preload?.();
}, 30_000);

function team(over: Partial<Team> = {}): Team {
	return {
		id: "team-1",
		name: "Delivery",
		owner_id: "owner-1",
		workspace_id: "w1",
		time_tracking_enabled: false,
		...over,
	} as Team;
}

let client: QueryClient;

beforeEach(() => {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	mocks.hasTimeTracking = true;
	mocks.getTeam.mockResolvedValue(team());
	mocks.updateTeam.mockImplementation(
		async (_id: string, patch: Partial<Team>) => team(patch),
	);
	vi.spyOn(Route, "useParams").mockReturnValue({
		teamId: "team-1",
	} as never);
});

afterEach(() => {
	cleanup();
	client.clear();
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

function renderPage() {
	const Page = Route.options.component as ComponentType;
	return render(
		<QueryClientProvider client={client}>
			<Page />
		</QueryClientProvider>,
	);
}

const keyCalls = (calls: readonly (readonly unknown[])[]) =>
	calls.map((call) => (call[0] as { queryKey?: readonly unknown[] })?.queryKey);

describe("finance Add-ons › Time", () => {
	it("turning time on refreshes the team settings, the sidebar and the For option", async () => {
		const invalidate = vi.spyOn(client, "invalidateQueries");
		renderPage();
		const toggle = await screen.findByRole("checkbox");
		await waitFor(() =>
			expect((toggle as HTMLInputElement).disabled).toBe(false),
		);

		fireEvent.click(toggle);

		await waitFor(() =>
			expect(mocks.updateTeam).toHaveBeenCalledWith("team-1", {
				time_tracking_enabled: true,
			}),
		);
		await waitFor(() =>
			expect(mocks.toast.success).toHaveBeenCalledWith(
				"Add-on settings updated.",
			),
		);
		const keys = keyCalls(invalidate.mock.calls);
		expect(keys).toContainEqual(["teams", "team-1"]);
		expect(keys).toContainEqual(["teams", "detail", "team-1"]);
		expect(keys).toContainEqual(["team", "team-1"]);
		expect(keys).toContainEqual(["teams", "mine"]);
		// invalidateTime(qc, "policy") includes the team's For option.
		expect(keys.some((key) => key?.[0] === "time")).toBe(true);
	});

	it("a plan refusal leaves the prompt to the global notifier", async () => {
		mocks.updateTeam.mockRejectedValueOnce(
			new PlanLimitError({
				limitKey: "time_tracking",
				kind: "feature",
				label: "Time tracking",
				limit: null,
				used: null,
				plan: "free",
				upgradePlan: "pro",
				workspaceId: "w1",
				workspaceSlug: null,
				context: null,
				message: "",
			}),
		);
		renderPage();
		const toggle = await screen.findByRole("checkbox");
		await waitFor(() =>
			expect((toggle as HTMLInputElement).disabled).toBe(false),
		);
		fireEvent.click(toggle);

		await waitFor(() => expect(mocks.updateTeam).toHaveBeenCalled());
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(mocks.toast.error).not.toHaveBeenCalled();
	});

	it("any other failure is toasted", async () => {
		mocks.updateTeam.mockRejectedValueOnce(new Error("Network down"));
		renderPage();
		const toggle = await screen.findByRole("checkbox");
		await waitFor(() =>
			expect((toggle as HTMLInputElement).disabled).toBe(false),
		);
		fireEvent.click(toggle);

		await waitFor(() =>
			expect(mocks.toast.error).toHaveBeenCalledWith("Network down"),
		);
	});

	it("after a downgrade (time on, plan without it) it says the downgrade sentence", async () => {
		mocks.hasTimeTracking = false;
		mocks.getTeam.mockResolvedValue(team({ time_tracking_enabled: true }));
		renderPage();

		expect(
			await screen.findByText(
				"Acme's plan no longer includes timesheets. Your existing time is safe, and open timesheets can still be decided.",
			),
		).toBeTruthy();
		expect(screen.queryByText(/Upgrade Acme/)).toBeNull();
		expect(screen.queryByText("Existing time stays readable.")).toBeNull();
		// Turning it off is never gated.
		expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(
			false,
		);
	});

	it("time off and the plan lacks it: the upgrade sentence, and the switch is locked", async () => {
		mocks.hasTimeTracking = false;
		renderPage();

		expect(
			await screen.findByText(
				"Timesheets and approvals are part of Pro. Upgrade Acme to send time for approval.",
			),
		).toBeTruthy();
		expect(screen.queryByText(/no longer includes timesheets/)).toBeNull();
		await waitFor(() =>
			expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(
				true,
			),
		);
	});
});
