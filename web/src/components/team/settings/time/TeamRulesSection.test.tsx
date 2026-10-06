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

const ents = vi.hoisted(() => ({
	features: {} as Record<string, boolean>,
	known: true,
}));
vi.mock("@/hooks/useEntitlements", () => ({
	useEntitlements: (): WorkspaceEntitlements =>
		({
			status: ents.known ? "ready" : "loading",
			usage: ents.known
				? { workspace_id: "w1", features: [] }
				: (null as never),
			plan: ents.known ? "pro" : null,
			planName: null,
			planSource: null,
			isComplimentary: false,
			limits: null,
			upgradePlan: null,
			usedFor: () => null,
			meter: () => null,
			remaining: () => null,
			canCreate: () => true,
			hasFeature: (key: string) =>
				ents.known ? (ents.features[key] ?? true) : true,
		}) as unknown as WorkspaceEntitlements,
}));

import { TimeApiError, timeService } from "@/services/time.service";
import type {
	ResolvedTimePolicy,
	TeamPolicyOverride,
	TeamPolicyView,
} from "@/services/time.types";
import {
	appliesFromCopy,
	hasStoredRules,
	manualSummary,
	nextPeriodStart,
	overrideIsEmptyAfter,
	periodSummary,
	retroSummary,
	roundingSummary,
	savedRulesCopy,
	storedPeriod,
	TEAM_RULES_COPY,
	TeamRulesSection,
	teamRulesPlanInfo,
} from "./TeamRulesSection";

const NOW = new Date("2026-10-06T03:00:00.000Z"); // Tue Oct 6 in Manila
const WORKSPACE = {
	id: "w1",
	name: "Prodigitality Workspace",
	slug: "prodigitality",
	my_role: "owner" as const,
};

const SOURCES = {
	tracking_enabled: "workspace",
	period_kind: "workspace",
	week_start: "workspace",
	timezone: "workspace",
	period_anchor: "default",
	approval_required: "workspace",
	approver_scope: "default",
	allow_manual_entries: "workspace",
	retroactive_days: "default",
	rounding_minutes: "workspace",
	weekly_limit_minutes: "default",
	reminder_days: "workspace",
	hidden_presets: "workspace",
	tracking_mode: "default",
} as const;

function policy(over: Partial<ResolvedTimePolicy> = {}): ResolvedTimePolicy {
	return {
		tracking_enabled: true,
		period_kind: "weekly",
		week_start: 1,
		timezone: "Asia/Manila",
		period_anchor: null,
		approval_required: true,
		approver_scope: "workspace",
		allow_manual_entries: true,
		retroactive_days: null,
		rounding_minutes: 0,
		weekly_limit_minutes: null,
		reminder_days: 1,
		hidden_presets: [],
		tracking_mode: null,
		sources: { ...SOURCES },
		plan: { time_tracking: true, time_team_rules: true },
		policy_workspace_id: "w1",
		team_override_applied: false,
		member: null,
		client_hours_detail_level: null,
		...over,
	};
}

function override(over: Partial<TeamPolicyOverride> = {}): TeamPolicyOverride {
	return {
		id: "p1",
		team_id: "t1",
		period_kind: null,
		week_start: null,
		timezone: null,
		period_anchor: null,
		approval_required: null,
		approver_scope: null,
		allow_manual_entries: null,
		retroactive_days: null,
		rounding_minutes: null,
		weekly_limit_minutes: null,
		reminder_days: null,
		...over,
	};
}

function view(over: Partial<TeamPolicyView> = {}): TeamPolicyView {
	return {
		team_id: "t1",
		override: null,
		effective: policy(),
		can_edit_money_fields: true,
		has_team_rules: true,
		...over,
	};
}

let client: QueryClient;

beforeEach(() => {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	ents.features = {};
	ents.known = true;
});

