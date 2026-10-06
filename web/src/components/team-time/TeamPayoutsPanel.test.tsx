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
import type { TeamMoneyAccess } from "@/components/team-time/useTeamMoneyAccess";
import type { PlanLimitInfo } from "@/lib/planLimitErrors";
import {
	type OwedBucket,
	type Payout,
	payoutsService,
} from "@/services/payouts.service";
import { timeService } from "@/services/time.service";
import type { TeamPolicyView, TimeEntryView } from "@/services/time.types";

const mocks = vi.hoisted(() => ({
	native: false,
	user: { id: "payer-1" } as { id: string } | null,
	access: null as unknown as TeamMoneyAccess,
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@/lib/platform", () => ({ isNativeApp: () => mocks.native }));
vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		success: mocks.toastSuccess,
		error: mocks.toastError,
		info: vi.fn(),
		warning: vi.fn(),
	}),
}));
vi.mock("@/stores/authStore", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/stores/authStore")>();
	return { ...actual, useUser: () => mocks.user };
});
vi.mock("@/components/team-time/useTeamMoneyAccess", () => ({
	useTeamMoneyAccess: () => mocks.access,
}));

import {
	buildPayoutWindow,
	defaultPayoutWindowFrom,
	owedOutsideWindow,
	PAYOUT_HISTORY_FLOOR,
	TeamPayoutsPanel,
} from "./TeamPayoutsPanel";

const TEAM_ID = "11111111-1111-4111-8111-111111111111";
const MARIA = "22222222-2222-4222-8222-222222222222";
const LEO = "33333333-3333-4333-8333-333333333333";
const ANA = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-10-06T04:00:00.000Z"); // Oct 6, 12:00 in Manila

let seq = 0;
function entry(overrides: Partial<TimeEntryView> = {}): TimeEntryView {
	seq += 1;
	return {
		id: `entry-${seq}`,
		context_kind: "team",
		context_ref: TEAM_ID,
		context_label_snapshot: "Prodigitality Services Inc. Team",
		timesheet_id: "sheet-1",
		work_item: "task",
		started_at: "2026-09-20T02:00:00.000Z",
		ended_at: "2026-09-20T03:00:00.000Z",
		paused_at: null,
		duration_seconds: 3600,
		break_seconds: 0,
		break_minutes: 0,
		payable_seconds: 3600,
		source: "timer",
		work_type_snapshot: "real_work",
		legacy_status: null,
		payout_id: null,
		flagged_reason: null,
		project_id: "project-1",
		team_id: TEAM_ID,
		workspace_id: null,
		engagement_assignment_id: null,
		created_at: "2026-09-20T03:00:00.000Z",
		updated_at: "2026-09-20T03:00:00.000Z",
		timesheet: null,
		locked_reason: null,
		identity: "visible",
		member_user_id: MARIA,
		member_display_name_snapshot: "Maria Santos",
		member: {
			id: MARIA,
			display_name: "Maria Santos",
			avatar_url: null,
		},
		member_label: null,
		content: "visible",
		task_id: "task-1",
		note: null,
		task: null,
		project: null,
		content_label: null,
		cost: "visible",
		rate_snapshot: 100,
		rate_type_snapshot: "hourly",
		currency_snapshot: "PHP",
		amount_snapshot: 100,
		...overrides,
	} as TimeEntryView;
}

function leo(overrides: Partial<TimeEntryView> = {}): TimeEntryView {
	return entry({
		member_user_id: LEO,
		member_display_name_snapshot: "Leo Cruz",
		member: { id: LEO, display_name: "Leo Cruz", avatar_url: null },
		...overrides,
	});
}

/** The window the panel tests read (default config: 1–15 and 16–end). */
function windowEntries(): TimeEntryView[] {
	return [
		// 01:30 on Sep 16 in Manila (Sep 15 in UTC): the second-half cut-off.
		entry({ started_at: "2026-09-15T17:30:00.000Z" }),
		entry({ payable_seconds: 1800 }),
		// Not approved yet: 2h on an open sheet.
		entry({
			started_at: "2026-09-25T02:00:00.000Z",
			payable_seconds: null,
			duration_seconds: 7200,
		}),
		// First-half cut-off: overdue (paid on the 22nd).
		leo({ started_at: "2026-09-10T02:00:00.000Z" }),
		// Paid, legacy rejected, fixed-pay: never in a payment here.
		leo({ started_at: "2026-09-11T02:00:00.000Z", payout_id: "payout-9" }),
		leo({
			started_at: "2026-09-12T02:00:00.000Z",
			legacy_status: "rejected",
		}),
		entry({
			member_user_id: ANA,
			member: { id: ANA, display_name: "Ana Reyes", avatar_url: null },
			rate_type_snapshot: "fixed",
		}),
	];
}

