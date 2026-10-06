/* @vitest-environment jsdom */

/**
 * TeamTimeReport (W3-1b): the one team Report body behind Team › Time and
 * Finance › team › Time. The routes' own behaviour (gates, URL readers, the
 * `?log=` param) is covered in `routes/w/$workspaceSlug/teams/$teamId/time/teamTime.test.tsx`.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamMoneyAccess } from "@/components/team-time/useTeamMoneyAccess";
import { TimeApiError, timeService } from "@/services/time.service";
import type { TeamPolicyView, TimeEntryView } from "@/services/time.types";
import type { TimeReportProps } from "./TimeReport";

const TEAM = "22222222-2222-4222-8222-222222222222";
const ENTRY = "33333333-3333-4333-8333-333333333333";
const LEGACY = "44444444-4444-4444-8444-444444444444";
const PERSON = "55555555-5555-4555-8555-555555555555";

const mocks = vi.hoisted(() => ({
	access: null as unknown as TeamMoneyAccess,
	reportProps: null as TimeReportProps | null,
	modalProps: null as {
		entryId: string | null;
		entry?: unknown;
		mode?: string;
		timeZone?: string;
		onClose: () => void;
	} | null,
}));

vi.mock("@/components/team-time/useTeamMoneyAccess", () => ({
	useTeamMoneyAccess: () => mocks.access,
}));
vi.mock("./TimeReport", () => ({
	TimeReport: (props: TimeReportProps) => {
		mocks.reportProps = props;
		return <div data-testid="time-report" />;
	},
}));
vi.mock("../entries/TimeEntryDetailModal", () => ({
	TimeEntryDetailModal: (props: NonNullable<typeof mocks.modalProps>) => {
		mocks.modalProps = props;
		return props.entryId ? (
			<div role="dialog" aria-label="Entry">
				{props.entryId}
			</div>
		) : null;
	},
}));

import { TeamTimeReport, type TeamTimeReportProps } from "./TeamTimeReport";

function access(over: Partial<TeamMoneyAccess> = {}): TeamMoneyAccess {
	return {
		isLoading: false,
		error: null,
		team: { id: TEAM, pay_period_config: null } as TeamMoneyAccess["team"],
		isApprover: true,
		isTeamMember: true,
		timeTrackingEnabled: true,
		hasRates: true,
		canPay: true,
		planWorkspaceId: "ws-1",
		planWorkspace: {
			id: "ws-1",
			name: "Acme",
			slug: "acme",
			my_role: "owner",
		} as TeamMoneyAccess["planWorkspace"],
		isComplimentary: false,
		planStatus: "ready",
		payoutsPlanLimit: null,
		teamRulesPlanLimit: null,
		...over,
	};
}

let client: QueryClient;

beforeEach(() => {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	mocks.access = access();
	mocks.reportProps = null;
	mocks.modalProps = null;
	vi.spyOn(timeService, "getTeamPolicy").mockResolvedValue({
		team_id: TEAM,
		override: null,
		effective: { timezone: "America/New_York", week_start: 7 },
	} as unknown as TeamPolicyView);
});

afterEach(() => {
	cleanup();
	client.clear();
	vi.restoreAllMocks();
});

function renderReport(props: Partial<TeamTimeReportProps> = {}) {
	const onSearchChange = vi.fn();
	render(
		<QueryClientProvider client={client}>
			<TeamTimeReport
				teamId={TEAM}
				search={{ person: PERSON }}
				onSearchChange={onSearchChange}
				{...props}
			/>
		</QueryClientProvider>,
	);
	return { onSearchChange };
}

describe("TeamTimeReport", () => {
	it("waits for the team's policy, then reports on the team in its timezone", async () => {
		renderReport();
		expect(screen.getByRole("status").textContent).toBe("Loading");
		await screen.findByTestId("time-report");
		const props = mocks.reportProps as TimeReportProps;
		expect(props.scope).toEqual({ kind: "team", id: TEAM });
		expect(props.search).toEqual({ person: PERSON });
		expect(props.timezone).toBe("America/New_York");
		expect(props.weekStart).toBe(7);
		expect(props.planWorkspace).toEqual({
			id: "ws-1",
			name: "Acme",
			slug: "acme",
			my_role: "owner",
		});
		expect(props.cutoffs).toEqual({ config: null });
		expect(timeService.getTeamPolicy).toHaveBeenCalledWith(TEAM);
	});

	it("hands filter changes to the host", async () => {
		const { onSearchChange } = renderReport();
		await screen.findByTestId("time-report");
		act(() => mocks.reportProps?.onSearchChange({ group: "week" }));
		expect(onSearchChange).toHaveBeenCalledWith({ group: "week" });
	});

	it("offers no pay cut-offs and no plan workspace when the team has neither", async () => {
		mocks.access = access({ canPay: false, planWorkspaceId: null });
		renderReport();
		await screen.findByTestId("time-report");
		expect(mocks.reportProps?.cutoffs).toBeNull();
		expect(mocks.reportProps?.planWorkspace).toBeNull();
	});

	it("falls back to the device's timezone when the policy can't be read", async () => {
		vi.mocked(timeService.getTeamPolicy).mockRejectedValue(
			new TimeApiError({ status: 404, code: "TIME_NOT_FOUND", message: "x" }),
		);
		renderReport();
		await screen.findByTestId("time-report");
		expect(mocks.reportProps?.timezone).toBeNull();
		expect(mocks.reportProps?.weekStart).toBeNull();
	});

	it("never reads the manager-only policy for someone who doesn't manage the team", async () => {
		mocks.access = access({ isApprover: false });
		renderReport();
		await screen.findByTestId("time-report");
		expect(timeService.getTeamPolicy).not.toHaveBeenCalled();
		expect(mocks.reportProps?.timezone).toBeNull();
	});

	it("opens a row's entry in place, read-only, and closing it touches no URL", async () => {
		const onLegacyEntryClose = vi.fn();
		renderReport({ onLegacyEntryClose });
		await screen.findByTestId("time-report");
		expect(screen.queryByRole("dialog")).toBeNull();
		act(() => mocks.reportProps?.onOpenEntry?.({ id: ENTRY } as TimeEntryView));
		expect(screen.getByRole("dialog", { name: "Entry" }).textContent).toBe(
			ENTRY,
		);
		expect(mocks.modalProps?.mode).toBe("readonly");
		expect(mocks.modalProps?.timeZone).toBe("America/New_York");
		act(() => mocks.modalProps?.onClose());
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(onLegacyEntryClose).not.toHaveBeenCalled();
	});

	it("opens an old ?log= entry over the Report, and closing hands it back to the host", async () => {
		const onLegacyEntryClose = vi.fn();
		renderReport({ legacyEntryId: LEGACY, onLegacyEntryClose });
		await screen.findByTestId("time-report");
		expect(screen.getByRole("dialog", { name: "Entry" }).textContent).toBe(
			LEGACY,
		);
		expect(mocks.modalProps?.mode).toBe("readonly");
		act(() => mocks.modalProps?.onClose());
		expect(onLegacyEntryClose).toHaveBeenCalledTimes(1);
	});
});