afterEach(() => {
	cleanup();
	client.clear();
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

function renderSection(
	props: Partial<Parameters<typeof TeamRulesSection>[0]> = {},
) {
	return render(
		<QueryClientProvider client={client}>
			<TeamRulesSection
				teamId="t1"
				workspace={WORKSPACE}
				memberRatesEnabled={false}
				now={NOW}
				{...props}
			/>
		</QueryClientProvider>,
	);
}

function row(id: string): HTMLElement {
	const el = document.querySelector<HTMLElement>(`[data-row="${id}"]`);
	if (!el) throw new Error(`row ${id} not found`);
	return el;
}

function rowButton(id: string, name: string): HTMLButtonElement | null {
	return within(row(id)).queryByRole("button", {
		name,
	}) as HTMLButtonElement | null;
}

// ── Pure helpers ────────────────────────────────────────────────────────────

describe("summaries", () => {
	it("periodSummary: weekday only for weekly kinds", () => {
		expect(
			periodSummary({
				period_kind: "weekly",
				week_start: 1,
				timezone: "Asia/Manila",
			}),
		).toBe("Weekly · Mon · Asia/Manila");
		expect(
			periodSummary({
				period_kind: "biweekly",
				week_start: 7,
				timezone: "UTC",
			}),
		).toBe("Every two weeks · Sun · UTC");
		expect(
			periodSummary({
				period_kind: "semi_monthly",
				week_start: 1,
				timezone: "Asia/Manila",
			}),
		).toBe("Twice a month · Asia/Manila");
	});

	it("manual, retroactive and rounding phrases", () => {
		expect(manualSummary(true)).toBe("allowed");
		expect(manualSummary(false)).toBe("off");
		expect(retroSummary(null)).toBe("no limit");
		expect(retroSummary(0)).toBe("no limit");
		expect(retroSummary(1)).toBe("up to 1 day back");
		expect(retroSummary(7)).toBe("up to 7 days back");
		expect(roundingSummary(0)).toBe("none");
		expect(roundingSummary(15)).toBe("15 min");
	});

	it("savedRulesCopy and appliesFromCopy follow ux.md", () => {
		expect(savedRulesCopy("Acme")).toBe(
			"Saved rules apply again when Acme is on Business.",
		);
		expect(appliesFromCopy("Mon Oct 6")).toBe(
			"Applies from Mon Oct 6. Open timesheets keep their dates.",
		);
	});
});

describe("override helpers", () => {
	it("overrideIsEmptyAfter: every stored field null once the patch lands", () => {
		const stored = override({ period_kind: "monthly", timezone: "UTC" });
		expect(
			overrideIsEmptyAfter(stored, {
				period_kind: null,
				week_start: null,
				timezone: null,
				period_anchor: null,
			}),
		).toBe(true);
		expect(overrideIsEmptyAfter(stored, { period_kind: null })).toBe(false);
		// A field with no UI here (weekly limit) still counts as a rule.
		expect(
			overrideIsEmptyAfter(
				override({ weekly_limit_minutes: 2400, rounding_minutes: 15 }),
				{ rounding_minutes: null },
			),
		).toBe(false);
		expect(overrideIsEmptyAfter(null, {})).toBe(true);
	});

	it("hasStoredRules ignores an all-inherit row", () => {
		expect(hasStoredRules(null)).toBe(false);
		expect(hasStoredRules(override())).toBe(false);
		expect(hasStoredRules(override({ approver_scope: "team" }))).toBe(true);
	});

	it("storedPeriod fills a partial override from the effective policy", () => {
		const eff = policy({ period_kind: "weekly", week_start: 1 });
		expect(storedPeriod(override(), eff)).toBeNull();
		expect(storedPeriod(override({ timezone: "UTC" }), eff)).toEqual({
			period_kind: "weekly",
			week_start: 1,
			timezone: "UTC",
		});
	});

	it("nextPeriodStart is the day after the current period, in the policy timezone", () => {
		expect(nextPeriodStart(policy(), NOW)).toBe("2026-10-12");
		expect(nextPeriodStart(policy({ period_kind: "monthly" }), NOW)).toBe(
			"2026-11-01",
		);
		expect(nextPeriodStart(policy({ period_kind: "semi_monthly" }), NOW)).toBe(
			"2026-10-16",
		);
	});

	it("teamRulesPlanInfo: the server decides, the usage only shapes the notice", () => {
		const known = {
			usage: { workspace_id: "w1", features: [] },
			plan: "pro",
			upgradePlan: null,
			hasFeature: () => false,
		} as unknown as WorkspaceEntitlements;
		expect(teamRulesPlanInfo(known, true)).toBeNull();
		expect(teamRulesPlanInfo(known, false)).toMatchObject({
			limitKey: "time_team_rules",
			kind: "feature",
			plan: "pro",
			upgradePlan: "business",
		});
		// Usage unknown (or stale, saying yes): still gated, Business named.
		const unknown = {
			usage: null,
			plan: null,
			hasFeature: () => true,
		} as unknown as WorkspaceEntitlements;
		expect(teamRulesPlanInfo(unknown, false)).toMatchObject({
			limitKey: "time_team_rules",
			upgradePlan: "business",
		});
	});
});

// ── Component ───────────────────────────────────────────────────────────────

describe("TeamRulesSection", () => {
	it("renders nothing for a non-manager (the GET is a 404)", async () => {
		vi.spyOn(timeService, "getTeamPolicy").mockRejectedValue(
			new TimeApiError({ status: 404, code: "HTTP_404", message: "Not found" }),
		);
		const { container } = renderSection();
		await waitFor(() =>
			expect(screen.queryByTestId("team-rules-loading")).toBeNull(),
		);
		expect(container.textContent).toBe("");
	});

	it("inherited rows read the workspace policy; approvers default to the workspace", async () => {
		vi.spyOn(timeService, "getTeamPolicy").mockResolvedValue(view());
		renderSection();
		await screen.findByTestId("team-rules");
		expect(screen.getByText(TEAM_RULES_COPY.tier)).toBeTruthy();
		expect(
			within(row("team-rule-period")).getByTestId("override-row-state")
				.textContent,
		).toBe("Use Prodigitality Workspace's policy (Weekly · Mon · Asia/Manila)");
		expect(
			within(row("team-rule-manual")).getByTestId("override-row-state")
				.textContent,
		).toBe("Use Prodigitality Workspace's policy (allowed)");
		expect(
			within(row("team-rule-retro")).getByTestId("override-row-state")
				.textContent,
		).toBe("Use Prodigitality Workspace's policy (no limit)");
		expect(
			within(row("team-rule-rounding")).getByTestId("override-row-state")
				.textContent,
		).toBe("Use Prodigitality Workspace's policy (none)");
		expect(
			within(row("team-rule-approval")).getByTestId("override-row-state")
				.textContent,
		).toBe("Use Prodigitality Workspace's policy (required)");
		const workspaceRadio = screen.getByRole("radio", {
			name: TEAM_RULES_COPY.approversWorkspace,
		}) as HTMLInputElement;
		expect(workspaceRadio.checked).toBe(true);
		expect(screen.queryByTestId("team-rules-owner-only")).toBeNull();
	});

	it("Override → change → Save writes only that field and the row turns overridden", async () => {
		const after = view({
			override: override({ allow_manual_entries: false }),
			effective: policy({
				allow_manual_entries: false,
				sources: { ...SOURCES, allow_manual_entries: "team" },
				team_override_applied: true,
			}),
		});
		// The first read, then the refetch the policy invalidation triggers.
		vi.spyOn(timeService, "getTeamPolicy")
			.mockResolvedValueOnce(view())
			.mockResolvedValue(after);
		const put = vi
			.spyOn(timeService, "updateTeamPolicy")
			.mockResolvedValue(after);
		renderSection();
		await screen.findByTestId("team-rules");
		fireEvent.click(rowButton("team-rule-manual", "Override") as HTMLElement);
		const toggle = within(row("team-rule-manual")).getByRole("switch", {
			name: TEAM_RULES_COPY.manual,
		});
		fireEvent.click(toggle);
		fireEvent.click(rowButton("team-rule-manual", "Save") as HTMLElement);
		await waitFor(() =>
			expect(put).toHaveBeenCalledWith("t1", { allow_manual_entries: false }),
		);
		await waitFor(() =>
			expect(row("team-rule-manual").getAttribute("data-state")).toBe(
				"overridden",
			),
		);
		expect(toast.success).toHaveBeenCalledWith(TEAM_RULES_COPY.saved);
		expect(
			within(row("team-rule-manual")).getByTestId("override-row-state")
				.textContent,
		).toBe("Override for this team");
	});

	it("Cancel closes a new override without writing", async () => {
		vi.spyOn(timeService, "getTeamPolicy").mockResolvedValue(view());
		const put = vi.spyOn(timeService, "updateTeamPolicy");
		renderSection();
		await screen.findByTestId("team-rules");
		fireEvent.click(rowButton("team-rule-rounding", "Override") as HTMLElement);
		expect(row("team-rule-rounding").getAttribute("data-state")).toBe(
			"editing",
		);
		fireEvent.click(rowButton("team-rule-rounding", "Cancel") as HTMLElement);
		expect(row("team-rule-rounding").getAttribute("data-state")).toBe(
			"inherited",
		);
		expect(put).not.toHaveBeenCalled();
	});

	it("a period change says when it applies, and saves kind, week start and timezone", async () => {
		vi.spyOn(timeService, "getTeamPolicy").mockResolvedValue(view());
		const put = vi
			.spyOn(timeService, "updateTeamPolicy")
			.mockResolvedValue(view());
		renderSection();
		await screen.findByTestId("team-rules");
		fireEvent.click(rowButton("team-rule-period", "Override") as HTMLElement);
		fireEvent.click(screen.getByRole("radio", { name: "Every two weeks" }));
		expect(
			within(row("team-rule-period")).getByTestId("override-row-hint")
				.textContent,
		).toBe("Applies from Mon Oct 12. Open timesheets keep their dates.");
		fireEvent.click(rowButton("team-rule-period", "Save") as HTMLElement);
		await waitFor(() =>
			expect(put).toHaveBeenCalledWith("t1", {
				period_kind: "biweekly",
				week_start: 1,
				timezone: "Asia/Manila",
			}),
		);
	});

	it("the owner dropping the last override removes the team's rules (DELETE)", async () => {
		vi.spyOn(timeService, "getTeamPolicy")
			.mockResolvedValueOnce(
				view({
					override: override({ period_kind: "monthly" }),
					effective: policy({
						period_kind: "monthly",
						sources: { ...SOURCES, period_kind: "team" },
						team_override_applied: true,
					}),
				}),
			)
			.mockResolvedValue(view());
		const put = vi.spyOn(timeService, "updateTeamPolicy");
		const del = vi
			.spyOn(timeService, "deleteTeamPolicy")
			.mockResolvedValue(view());
		renderSection();
		await screen.findByTestId("team-rules");
		expect(row("team-rule-period").getAttribute("data-state")).toBe(
			"overridden",
		);
		fireEvent.click(
			rowButton("team-rule-period", "Use workspace policy") as HTMLElement,
		);
		await waitFor(() => expect(del).toHaveBeenCalledWith("t1"));
		expect(put).not.toHaveBeenCalled();
		await waitFor(() =>
			expect(row("team-rule-period").getAttribute("data-state")).toBe(
				"inherited",
			),
		);
	});

	it("resetting one of several overrides clears just that field (PUT null)", async () => {
		vi.spyOn(timeService, "getTeamPolicy").mockResolvedValue(
			view({
				override: override({ rounding_minutes: 15, approver_scope: "team" }),
				effective: policy({
					rounding_minutes: 15,
					approver_scope: "team",
					team_override_applied: true,
				}),
			}),
		);
		const put = vi
			.spyOn(timeService, "updateTeamPolicy")
			.mockResolvedValue(view());
		const del = vi.spyOn(timeService, "deleteTeamPolicy");
		renderSection();
		await screen.findByTestId("team-rules");
		fireEvent.click(
			rowButton("team-rule-rounding", "Use workspace policy") as HTMLElement,
		);
		await waitFor(() =>
			expect(put).toHaveBeenCalledWith("t1", { rounding_minutes: null }),
		);
		expect(del).not.toHaveBeenCalled();
	});

	it("approvers: choosing the team writes approver_scope 'team'", async () => {
		vi.spyOn(timeService, "getTeamPolicy").mockResolvedValue(view());
		const put = vi
			.spyOn(timeService, "updateTeamPolicy")
			.mockResolvedValue(view());
		renderSection();
		await screen.findByTestId("team-rules");
		fireEvent.click(
			screen.getByRole("radio", { name: TEAM_RULES_COPY.approversTeam }),
		);
		await waitFor(() =>
			expect(put).toHaveBeenCalledWith("t1", { approver_scope: "team" }),
		);
	});

	it("approvers: back to the workspace as the only rule deletes the override", async () => {
		vi.spyOn(timeService, "getTeamPolicy").mockResolvedValue(
			view({
				override: override({ approver_scope: "team" }),
				effective: policy({
					approver_scope: "team",
					team_override_applied: true,
				}),
			}),
		);
		const del = vi
			.spyOn(timeService, "deleteTeamPolicy")
			.mockResolvedValue(view());
		renderSection();
		await screen.findByTestId("team-rules");
		expect(
			(
				screen.getByRole("radio", {
					name: TEAM_RULES_COPY.approversTeam,
				}) as HTMLInputElement
			).checked,
		).toBe(true);
		fireEvent.click(
			screen.getByRole("radio", { name: TEAM_RULES_COPY.approversWorkspace }),
		);
		await waitFor(() => expect(del).toHaveBeenCalledWith("t1"));
	});

	it("a team admin changes period and manual time only (D62)", async () => {
		vi.spyOn(timeService, "getTeamPolicy").mockResolvedValue(
			view({
				can_edit_money_fields: false,
				override: override({ period_kind: "monthly" }),
				effective: policy({
					period_kind: "monthly",
					sources: { ...SOURCES, period_kind: "team" },
					team_override_applied: true,
				}),
			}),
		);
		const put = vi
			.spyOn(timeService, "updateTeamPolicy")
			.mockResolvedValue(view({ can_edit_money_fields: false }));
		const del = vi.spyOn(timeService, "deleteTeamPolicy");
		renderSection();
		await screen.findByTestId("team-rules");
		expect(rowButton("team-rule-manual", "Override")).toBeTruthy();
		expect(rowButton("team-rule-retro", "Override")).toBeNull();
		expect(rowButton("team-rule-rounding", "Override")).toBeNull();
		expect(rowButton("team-rule-approval", "Override")).toBeNull();
		for (const radio of screen.getAllByRole("radio", {
			name: /owners and admins/,
		})) {
			expect((radio as HTMLInputElement).disabled).toBe(true);
		}
		expect(screen.getByTestId("team-rules-owner-only").textContent).toBe(
			TEAM_RULES_COPY.ownerOnly,
		);
		// An admin can't delete, so even the last reset is a PUT.
		fireEvent.click(
			rowButton("team-rule-period", "Use workspace policy") as HTMLElement,
		);
		await waitFor(() =>
			expect(put).toHaveBeenCalledWith("t1", {
				period_kind: null,
				week_start: null,
				timezone: null,
				period_anchor: null,
			}),
		);
		expect(del).not.toHaveBeenCalled();
	});

	it("without Business the rules read only behind the plan notice, and saved rules are kept", async () => {
		ents.features = { time_team_rules: false };
		vi.spyOn(timeService, "getTeamPolicy").mockResolvedValue(
			view({
				has_team_rules: false,
				override: override({ approver_scope: "team", rounding_minutes: 15 }),
			}),
		);
		renderSection();
		await screen.findByTestId("team-rules");
		expect(
			screen.getByText(
				"Team approvers and team time rules are part of Business.",
			),
		).toBeTruthy();
		expect(
			screen.getByText(
				"Saved rules apply again when Prodigitality Workspace is on Business.",
			),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Override" })).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Use workspace policy" }),
		).toBeNull();
		expect(row("team-rule-rounding").getAttribute("data-state")).toBe(
			"overridden",
		);
		expect(
			(
				screen.getByRole("radio", {
					name: TEAM_RULES_COPY.approversTeam,
				}) as HTMLInputElement
			).disabled,
		).toBe(true);
		// The notice is not an admin-only note.
		expect(screen.queryByTestId("team-rules-owner-only")).toBeNull();
	});

	it("without Business and nothing stored, the notice has no saved-rules line", async () => {
		ents.features = { time_team_rules: false };
		vi.spyOn(timeService, "getTeamPolicy").mockResolvedValue(
			view({ has_team_rules: false }),
		);
		renderSection();
		await screen.findByTestId("team-rules");
		expect(screen.queryByText(/Saved rules apply again/)).toBeNull();
	});

	it("approval stays on while member rates are on (L23)", async () => {
		vi.spyOn(timeService, "getTeamPolicy").mockResolvedValue(view());
		renderSection({ memberRatesEnabled: true });
		await screen.findByTestId("team-rules");
		const locked = screen.getByTestId("approval-locked-row");
		expect(
			within(locked).getByText(TEAM_RULES_COPY.approvalStaysOn),
		).toBeTruthy();
		const toggle = within(locked).getByRole("switch") as HTMLButtonElement;
		expect(toggle.disabled).toBe(true);
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		expect(
			document.querySelector('[data-row="team-rule-approval"]'),
		).toBeNull();
	});

	it("a refused write shows the ux.md copy, never the raw error", async () => {
		vi.spyOn(timeService, "getTeamPolicy").mockResolvedValue(view());
		vi.spyOn(timeService, "updateTeamPolicy").mockRejectedValue(
			new TimeApiError({
				status: 422,
				code: "TEAM_RATES_REQUIRE_APPROVAL",
				message: "Approval stays on while member rates are on.",
			}),
		);
		renderSection();
		await screen.findByTestId("team-rules");
		fireEvent.click(rowButton("team-rule-approval", "Override") as HTMLElement);
		fireEvent.click(
			within(row("team-rule-approval")).getByRole("switch", {
				name: TEAM_RULES_COPY.approval,
			}),
		);
		fireEvent.click(rowButton("team-rule-approval", "Save") as HTMLElement);
		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith(
				"Approval stays on while member rates are on.",
			),
		);
		// The draft stays open for another try.
		expect(row("team-rule-approval").getAttribute("data-state")).toBe(
			"editing",
		);
	});

	it("an owner-only refusal reads in people words", async () => {
		vi.spyOn(timeService, "getTeamPolicy").mockResolvedValue(view());
		vi.spyOn(timeService, "updateTeamPolicy").mockRejectedValue(
			new TimeApiError({
				status: 403,
				code: "HTTP_403",
				message: "Only the team owner can change: rounding_minutes",
			}),
		);
		renderSection();
		await screen.findByTestId("team-rules");
		fireEvent.click(rowButton("team-rule-rounding", "Override") as HTMLElement);
		fireEvent.click(rowButton("team-rule-rounding", "Save") as HTMLElement);
		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith(
				"Only the team owner can change rounding.",
			),
		);
	});

	it("a plan refusal leaves the prompt to the global notifier", async () => {
		vi.spyOn(timeService, "getTeamPolicy").mockResolvedValue(view());
		vi.spyOn(timeService, "updateTeamPolicy").mockRejectedValue(
			new TimeApiError({
				status: 403,
				code: "plan_limit",
				message: "Upgrade",
				response: {
					status: 403,
					data: {
						error: {
							code: "plan_limit",
							limit_key: "time_team_rules",
							kind: "feature",
							plan: "pro",
							upgrade_plan: "business",
							message: "Upgrade",
						},
					},
				},
			}),
		);
		renderSection();
		await screen.findByTestId("team-rules");
		fireEvent.click(rowButton("team-rule-rounding", "Override") as HTMLElement);
		fireEvent.click(rowButton("team-rule-rounding", "Save") as HTMLElement);
		await waitFor(() =>
			expect(row("team-rule-rounding").getAttribute("data-state")).toBe(
				"editing",
			),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(toast.error).not.toHaveBeenCalled();
	});
});
