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
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));
vi.mock("@/components/roadmap/panels/SidePanel", () => ({
	SidePanel: () => null,
}));
const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));

import { TimeApiError, timeService } from "@/services/time.service";
import type {
	EntryWithWarnings,
	LoggingForResult,
	LoggingOption,
	ResolvedTimePolicy,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import {
	durationLine,
	ManualEntryModal,
	parseWorkValue,
	timezoneHint,
	workOptions,
	workValue,
} from "./ManualEntryModal";

const USER = "user-1";
const TEAM = "11111111-1111-4111-8111-111111111111";
const ASG = "33333333-3333-4333-8333-333333333333";

function option(
	kind: LoggingOption["kind"],
	id: string | null,
	label: string,
): LoggingOption {
	return {
		kind,
		id,
		label,
		sheet_scope: kind === "personal" ? null : { kind: "workspace", ref: "w" },
		rate_source: "none",
		workspace_tag: null,
		approver_hint: kind === "assignment" ? "hirer" : "workspace",
	};
}

const team = option("team", TEAM, "Prodigitality Services Inc. Team");
const agreement = option("assignment", ASG, "Acme Corp");

function forResult(over: Partial<LoggingForResult>): LoggingForResult {
	return {
		options: [],
		selected: null,
		prefill: null,
		unavailable: [],
		...over,
	};
}

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
		sources: {},
		plan: { time_tracking: true, time_team_rules: false },
		policy_workspace_id: "w",
		team_override_applied: false,
		member: null,
		client_hours_detail_level: null,
		...over,
	};
}

const created = {
	id: "e-new",
	duration_seconds: 5400,
	context_kind: "team",
	context_label_snapshot: team.label,
	warnings: [],
} as unknown as EntryWithWarnings;

// 09:00–10:30 in Manila on Oct 5.
const initial = {
	projectId: "p1",
	workItem: "meeting" as const,
	startedAt: "2026-10-05T01:00:00.000Z",
	endedAt: "2026-10-05T02:30:00.000Z",
};

let client: QueryClient;

function renderWithClient(ui: ReactElement) {
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

function saveButton(name: string | RegExp = "Add time") {
	return screen.getByRole("button", { name }) as HTMLButtonElement;
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-10-06T04:00:00.000Z"));
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	useAuthStore.setState({ user: { id: USER } as never });
	vi.spyOn(timeService, "getPreferences").mockResolvedValue(null);
	vi.spyOn(timeService, "listMyProjects").mockResolvedValue({
		projects: [
			{
				id: "p1",
				title: "Acme Website",
				workspace_id: "w1",
				options: 1,
				default_kind: "team",
			},
		],
	});
	vi.spyOn(timeService, "getWorkItems").mockResolvedValue({
		tasks: [
			{
				id: "t1",
				title: "Fix login bug",
				work_type: null,
				feature_id: "f1",
				feature_title: "Sign-in",
				epic_id: "e1",
				epic_title: "Auth",
			},
		],
		presets: ["meeting", "review", "admin", "other"],
	});
	vi.spyOn(timeService, "listMyEntries").mockResolvedValue({
		items: [],
		total: 0,
		page: 1,
		limit: 200,
	});
	vi.spyOn(timeService, "getProjectPolicy").mockResolvedValue(policy());
});

