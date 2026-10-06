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
	TimeEntryView,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import {
	intervalPreview,
	QuickAddBar,
	quickAddDays,
	workLabel,
} from "./QuickAddBar";

const USER = "user-1";
const TEAM = "11111111-1111-4111-8111-111111111111";
const ASG = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-06T04:00:00.000Z"); // Tue Oct 6, 12:00 in Manila

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

// Today in Manila: 09:00–12:30.
const todaysEntry = {
	id: "e0",
	started_at: "2026-10-06T01:00:00.000Z",
	ended_at: "2026-10-06T04:30:00.000Z",
} as TimeEntryView;

let client: QueryClient;

function renderBar(props: Parameters<typeof QuickAddBar>[0] = {}) {
	return render(
		<QueryClientProvider client={client}>
			<QuickAddBar {...props} />
		</QueryClientProvider>,
	);
}

async function chooseMeeting() {
	fireEvent.click(
		await screen.findByRole("button", { name: /Task or preset/ }),
	);
	const taskColumn = await screen.findByRole("region", { name: "Task" });
	fireEvent.click(
		await within(taskColumn).findByRole("button", { name: /Meeting/ }),
	);
	fireEvent.click(screen.getByRole("button", { name: "Choose" }));
	await screen.findByRole("button", { name: /◦ Meeting/ });
}

function addButton(name: string | RegExp = "Add") {
	return screen.getByRole("button", { name }) as HTMLButtonElement;
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
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
		tasks: [],
		presets: ["meeting", "review", "admin", "other"],
	});
	vi.spyOn(timeService, "listMyEntries").mockResolvedValue({
		items: [todaysEntry],
		total: 1,
		page: 1,
		limit: 200,
	});
	vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
		forResult({ options: [team], selected: team }),
	);
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
	it("offers today and the six days before it, greying days past the window", () => {
		const days = quickAddDays({
			timezone: "Asia/Manila",
			now: NOW,
			floor: "2026-10-04",
		});
		expect(days.map((d) => d.label)).toEqual([
			"Today",
			"Yesterday",
			"Sun Oct 4",
			"Sat Oct 3",
			"Fri Oct 2",
			"Thu Oct 1",
			"Wed Sep 30",
		]);
		expect(days.map((d) => d.disabled)).toEqual([
			false,
			false,
			false,
			true,
			true,
			true,
			true,
		]);
		expect(days[0].day).toBe("2026-10-06");
	});

	it("previews the interval, naming the timezone only when it isn't the device's", () => {
		const start = new Date("2026-10-06T04:30:00.000Z");
		const end = new Date("2026-10-06T06:00:00.000Z");
		expect(intervalPreview(start, end, "Asia/Manila", "Asia/Manila")).toBe(
			"12:30–14:00",
		);
		expect(intervalPreview(start, end, "Asia/Manila", "Europe/Paris")).toBe(
			"12:30–14:00 (Asia/Manila)",
		);
	});

	it("labels the work button", () => {
		expect(workLabel(null)).toBe("Task or preset");
		expect(workLabel({ taskTitle: "Fix login bug", workItem: null })).toBe(
			"Fix login bug",
		);
		expect(workLabel({ taskTitle: null, workItem: "review" })).toBe("◦ Review");
	});
});

