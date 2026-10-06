/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
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

import { TimeApiError, timeService } from "@/services/time.service";
import type {
	ResolvedTimePolicy,
	WorkspacePolicyView,
	WorkspaceTimeAdmin,
} from "@/services/time.types";
import {
	confirmTimeZone,
	PolicyConfirmCard,
	policyConfirmBody,
	policyConfirmSentence,
	policyPeriodPhrase,
	unconfirmedAdmins,
} from "./PolicyConfirmCard";

function policy(over: Partial<ResolvedTimePolicy> = {}): ResolvedTimePolicy {
	return {
		tracking_enabled: true,
		period_kind: "weekly",
		week_start: 1,
		timezone: "UTC",
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
		sources: {},
		plan: { time_tracking: true, time_team_rules: false },
		policy_workspace_id: "w1",
		team_override_applied: false,
		member: null,
		client_hours_detail_level: null,
		...over,
	};
}

function view(over: Partial<WorkspacePolicyView> = {}): WorkspacePolicyView {
	return {
		workspace_id: "w1",
		policy: policy(),
		policy_unconfirmed: true,
		can_edit: true,
		...over,
	};
}

function admin(over: Partial<WorkspaceTimeAdmin> = {}): WorkspaceTimeAdmin {
	return {
		workspace_id: "w1",
		name: "Acme",
		slug: "acme",
		has_time_tracking: true,
		policy_unconfirmed: true,
		...over,
	};
}

