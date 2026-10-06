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
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceEntitlements } from "@/lib/entitlements";

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

const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));

const ents = vi.hoisted(() => ({ features: {} as Record<string, boolean> }));
vi.mock("@/hooks/useEntitlements", () => ({
	useEntitlements: (): WorkspaceEntitlements =>
		({
			status: "ready",
			usage: { workspace_id: "w1", features: [] },
			plan: "pro",
			planName: "Pro",
			planSource: null,
			isComplimentary: false,
			limits: null,
			upgradePlan: null,
			usedFor: () => null,
			meter: () => null,
			remaining: () => null,
			canCreate: () => true,
			hasFeature: (key: string) => ents.features[key] ?? true,
		}) as unknown as WorkspaceEntitlements,
}));

const teams = vi.hoisted(() => ({ updateTeam: vi.fn() }));
vi.mock("@/services/teams.service", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/services/teams.service")>();
	return { ...actual, updateTeam: teams.updateTeam };
});

import { PlanLimitError } from "@/lib/planLimitErrors";
import type { Team } from "@/services/teams.service";
import { TEAM_MONEY_COPY, TeamMoneySection } from "./TeamMoneySection";

type MoneyTeam = Parameters<typeof TeamMoneySection>[0]["team"];

function team(over: Partial<MoneyTeam> = {}): MoneyTeam {
	return {
		id: "t1",
		member_rates_enabled: false,
		payouts_enabled: false,
		default_currency: "PHP",
		pay_period_config: null,
		...over,
	};
}

let client: QueryClient;

beforeEach(() => {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	ents.features = {};
	teams.updateTeam.mockImplementation(
		async (_id: string, patch: Partial<Team>) =>
			({ ...team(), ...patch }) as Team,
	);
});

afterEach(() => {
	cleanup();
	client.clear();
	vi.clearAllMocks();
});

function renderMoney(
	props: Partial<Parameters<typeof TeamMoneySection>[0]> = {},
) {
	return render(
		<QueryClientProvider client={client}>
			<TeamMoneySection
				team={team()}
				isOwner
				workspace={{
					id: "w1",
					name: "Acme",
					slug: "acme",
					my_role: "owner",
				}}
				workspaceSlug="acme"
				{...props}
			/>
		</QueryClientProvider>,
	);
}

function toggle(name: string): HTMLButtonElement {
	return screen.getByRole("switch", { name }) as HTMLButtonElement;
}