const owedMatchingWindow: OwedBucket[] = [
	{
		member_user_id: MARIA,
		member: null,
		currency: "PHP",
		log_count: 2,
		entry_count: 2,
		hours: 1.5,
		amount: 150,
	},
	{
		member_user_id: LEO,
		member: null,
		currency: "PHP",
		log_count: 1,
		entry_count: 1,
		hours: 1,
		amount: 100,
	},
];

const policy = {
	team_id: TEAM_ID,
	override: null,
	effective: { timezone: "Asia/Manila", week_start: 1 },
	can_edit_money_fields: true,
	has_team_rules: true,
} as unknown as TeamPolicyView;

function baseAccess(overrides: Partial<TeamMoneyAccess> = {}): TeamMoneyAccess {
	return {
		isLoading: false,
		error: null,
		team: {
			id: TEAM_ID,
			name: "Prodigitality Services Inc. Team",
			owner_id: "payer-1",
			workspace_id: "ws-1",
			pay_period_config: null,
			time_tracking_enabled: true,
			member_rates_enabled: true,
			payouts_enabled: true,
		} as TeamMoneyAccess["team"],
		isApprover: true,
		isTeamMember: true,
		timeTrackingEnabled: true,
		hasRates: true,
		canPay: true,
		planWorkspaceId: "ws-1",
		planWorkspace: null,
		isComplimentary: false,
		planStatus: "ready",
		payoutsPlanLimit: null,
		teamRulesPlanLimit: null,
		...overrides,
	};
}

const payoutsPlanLimit: PlanLimitInfo = {
	limitKey: "time_payouts",
	kind: "feature",
	label: "Payouts",
	limit: null,
	used: null,
	plan: "pro",
	upgradePlan: "business",
	workspaceId: "ws-1",
	workspaceSlug: null,
	context: "enable",
	message: "",
};

const recordedPayout: Payout = {
	id: "payout-1",
	team_id: TEAM_ID,
	member_user_id: LEO,
	created_by: "payer-1",
	payout_method_id: null,
	method_type: "gcash",
	method_label: null,
	method_account_name: null,
	method_account_identifier: null,
	method_bank_name: null,
	currency: "PHP",
	total_amount: 250,
	reference_number: "8821",
	proof_path: null,
	note: null,
	paid_at: "2026-09-23T04:00:00.000Z",
	status: "recorded",
	source: "batch",
	created_at: "2026-09-23T04:00:00.000Z",
	updated_at: "2026-09-23T04:00:00.000Z",
	member: { id: LEO, display_name: "Leo Cruz", avatar_url: null },
};

function mockApi(
	options: {
		entries?: TimeEntryView[];
		owed?: OwedBucket[];
		payouts?: Payout[];
	} = {},
) {
	const getReportEntries = vi
		.spyOn(timeService, "getReportEntries")
		.mockImplementation(async (q) => ({
			items: options.entries ?? windowEntries(),
			total: (options.entries ?? windowEntries()).length,
			page: q.page ?? 1,
			limit: q.limit ?? 200,
		}));
	vi.spyOn(timeService, "getTeamPolicy").mockResolvedValue(policy);
	const getTeamOwed = vi
		.spyOn(payoutsService, "getTeamOwed")
		.mockResolvedValue(options.owed ?? owedMatchingWindow);
	const listTeamPayouts = vi
		.spyOn(payoutsService, "listTeamPayouts")
		.mockResolvedValue(options.payouts ?? []);
	vi.spyOn(payoutsService, "listMemberMethods").mockResolvedValue([]);
	return { getReportEntries, getTeamOwed, listTeamPayouts };
}

function renderPanel(links?: Parameters<typeof TeamPayoutsPanel>[0]["links"]) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<TeamPayoutsPanel teamId={TEAM_ID} links={links} />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	seq = 0;
	mocks.access = baseAccess();
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
	mocks.native = false;
	mocks.user = { id: "payer-1" };
	mocks.toastSuccess.mockReset();
	mocks.toastError.mockReset();
});

describe("defaultPayoutWindowFrom", () => {
	it("starts two months back, on the first of the month", () => {
		expect(defaultPayoutWindowFrom("2026-10-06")).toBe("2026-08-01");
		expect(defaultPayoutWindowFrom("2026-01-31")).toBe("2025-11-01");
		expect(defaultPayoutWindowFrom("2026-02-01")).toBe("2025-12-01");
	});
});

