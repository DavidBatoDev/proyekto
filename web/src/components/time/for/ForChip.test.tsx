/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import { timeService } from "@/services/time.service";
import type { ResolvedTimePolicy } from "@/services/time.types";
import { ForChip } from "./ForChip";

function policy(over: Partial<ResolvedTimePolicy> = {}): ResolvedTimePolicy {
	return {
		tracking_enabled: true,
		period_kind: "weekly",
		week_start: 1,
		timezone: "Asia/Manila",
		period_anchor: null,
		approval_required: true,
		approver_scope: "team",
		allow_manual_entries: true,
		retroactive_days: 7,
		rounding_minutes: 0,
		weekly_limit_minutes: null,
		reminder_days: 1,
		hidden_presets: [],
		tracking_mode: null,
		sources: { approver_scope: "team", period_kind: "workspace" },
		plan: { time_tracking: true, time_team_rules: true },
		policy_workspace_id: "w",
		team_override_applied: true,
		member: null,
		client_hours_detail_level: null,
		...over,
	};
}

function renderWithClient(ui: ReactElement) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("ForChip", () => {
	it("shows the kind's icon and cuts the label at 22 characters with a tooltip", () => {
		renderWithClient(
			<ForChip
				option={{
					kind: "team",
					id: "t1",
					label: "Prodigitality Services Inc. Team",
				}}
				note="Only option on this project"
			/>,
		);
		expect(screen.getByText("Prodigitality Services…")).toBeTruthy();
		const chip = screen.getByTitle(
			"Prodigitality Services Inc. Team · Only option on this project",
		);
		expect(chip.querySelector('[data-icon="team"]')).not.toBeNull();
		// No project: nothing to open, so it is not a button.
		expect(screen.queryByRole("button")).toBeNull();
	});

	it.each([
		["workspace", "workspace"],
		["assignment", "agreement"],
		["personal", "personal"],
	] as const)("uses the %s icon", (kind, icon) => {
		const { container } = renderWithClient(
			<ForChip option={{ kind, id: null, label: "Label" }} />,
		);
		expect(container.querySelector(`[data-icon="${icon}"]`)).not.toBeNull();
	});

	it("shows the grey workspace tag only when the resolver sends one", () => {
		const { rerender } = renderWithClient(
			<ForChip option={{ kind: "team", id: "t1", label: "Design" }} />,
		);
		expect(screen.queryByTestId("for-workspace-tag")).toBeNull();
		rerender(
			<QueryClientProvider client={new QueryClient()}>
				<ForChip
					option={{
						kind: "team",
						id: "t1",
						label: "Design",
						workspace_tag: "Prodigitality",
					}}
				/>
			</QueryClientProvider>,
		);
		expect(screen.getByTestId("for-workspace-tag").textContent).toBe(
			"Prodigitality",
		);
	});

	it("locked: a lock and the withdraw hint", () => {
		const { container } = renderWithClient(
			<ForChip
				variant="locked"
				option={{ kind: "assignment", id: "a1", label: "Acme Corp" }}
				lockedText="Submitted Oct 6. Withdraw to change."
			/>,
		);
		expect(container.querySelector('[data-variant="locked"]')).not.toBeNull();
		expect(
			screen.getByText("Submitted Oct 6. Withdraw to change."),
		).toBeTruthy();
		expect(
			screen.getByTitle("Acme Corp · Submitted Oct 6. Withdraw to change."),
		).toBeTruthy();
	});

	it("menu: opens the caller's picker", () => {
		const onOpenMenu = vi.fn();
		renderWithClient(
			<ForChip
				variant="menu"
				showPrefix
				option={{ kind: "team", id: "t1", label: "Design" }}
				onOpenMenu={onOpenMenu}
				menuOpen={false}
			/>,
		);
		expect(screen.getByText("For:")).toBeTruthy();
		const button = screen.getByRole("button");
		expect(button.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(button);
		expect(onOpenMenu).toHaveBeenCalledTimes(1);
	});

	it("opens Who approves this time with the option's policy", async () => {
		const getPolicy = vi
			.spyOn(timeService, "getProjectPolicy")
			.mockResolvedValue(policy());
		renderWithClient(
			<ForChip
				projectId="p1"
				option={{
					kind: "team",
					id: "t1",
					label: "Prodigitality Services Inc. Team",
					approver_hint: "team",
				}}
			/>,
		);
		expect(getPolicy).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button"));
		expect(await screen.findByText("Who approves this time")).toBeTruthy();
		await waitFor(() =>
			expect(
				screen.getByText("Timesheet: weekly · starts Monday · Asia/Manila"),
			).toBeTruthy(),
		);
		expect(getPolicy).toHaveBeenCalledWith("p1", { kind: "team", id: "t1" });
		expect(
			screen.getByText(
				"Goes to: Prodigitality Services Inc. Team's owners and admins",
			),
		).toBeTruthy();
	});
});