describe("QuickAddBar", () => {
	it("adds a duration after the day's last entry, without sending the only option", async () => {
		const create = vi.spyOn(timeService, "createEntry").mockResolvedValue({
			id: "e1",
			duration_seconds: 5400,
			context_kind: "team",
			warnings: [],
		} as unknown as EntryWithWarnings);
		const onAdded = vi.fn();
		renderBar({ onAdded });
		await chooseMeeting();
		fireEvent.change(screen.getByRole("textbox", { name: "Duration" }), {
			target: { value: "1:30" },
		});
		await screen.findByText(/12:30–14:00/);
		await waitFor(() => expect(addButton().disabled).toBe(false));
		fireEvent.click(addButton());
		await waitFor(() => expect(create).toHaveBeenCalled());
		expect(create.mock.calls[0][0]).toEqual({
			project_id: "p1",
			work_item: "meeting",
			started_at: "2026-10-06T04:30:00.000Z",
			ended_at: "2026-10-06T06:00:00.000Z",
		});
		await waitFor(() => expect(onAdded).toHaveBeenCalled());
		expect(
			(screen.getByRole("textbox", { name: "Duration" }) as HTMLInputElement)
				.value,
		).toBe("");
	});

	it("an earlier day with no entry starts at 09:00 in the context's timezone", async () => {
		const create = vi.spyOn(timeService, "createEntry").mockResolvedValue({
			id: "e1",
			duration_seconds: 5400,
			warnings: [],
		} as unknown as EntryWithWarnings);
		renderBar();
		await chooseMeeting();
		fireEvent.change(screen.getByRole("textbox", { name: "Duration" }), {
			target: { value: "90m" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Day: Today" }));
		fireEvent.click(await screen.findByRole("option", { name: "Yesterday" }));
		await screen.findByText(/09:00–10:30/);
		fireEvent.click(addButton());
		await waitFor(() => expect(create).toHaveBeenCalled());
		expect(create.mock.calls[0][0]).toMatchObject({
			started_at: "2026-10-05T01:00:00.000Z",
			ended_at: "2026-10-05T02:30:00.000Z",
		});
	});

	it("explains an unreadable duration and keeps Add disabled", async () => {
		renderBar();
		await chooseMeeting();
		fireEvent.change(screen.getByRole("textbox", { name: "Duration" }), {
			target: { value: "soon" },
		});
		await screen.findByText("Use 1:30, 90m or 1.5h.");
		expect(addButton().disabled).toBe(true);
	});

	it("MANUAL_ENTRIES_DISABLED: Add is disabled with the reason inline", async () => {
		vi.spyOn(timeService, "getProjectPolicy").mockResolvedValue(
			policy({ allow_manual_entries: false }),
		);
		renderBar();
		await chooseMeeting();
		fireEvent.change(screen.getByRole("textbox", { name: "Duration" }), {
			target: { value: "1h" },
		});
		const reason = await screen.findByTestId("entry-rule");
		expect(reason.textContent).toBe(
			"Manual time is off for Prodigitality Services Inc. Team.",
		);
		expect(addButton().disabled).toBe(true);
	});

	it("RETROACTIVE_WINDOW: older days are greyed with the reason", async () => {
		vi.spyOn(timeService, "getProjectPolicy").mockResolvedValue(
			policy({ retroactive_days: 1 }),
		);
		renderBar();
		await screen.findByText("Only option on this project");
		fireEvent.click(screen.getByRole("button", { name: "Day: Today" }));
		const list = await screen.findByRole("listbox", { name: "Day" });
		await waitFor(() =>
			expect(
				(
					within(list).getByRole("option", {
						name: "Sun Oct 4",
					}) as HTMLButtonElement
				).disabled,
			).toBe(true),
		);
		expect(
			(
				within(list).getByRole("option", {
					name: "Yesterday",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false);
		expect(list.textContent).toContain(
			"Prodigitality Services Inc. Team accepts time up to 1 day back.",
		);
	});

	it("a day passed in past the window reads inline", async () => {
		vi.spyOn(timeService, "getProjectPolicy").mockResolvedValue(
			policy({ retroactive_days: 2 }),
		);
		renderBar({ day: "2026-09-01" });
		const reason = await screen.findByTestId("entry-rule");
		expect(reason.textContent).toBe(
			"Prodigitality Services Inc. Team accepts time up to 2 days back.",
		);
	});

	it("2+ options with a remembered default: the button names it", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team, agreement], prefill: agreement }),
		);
		const create = vi.spyOn(timeService, "createEntry").mockResolvedValue({
			id: "e1",
			duration_seconds: 3600,
			warnings: [],
		} as unknown as EntryWithWarnings);
		renderBar();
		await chooseMeeting();
		fireEvent.change(screen.getByRole("textbox", { name: "Duration" }), {
			target: { value: "1h" },
		});
		const button = await screen.findByRole("button", {
			name: "Add for Acme Corp",
		});
		await waitFor(() =>
			expect((button as HTMLButtonElement).disabled).toBe(false),
		);
		fireEvent.click(button);
		await waitFor(() => expect(create).toHaveBeenCalled());
		expect(create.mock.calls[0][0]).toMatchObject({
			logging_for: { kind: "assignment", id: ASG },
		});
		expect(create.mock.calls[0][0]).not.toHaveProperty("remember");
	});

	it("the day menu takes keyboard focus, and gives it back on Escape", async () => {
		renderBar();
		await screen.findByText("Only option on this project");
		const trigger = screen.getByRole("button", { name: "Day: Today" });
		fireEvent.click(trigger);
		const list = await screen.findByRole("listbox", { name: "Day" });
		const today = within(list).getByRole("option", { name: "Today" });
		await waitFor(() => expect(document.activeElement).toBe(today));
		fireEvent.keyDown(document, { key: "Escape" });
		await waitFor(() =>
			expect(screen.queryByRole("listbox", { name: "Day" })).toBeNull(),
		);
		expect(document.activeElement).toBe(trigger);
	});

	it("2+ options and nothing chosen: Add opens the For picker with focus in it", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team, agreement] }),
		);
		const create = vi.spyOn(timeService, "createEntry");
		renderBar();
		await chooseMeeting();
		fireEvent.change(screen.getByRole("textbox", { name: "Duration" }), {
			target: { value: "1h" },
		});
		await waitFor(() => expect(addButton().disabled).toBe(false));
		fireEvent.click(addButton());
		const picker = await screen.findByRole("dialog", {
			name: "Choose who this time is for",
		});
		await waitFor(() =>
			expect(within(picker).getAllByRole("radio")).toContain(
				document.activeElement,
			),
		);
		expect(create).not.toHaveBeenCalled();
	});

	it("a failed project read shows why, with Try again, instead of the bar", async () => {
		vi.spyOn(timeService, "listMyProjects").mockRejectedValue(
			new TimeApiError({ status: 403, code: "HTTP_403", message: "" }),
		);
		renderBar();
		const alert = await screen.findByRole("alert");
		expect(
			within(alert).getByRole("button", { name: "Try again" }),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Task or preset/ })).toBeNull();
	});

	it("renders nothing when there is no project to add time to", async () => {
		vi.spyOn(timeService, "listMyProjects").mockResolvedValue({ projects: [] });
		const { container } = renderBar();
		await waitFor(() => expect(container.innerHTML).toBe(""));
	});
});