describe("TeamMoneySection", () => {
	it("the owner turns member rates on", async () => {
		renderMoney();
		expect(screen.getByText(TEAM_MONEY_COPY.ratesOff)).toBeTruthy();
		fireEvent.click(toggle(TEAM_MONEY_COPY.rates));
		await waitFor(() =>
			expect(teams.updateTeam).toHaveBeenCalledWith("t1", {
				member_rates_enabled: true,
			}),
		);
		expect(toast.success).toHaveBeenCalledWith(TEAM_MONEY_COPY.ratesEnabled);
	});

	it("rates on: Manage rates links to the team's rates page", () => {
		renderMoney({ team: team({ member_rates_enabled: true }) });
		const link = screen.getByRole("link", {
			name: TEAM_MONEY_COPY.manageRates,
		});
		expect(link.getAttribute("href")).toBe(
			"/w/acme/teams/t1/time/manage-rates",
		);
	});

	it("payouts sit under member rates", () => {
		renderMoney();
		expect(toggle(TEAM_MONEY_COPY.payouts).disabled).toBe(true);
		expect(screen.getByText(TEAM_MONEY_COPY.payoutsNeedRates)).toBeTruthy();
		expect(screen.getByText(TEAM_MONEY_COPY.payoutsNested)).toBeTruthy();
	});

	it("payouts turn on with time_payouts", async () => {
		renderMoney({ team: team({ member_rates_enabled: true }) });
		const payouts = toggle(TEAM_MONEY_COPY.payouts);
		expect(payouts.disabled).toBe(false);
		fireEvent.click(payouts);
		await waitFor(() =>
			expect(teams.updateTeam).toHaveBeenCalledWith("t1", {
				payouts_enabled: true,
			}),
		);
		expect(screen.queryByText("Payouts are part of Business.")).toBeNull();
	});

	it("without time_payouts, payouts can't turn on and the notice names Business", () => {
		ents.features = { time_payouts: false };
		renderMoney({ team: team({ member_rates_enabled: true }) });
		expect(toggle(TEAM_MONEY_COPY.payouts).disabled).toBe(true);
		expect(screen.getByText("Payouts are part of Business.")).toBeTruthy();
	});

	it("a team that already pays can still turn payouts off on a smaller plan", async () => {
		ents.features = { time_payouts: false };
		renderMoney({
			team: team({ member_rates_enabled: true, payouts_enabled: true }),
		});
		const payouts = toggle(TEAM_MONEY_COPY.payouts);
		expect(payouts.disabled).toBe(false);
		fireEvent.click(payouts);
		await waitFor(() =>
			expect(teams.updateTeam).toHaveBeenCalledWith("t1", {
				payouts_enabled: false,
			}),
		);
	});

	it("the cut-off card is renamed and the owner edits it with either plan feature", () => {
		ents.features = { time_billable_invoices: true, time_payouts: false };
		renderMoney();
		const card = screen.getByTestId("pay-period-settings");
		expect(within(card).getByText("Billing and pay cut-offs")).toBeTruthy();
		expect(within(card).queryByText(/Payout cut-offs/)).toBeNull();
		expect(
			within(card).getByRole("button", { name: "Save cut-offs" }),
		).toBeTruthy();
		expect(
			within(card).queryByText(
				"Billing and pay cut-offs are part of Pro (billing) or Business (payouts).",
			),
		).toBeNull();
	});

	it("without billing or payouts the cut-offs read only behind the plan notice", () => {
		ents.features = { time_billable_invoices: false, time_payouts: false };
		renderMoney();
		const card = screen.getByTestId("pay-period-settings");
		expect(
			within(card).getByText(
				"Billing and pay cut-offs are part of Pro (billing) or Business (payouts).",
			),
		).toBeTruthy();
		expect(
			within(card).queryByRole("button", { name: "Save cut-offs" }),
		).toBeNull();
		expect(
			within(card).queryByRole("button", { name: "Reset to default" }),
		).toBeNull();
		expect(
			within(card).queryByRole("button", { name: "Add period" }),
		).toBeNull();
		for (const input of within(card).getAllByRole("spinbutton")) {
			expect((input as HTMLInputElement).disabled).toBe(true);
		}
	});

	it("saving the cut-offs writes the schedule", async () => {
		renderMoney();
		const card = screen.getByTestId("pay-period-settings");
		fireEvent.click(
			within(card).getByRole("button", { name: "Save cut-offs" }),
		);
		await waitFor(() =>
			expect(teams.updateTeam).toHaveBeenCalledWith(
				"t1",
				expect.objectContaining({
					pay_period_config: expect.objectContaining({ cadence: "monthly" }),
				}),
			),
		);
		expect(toast.success).toHaveBeenCalledWith("Cut-offs saved");
	});

	it("a plan refusal on the cut-offs leaves the prompt to the global notifier", async () => {
		teams.updateTeam.mockRejectedValueOnce(
			new PlanLimitError({
				limitKey: "time_billable_invoices",
				kind: "feature",
				label: "Billable hours on invoices",
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
		renderMoney();
		fireEvent.click(screen.getByRole("button", { name: "Save cut-offs" }));
		await waitFor(() => expect(teams.updateTeam).toHaveBeenCalled());
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(toast.error).not.toHaveBeenCalled();
	});

	it("the owner sets the default currency", async () => {
		renderMoney();
		const group = screen.getByRole("radiogroup", {
			name: TEAM_MONEY_COPY.currency,
		});
		expect(
			within(group)
				.getByRole("radio", { name: "PHP" })
				.getAttribute("aria-checked"),
		).toBe("true");
		fireEvent.click(within(group).getByRole("radio", { name: "CAD" }));
		await waitFor(() =>
			expect(teams.updateTeam).toHaveBeenCalledWith("t1", {
				default_currency: "CAD",
			}),
		);
		expect(toast.success).toHaveBeenCalledWith("Default currency set to CAD");
	});

	it("a team admin reads the money settings but can't change them", () => {
		renderMoney({
			isOwner: false,
			team: team({ member_rates_enabled: true, payouts_enabled: true }),
		});
		expect(toggle(TEAM_MONEY_COPY.rates).disabled).toBe(true);
		expect(toggle(TEAM_MONEY_COPY.payouts).disabled).toBe(true);
		expect(screen.queryByRole("button", { name: "Save cut-offs" })).toBeNull();
		for (const radio of screen.getAllByRole("radio")) {
			expect((radio as HTMLButtonElement).disabled).toBe(true);
		}
		expect(screen.getByTestId("team-money-owner-only").textContent).toBe(
			TEAM_MONEY_COPY.ownerOnly,
		);
	});

	it("an owner-only refusal reads in people words, never column names", async () => {
		teams.updateTeam.mockRejectedValueOnce(
			new Error("Only the team owner can change: member_rates_enabled"),
		);
		renderMoney();
		fireEvent.click(toggle(TEAM_MONEY_COPY.rates));
		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith(TEAM_MONEY_COPY.ownerOnly),
		);
	});

	it("any other refusal shows the server's sentence", async () => {
		teams.updateTeam.mockRejectedValueOnce(
			new Error(
				"Enable member rates before turning on payouts — a payout is priced from each member's rate.",
			),
		);
		renderMoney({ team: team({ member_rates_enabled: true }) });
		fireEvent.click(toggle(TEAM_MONEY_COPY.payouts));
		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith(
				"Enable member rates before turning on payouts — a payout is priced from each member's rate.",
			),
		);
	});
});