afterEach(() => {
	cleanup();
	client.clear();
	useAuthStore.setState({ user: null });
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe("helpers", () => {
	it("names the timezone only when it isn't the device's", () => {
		expect(timezoneHint("Asia/Manila", "Asia/Manila")).toBeNull();
		expect(timezoneHint("America/New_York", "Asia/Manila")).toBe(
			"Times are in America/New_York.",
		);
	});

	it("shows the arithmetic the server does", () => {
		expect(durationLine(5400, 0)).toBe("1h 30m added");
		expect(durationLine(5400, 900)).toBe(
			"1h 30m minus 15m break = 1h 15m added",
		);
	});

	it("encodes the work choice", () => {
		expect(workValue({ taskId: "t1" })).toBe("task:t1");
		expect(workValue({ workItem: "admin" })).toBe("preset:admin");
		expect(workValue({})).toBe("");
		expect(parseWorkValue("task:t1")).toEqual({ taskId: "t1", workItem: null });
		expect(parseWorkValue("preset:review")).toEqual({
			taskId: null,
			workItem: "review",
		});
		expect(
			workOptions(
				["meeting"],
				[
					{
						id: "t1",
						title: "Fix login bug",
						work_type: null,
						feature_id: "f1",
						feature_title: "Sign-in",
						epic_id: "e1",
						epic_title: "Auth",
					},
				],
			),
		).toEqual([
			{ value: "preset:meeting", label: "◦ Meeting" },
			{ value: "task:t1", label: "Auth › Fix login bug" },
		]);
	});
});

describe("ManualEntryModal", () => {
	it("adds exact times for the only option without sending it", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		const create = vi
			.spyOn(timeService, "createEntry")
			.mockResolvedValue(created);
		const onCreated = vi.fn();
		const onClose = vi.fn();
		renderWithClient(
			<ManualEntryModal
				open
				initial={initial}
				onCreated={onCreated}
				onClose={onClose}
			/>,
		);
		await screen.findByText("1h 30m added");
		await screen.findByText("Only option on this project");
		await waitFor(() => expect(saveButton().disabled).toBe(false));
		fireEvent.click(saveButton());
		await waitFor(() => expect(create).toHaveBeenCalled());
		expect(create.mock.calls[0][0]).toEqual({
			project_id: "p1",
			work_item: "meeting",
			started_at: "2026-10-05T01:00:00.000Z",
			ended_at: "2026-10-05T02:30:00.000Z",
		});
		await waitFor(() => expect(onCreated).toHaveBeenCalled());
		expect(onClose).toHaveBeenCalled();
		expect(toast.success).toHaveBeenCalledWith("Added 1h 30m.");
	});

	it("MANUAL_ENTRIES_DISABLED shows inline before anything is sent", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [agreement], selected: agreement }),
		);
		vi.spyOn(timeService, "getProjectPolicy").mockResolvedValue(
			policy({ allow_manual_entries: false }),
		);
		const create = vi.spyOn(timeService, "createEntry");
		renderWithClient(
			<ManualEntryModal open initial={initial} onClose={vi.fn()} />,
		);
		await screen.findByText(
			"Manual time is off in your agreement with Acme Corp.",
		);
		expect(saveButton().disabled).toBe(true);
		expect(create).not.toHaveBeenCalled();
	});

	it("RETROACTIVE_WINDOW: older than the window reads inline", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		vi.spyOn(timeService, "getProjectPolicy").mockResolvedValue(
			policy({ retroactive_days: 3 }),
		);
		renderWithClient(
			<ManualEntryModal
				open
				initial={{
					...initial,
					startedAt: "2026-09-20T01:00:00.000Z",
					endedAt: "2026-09-20T02:00:00.000Z",
				}}
				onClose={vi.fn()}
			/>,
		);
		await screen.findByText(
			"Prodigitality Services Inc. Team accepts time up to 3 days back.",
		);
		expect(saveButton().disabled).toBe(true);
	});

	it("2+ options: the radio list in place, and the button names the choice", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team, agreement] }),
		);
		const create = vi
			.spyOn(timeService, "createEntry")
			.mockResolvedValue(created);
		renderWithClient(
			<ManualEntryModal open initial={initial} onClose={vi.fn()} />,
		);
		const radio = await screen.findByRole("radio", { name: /Acme Corp/ });
		expect(saveButton().disabled).toBe(true);
		fireEvent.click(radio);
		const named = await screen.findByRole("button", {
			name: "Add for Acme Corp",
		});
		await waitFor(() =>
			expect((named as HTMLButtonElement).disabled).toBe(false),
		);
		fireEvent.click(named);
		await waitFor(() => expect(create).toHaveBeenCalled());
		expect(create.mock.calls[0][0]).toMatchObject({
			logging_for: { kind: "assignment", id: ASG },
			remember: true,
		});
	});

	it("shows the server's refusal inline", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		vi.spyOn(timeService, "createEntry").mockRejectedValue(
			new TimeApiError({
				status: 403,
				code: "MANUAL_ENTRIES_DISABLED",
				message: "x",
			}),
		);
		const onClose = vi.fn();
		renderWithClient(
			<ManualEntryModal open initial={initial} onClose={onClose} />,
		);
		await waitFor(() => expect(saveButton().disabled).toBe(false));
		fireEvent.click(saveButton());
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toBe(
			"Manual time is off for Prodigitality Services Inc. Team.",
		);
		expect(onClose).not.toHaveBeenCalled();
	});

	it("a submitted week offers Withdraw inline", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		vi.spyOn(timeService, "getTimesheet").mockRejectedValue(
			new Error("offline"),
		);
		vi.spyOn(timeService, "createEntry").mockRejectedValue(
			new TimeApiError({
				status: 409,
				code: "TIMESHEET_LOCKED",
				message: "x",
				extras: {
					reason: "period",
					timesheet_id: "s1",
					sheet_status: "submitted",
				},
			}),
		);
		renderWithClient(
			<ManualEntryModal open initial={initial} onClose={vi.fn()} />,
		);
		await waitFor(() => expect(saveButton().disabled).toBe(false));
		fireEvent.click(saveButton());
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain(
			"This week's timesheet is submitted. Withdraw it to add time.",
		);
		expect(
			within(alert).getByRole("button", { name: "Withdraw" }),
		).toBeTruthy();
	});

	it("a break as long as the block can't be saved", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		renderWithClient(
			<ManualEntryModal
				open
				initial={{ ...initial, breakMinutes: 90 }}
				onClose={vi.fn()}
			/>,
		);
		await screen.findByText(
			"The break is as long as the whole block, so there's no time left to add.",
		);
		expect(saveButton().disabled).toBe(true);
	});

	it("defaults the start to 09:00 in the context's timezone on an empty day", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		const create = vi
			.spyOn(timeService, "createEntry")
			.mockResolvedValue(created);
		renderWithClient(
			<ManualEntryModal
				open
				initial={{ projectId: "p1", workItem: "review", day: "2026-10-05" }}
				onClose={vi.fn()}
			/>,
		);
		await screen.findByText("1h added");
		await waitFor(() => expect(saveButton().disabled).toBe(false));
		fireEvent.click(saveButton());
		await waitFor(() => expect(create).toHaveBeenCalled());
		expect(create.mock.calls[0][0]).toMatchObject({
			started_at: "2026-10-05T01:00:00.000Z",
			ended_at: "2026-10-05T02:00:00.000Z",
			work_item: "review",
		});
	});
	it("reads 24-hour times, the full date, and Start above End", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		renderWithClient(
			<ManualEntryModal open initial={initial} onClose={vi.fn()} />,
		);
		await screen.findByText("1h 30m added");
		const start = screen.getByLabelText("Start time") as HTMLInputElement;
		expect(start.value).toBe("09:00");
		expect(start.placeholder).toBe("09:00");
		expect((screen.getByLabelText("End time") as HTMLInputElement).value).toBe(
			"10:30",
		);
		expect(screen.getByRole("button", { name: "Start date" }).textContent).toBe(
			"Mon, Oct 5, 2026",
		);
		expect(screen.getByRole("button", { name: "End date" }).textContent).toBe(
			"Mon, Oct 5, 2026",
		);
		expect(screen.getByTestId("entry-times").className).not.toMatch(
			/grid-cols-2/,
		);
		// The option list runs 00:00, 00:15… on the 24-hour clock.
		fireEvent.focus(start);
		const list = await screen.findByRole("dialog", { name: "Time options" });
		const slots = within(list)
			.getAllByRole("button")
			.map((b) => b.textContent);
		expect(slots.slice(0, 2)).toEqual(["00:00", "00:15"]);
		expect(slots).toContain("14:30");
		expect(slots.some((t) => /AM|PM/.test(t ?? ""))).toBe(false);
	});

	it("O3: today's default end is clamped to now", async () => {
		// 09:30:40 in Manila on Oct 6; the empty day starts at 09:00.
		vi.setSystemTime(new Date("2026-10-06T01:30:40.000Z"));
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		const create = vi
			.spyOn(timeService, "createEntry")
			.mockResolvedValue(created);
		renderWithClient(
			<ManualEntryModal
				open
				initial={{ projectId: "p1", workItem: "review" }}
				onClose={vi.fn()}
			/>,
		);
		await screen.findByText("30m added");
		expect((screen.getByLabelText("End time") as HTMLInputElement).value).toBe(
			"09:30",
		);
		await waitFor(() => expect(saveButton().disabled).toBe(false));
		fireEvent.click(saveButton());
		await waitFor(() => expect(create).toHaveBeenCalled());
		expect(create.mock.calls[0][0]).toMatchObject({
			started_at: "2026-10-06T01:00:00.000Z",
			ended_at: "2026-10-06T01:30:00.000Z",
		});
	});

	it("O3: a default start still ahead of now becomes the last full hour", async () => {
		// 02:54 in Manila on Oct 6: 09:00 is ahead, so 01:00–02:00.
		vi.setSystemTime(new Date("2026-10-05T18:54:00.000Z"));
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		const create = vi
			.spyOn(timeService, "createEntry")
			.mockResolvedValue(created);
		renderWithClient(
			<ManualEntryModal
				open
				initial={{ projectId: "p1", workItem: "review", day: "2026-10-06" }}
				onClose={vi.fn()}
			/>,
		);
		await screen.findByText("1h added");
		expect(
			(screen.getByLabelText("Start time") as HTMLInputElement).value,
		).toBe("01:00");
		expect((screen.getByLabelText("End time") as HTMLInputElement).value).toBe(
			"02:00",
		);
		await waitFor(() => expect(saveButton().disabled).toBe(false));
		fireEvent.click(saveButton());
		await waitFor(() => expect(create).toHaveBeenCalled());
		expect(create.mock.calls[0][0]).toMatchObject({
			started_at: "2026-10-05T17:00:00.000Z",
			ended_at: "2026-10-05T18:00:00.000Z",
		});
	});

	it("a failed project read says so above the Project field, with Try again", async () => {
		vi.spyOn(timeService, "listMyProjects").mockRejectedValue(
			new TimeApiError({ status: 403, code: "HTTP_403", message: "" }),
		);
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		renderWithClient(<ManualEntryModal open onClose={vi.fn()} />);
		const alert = await screen.findByRole("alert");
		expect(
			within(alert).getByRole("button", { name: "Try again" }),
		).toBeTruthy();
	});
});