describe("buildPayoutWindow", () => {
	const options = {
		config: null,
		timezone: "Asia/Manila",
		today: "2026-10-06",
	};

	it("groups Owed time by cut-off in the team's zone and leaves paid, rejected and fixed time out", () => {
		const slice = buildPayoutWindow(windowEntries(), options);

		expect(slice.groups.map((g) => [g.from, g.to])).toEqual([
			["2026-09-16", "2026-09-30"],
			["2026-09-01", "2026-09-15"],
		]);
		const [second, first] = slice.groups;
		expect(second.rows).toHaveLength(1);
		expect(second.rows[0]).toMatchObject({
			memberId: MARIA,
			currency: "PHP",
			seconds: 5400,
			amount: 150,
			unapprovedSeconds: 7200,
			unapprovedCount: 1,
		});
		expect(second.rows[0].entries).toHaveLength(2);
		expect(second.overdue).toBe(false);
		expect(second.inProgress).toBe(false);
		expect(first.rows).toHaveLength(1);
		expect(first.rows[0]).toMatchObject({ memberId: LEO, amount: 100 });
		expect(first.overdue).toBe(true);
		expect(slice.fixedCount).toBe(1);
		expect(slice.owedCountByBucket).toEqual({
			[`${MARIA}:PHP`]: 2,
			[`${LEO}:PHP`]: 1,
		});
		expect(slice.totalsByCurrency).toEqual({ PHP: 250 });
	});

	it("rounds each person's amount once on the sum", () => {
		const slice = buildPayoutWindow(
			[1, 2, 3].map(() => entry({ rate_snapshot: 33.333 })),
			options,
		);
		expect(slice.groups[0].rows[0].amount).toBe(100);
	});

	it("keeps a person whose time is all unapproved, with no amount", () => {
		const slice = buildPayoutWindow(
			[
				entry({
					started_at: "2026-10-02T02:00:00.000Z",
					payable_seconds: null,
					duration_seconds: 1800,
				}),
			],
			options,
		);
		const [group] = slice.groups;
		expect(group.inProgress).toBe(true);
		expect(group.rows[0]).toMatchObject({
			currency: null,
			amount: 0,
			unapprovedSeconds: 1800,
		});
	});

	it("never counts personal or other-context time", () => {
		const slice = buildPayoutWindow(
			[
				entry({ context_kind: "workspace" }),
				entry({ context_kind: "personal" }),
			],
			options,
		);
		expect(slice.groups).toEqual([]);
	});
});

describe("owedOutsideWindow", () => {
	it("notices Owed time the window doesn't hold", () => {
		const slice = buildPayoutWindow(windowEntries(), {
			config: null,
			timezone: "Asia/Manila",
			today: "2026-10-06",
		});
		expect(owedOutsideWindow(owedMatchingWindow, slice)).toBe(false);
		expect(
			owedOutsideWindow(
				[{ ...owedMatchingWindow[0], entry_count: 5, log_count: 5 }],
				slice,
			),
		).toBe(true);
	});
});