function withClient(children: ReactNode, client?: QueryClient) {
	const qc =
		client ??
		new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("policy confirm copy", () => {
	it("names the period the way ux.md does", () => {
		expect(policyPeriodPhrase({ period_kind: "weekly", week_start: 1 })).toBe(
			"weekly from Monday",
		);
		expect(policyPeriodPhrase({ period_kind: "biweekly", week_start: 7 })).toBe(
			"every two weeks from Sunday",
		);
		expect(
			policyPeriodPhrase({ period_kind: "semi_monthly", week_start: 1 }),
		).toBe("twice a month (1–15, 16–end)");
		expect(policyPeriodPhrase({ period_kind: "monthly", week_start: 1 })).toBe(
			"monthly",
		);
	});

	it("tracking on and tracking off sentences", () => {
		expect(policyConfirmSentence("Acme", policy(), "Asia/Manila")).toBe(
			"Acme tracks time weekly from Monday in Asia/Manila.",
		);
		expect(
			policyConfirmSentence(
				"Prodigitality Workspace",
				policy({ tracking_enabled: false }),
				"Asia/Manila",
			),
		).toBe(
			"Prodigitality Workspace has workspace time off. People who aren't on a team can only track time for themselves.",
		);
	});

	it("takes the timezone from the browser, else the policy's", () => {
		expect(confirmTimeZone(policy(), "Asia/Manila")).toBe("Asia/Manila");
		expect(confirmTimeZone(policy(), undefined)).toBe("UTC");
		expect(confirmTimeZone(policy(), "Not/AZone")).toBe("UTC");
	});

	it("Looks right sends the values shown, and only those", () => {
		expect(
			policyConfirmBody(
				policy({ period_kind: "biweekly", week_start: 3 }),
				"Asia/Manila",
			),
		).toEqual({
			confirm: true,
			tracking_enabled: true,
			period_kind: "biweekly",
			week_start: 3,
			timezone: "Asia/Manila",
		});
		expect(
			policyConfirmBody(policy({ tracking_enabled: false }), "Asia/Manila"),
		).toEqual({ confirm: true, tracking_enabled: false });
	});

	it("only unconfirmed workspaces with timesheets get a card", () => {
		expect(
			unconfirmedAdmins([
				admin(),
				admin({ workspace_id: "w2", policy_unconfirmed: false }),
				admin({ workspace_id: "w3", has_time_tracking: false }),
			]).map((item) => item.workspace_id),
		).toEqual(["w1"]);
	});
});

describe("PolicyConfirmCard", () => {
	it("reads the policy with the browser timezone and confirms it", async () => {
		const get = vi
			.spyOn(timeService, "getWorkspacePolicy")
			.mockResolvedValue(view());
		const put = vi
			.spyOn(timeService, "updateWorkspacePolicy")
			.mockResolvedValue(view({ policy_unconfirmed: false }));
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const invalidate = vi.spyOn(client, "invalidateQueries");
		render(
			withClient(
				<PolicyConfirmCard admins={[admin()]} timeZone="Asia/Manila" />,
				client,
			),
		);
		expect(screen.getByTestId("policy-confirm-loading")).toBeTruthy();
		expect(
			await screen.findByText(
				"Acme tracks time weekly from Monday in Asia/Manila.",
			),
		).toBeTruthy();
		expect(get).toHaveBeenCalledWith("w1", { tz: "Asia/Manila" });
		expect(
			screen.getByRole("link", { name: "Change" }).getAttribute("href"),
		).toBe("/w/acme/settings/time");

		fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
		await waitFor(() =>
			expect(screen.queryByTestId("policy-confirm-card")).toBeNull(),
		);
		expect(put).toHaveBeenCalledWith("w1", {
			confirm: true,
			tracking_enabled: true,
			period_kind: "weekly",
			week_start: 1,
			timezone: "Asia/Manila",
		});
		expect(invalidate).toHaveBeenCalledWith({
			queryKey: ["time", "me", "overview"],
		});
	});

	it("the tracking-off card sends only the switch", async () => {
		vi.spyOn(timeService, "getWorkspacePolicy").mockResolvedValue(
			view({ policy: policy({ tracking_enabled: false }) }),
		);
		const put = vi
			.spyOn(timeService, "updateWorkspacePolicy")
			.mockResolvedValue(view({ policy_unconfirmed: false }));
		render(
			withClient(
				<PolicyConfirmCard
					admins={[admin({ name: "Prodigitality Workspace" })]}
					timeZone="America/New_York"
				/>,
			),
		);
		expect(
			await screen.findByText(
				"Prodigitality Workspace has workspace time off. People who aren't on a team can only track time for themselves.",
			),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Looks right" }));
		await waitFor(() =>
			expect(put).toHaveBeenCalledWith("w1", {
				confirm: true,
				tracking_enabled: false,
			}),
		);
	});

	it("a failed save stays on the card with a reason", async () => {
		vi.spyOn(timeService, "getWorkspacePolicy").mockResolvedValue(view());
		vi.spyOn(timeService, "updateWorkspacePolicy").mockRejectedValue(
			new TimeApiError({
				status: 500,
				code: "TIME_INTERNAL",
				message: "boom",
			}),
		);
		render(
			withClient(
				<PolicyConfirmCard admins={[admin()]} timeZone="Asia/Manila" />,
			),
		);
		fireEvent.click(await screen.findByRole("button", { name: "Looks right" }));
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toMatch(/couldn't save/i);
		expect(screen.getByTestId("policy-confirm-card")).toBeTruthy();
	});

	it("shows nothing once confirmed elsewhere, read-only, or failing to load", async () => {
		const get = vi
			.spyOn(timeService, "getWorkspacePolicy")
			.mockResolvedValueOnce(view({ policy_unconfirmed: false }));
		const first = render(
			withClient(<PolicyConfirmCard admins={[admin()]} timeZone="UTC" />),
		);
		await waitFor(() => expect(get).toHaveBeenCalled());
		await waitFor(() =>
			expect(first.queryByTestId("policy-confirm-loading")).toBeNull(),
		);
		expect(first.queryByTestId("policy-confirm-card")).toBeNull();
		first.unmount();

		get.mockRejectedValueOnce(
			new TimeApiError({ status: 404, code: "TIME_NOT_FOUND", message: "x" }),
		);
		const second = render(
			withClient(<PolicyConfirmCard admins={[admin()]} timeZone="UTC" />),
		);
		await waitFor(() =>
			expect(second.queryByTestId("policy-confirm-loading")).toBeNull(),
		);
		expect(second.queryByTestId("policy-confirm-card")).toBeNull();
	});

	it("renders nothing without an unconfirmed workspace", () => {
		const get = vi.spyOn(timeService, "getWorkspacePolicy");
		const { container } = render(
			withClient(
				<PolicyConfirmCard admins={[admin({ policy_unconfirmed: false })]} />,
			),
		);
		expect(container.innerHTML).toBe("");
		expect(get).not.toHaveBeenCalled();
	});
});