describe("TeamPayoutsPanel", () => {
	it("lists what to pay by cut-off, with the all-time outstanding total", async () => {
		const { getReportEntries } = mockApi();
		renderPanel();

		expect(await screen.findByText("16–EOM Sep 2026")).toBeTruthy();
		expect(screen.getByText("1–15 Sep 2026")).toBeTruthy();
		expect(screen.getByTestId("payouts-outstanding").textContent).toBe(
			"PHP 250.00",
		);
		expect(screen.getByRole("button", { name: "Pay PHP 150.00" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Pay PHP 100.00" })).toBeTruthy();
		expect(screen.getByText("Overdue")).toBeTruthy();
		expect(screen.getAllByText("2h not yet approved").length).toBeGreaterThan(
			0,
		);
		expect(
			screen.getByText(
				"Fixed-fee time is paid as a manual payment, not by entry.",
			),
		).toBeTruthy();
		expect(screen.getByText("Showing cut-offs from Aug 1, 2026.")).toBeTruthy();

		const query = getReportEntries.mock.calls[0][0];
		expect(query).toMatchObject({
			scope: { kind: "team", id: TEAM_ID },
			from: "2026-08-01",
			to: "2026-10-07",
		});
	});

	it("opens the Report on the person and the cut-off from Review", async () => {
		mockApi();
		const openReport = vi.fn();
		renderPanel({ openReport });

		fireEvent.click(await screen.findByRole("button", { name: "Review" }));
		expect(openReport).toHaveBeenCalledWith({
			person: MARIA,
			from: "2026-09-16",
			to: "2026-09-30",
		});
	});

	it("hides Review when the host can't open the Report", async () => {
		mockApi();
		renderPanel();
		await screen.findByText("16–EOM Sep 2026");
		expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
	});

	it("opens the payment dialog with that cut-off's Owed entries", async () => {
		mockApi();
		renderPanel();

		fireEvent.click(
			await screen.findByRole("button", { name: "Pay PHP 150.00" }),
		);
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByText("Pay Maria Santos")).toBeTruthy();
		expect(within(dialog).getByTestId("pay-total").textContent).toBe(
			"PHP 150.00",
		);
		expect(
			within(dialog).getByText(
				/2h of Maria's time in this period isn't approved yet/,
			),
		).toBeTruthy();
	});

	it("never lets the payer pay themselves", async () => {
		mocks.user = { id: MARIA };
		mockApi();
		renderPanel();

		const pay = (await screen.findByRole("button", {
			name: "Pay PHP 150.00",
		})) as HTMLButtonElement;
		expect(pay.disabled).toBe(true);
		expect(
			screen.getByText("Someone else on the team has to record your payment."),
		).toBeTruthy();
	});

	it("without time_payouts, states the plan and keeps the history, never reading owed time", async () => {
		mocks.access = baseAccess({ payoutsPlanLimit });
		const api = mockApi({ payouts: [recordedPayout] });
		renderPanel();

		expect(
			await screen.findByText("Payouts are part of Business."),
		).toBeTruthy();
		expect(
			screen.getByText(
				"Recorded payments stay readable here, and can still be voided.",
			),
		).toBeTruthy();
		expect(await screen.findByText("Leo Cruz")).toBeTruthy();
		expect(api.getTeamOwed).not.toHaveBeenCalled();
		expect(api.getReportEntries).not.toHaveBeenCalled();
	});

	it("waits for the plan answer before reading owed time", async () => {
		mocks.access = baseAccess({ planStatus: "loading" });
		const api = mockApi();
		renderPanel();
		await waitFor(() => expect(api.listTeamPayouts).toHaveBeenCalled());
		expect(api.getTeamOwed).not.toHaveBeenCalled();
	});

	it("says when unpaid time is older than the window, and reads it on request", async () => {
		const api = mockApi({
			owed: [{ ...owedMatchingWindow[0], entry_count: 4, log_count: 4 }],
		});
		renderPanel();

		expect(
			await screen.findByText(
				"Some approved time from before Aug 1, 2026 isn't paid yet.",
			),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Show older time" }));
		await waitFor(() =>
			expect(
				api.getReportEntries.mock.calls.some(
					([q]) => q.from === PAYOUT_HISTORY_FLOOR,
				),
			).toBe(true),
		);
	});

	it("shows the empty state when nothing is owed", async () => {
		mockApi({ entries: [], owed: [] });
		renderPanel();
		expect(
			await screen.findByText(
				"Nothing to pay. Approved, unpaid time shows up here by cut-off.",
			),
		).toBeTruthy();
	});

	it("voids a payment from its detail and refreshes the payout caches", async () => {
		mockApi({ payouts: [recordedPayout] });
		vi.spyOn(payoutsService, "getPayout").mockResolvedValue({
			...recordedPayout,
			entries: [
				{
					id: "paid-1",
					project_id: "project-1",
					task_id: "task-1",
					started_at: "2026-09-10T02:00:00.000Z",
					ended_at: "2026-09-10T04:30:00.000Z",
					duration_seconds: 9000,
					payable_seconds: 9000,
					rate_snapshot: 100,
					currency_snapshot: "PHP",
					task: { id: "task-1", title: "Fix login bug" },
				},
			],
		});
		const voidPayout = vi
			.spyOn(payoutsService, "voidPayout")
			.mockResolvedValue({ ...recordedPayout, status: "void" });
		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: /Leo Cruz/ }));
		const drawer = await screen.findByRole("dialog");
		expect(await within(drawer).findByText("Fix login bug")).toBeTruthy();
		expect(within(drawer).getByText("2:30")).toBeTruthy();
		fireEvent.click(
			within(drawer).getByRole("button", { name: "Void payout" }),
		);
		await waitFor(() => expect(voidPayout).toHaveBeenCalledWith("payout-1"));
		await waitFor(() =>
			expect(mocks.toastSuccess).toHaveBeenCalledWith(
				"Payout voided. Its time is approved and unpaid again.",
			),
		);
	});
});
