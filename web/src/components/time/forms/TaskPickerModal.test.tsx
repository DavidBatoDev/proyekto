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

import { timeKeys } from "@/queries/time";
import { TimeApiError, timeService } from "@/services/time.service";
import type {
	EntryWithWarnings,
	LoggingForResult,
	LoggingOption,
	MyTimeProject,
	ProjectTaskOption,
	TimeEntryView,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import { LoggingScopeProvider } from "./loggingScope";
import {
	buildTaskTree,
	filterTaskTree,
	TaskPickerModal,
} from "./TaskPickerModal";

const USER = "user-1";
const TEAM = "11111111-1111-4111-8111-111111111111";
const ASG = "33333333-3333-4333-8333-333333333333";

function task(
	id: string,
	title: string,
	epic: string,
	feature: string,
): ProjectTaskOption {
	return {
		id,
		title,
		work_type: "real_work",
		feature_id: `f-${feature}`,
		feature_title: feature,
		epic_id: `e-${epic}`,
		epic_title: epic,
	};
}

const tasks = [
	task("t1", "Fix login bug", "Auth", "Sign-in"),
	task("t2", "Add SSO", "Auth", "Sign-in"),
	task("t3", "Invoice export", "Billing", "Exports"),
];

function project(id: string, title: string): MyTimeProject {
	return {
		id,
		title,
		workspace_id: "w1",
		options: 1,
		default_kind: "team",
		status: "active",
		last_logged_at: null,
	};
}

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

function startedEntry(): EntryWithWarnings {
	return {
		id: "e1",
		context_kind: "team",
		context_ref: TEAM,
		context_label_snapshot: team.label,
		timesheet_id: null,
		work_item: "task",
		started_at: "2026-10-06T01:00:00.000Z",
		ended_at: null,
		paused_at: null,
		duration_seconds: null,
		break_seconds: 0,
		break_minutes: 0,
		payable_seconds: null,
		source: "timer",
		work_type_snapshot: "real_work",
		legacy_status: null,
		payout_id: null,
		flagged_reason: null,
		project_id: "p1",
		team_id: TEAM,
		workspace_id: null,
		engagement_assignment_id: null,
		created_at: "2026-10-06T01:00:00.000Z",
		updated_at: "2026-10-06T01:00:00.000Z",
		timesheet: null,
		locked_reason: null,
		identity: "visible",
		member_user_id: USER,
		member_display_name_snapshot: "Maria",
		member: null,
		member_label: null,
		content: "visible",
		task_id: "t1",
		note: null,
		task: { id: "t1", title: "Fix login bug", work_type: null, status: null },
		project: { id: "p1", title: "Acme Website" },
		content_label: null,
		cost: "hidden",
		warnings: [],
	} satisfies TimeEntryView & { warnings: [] };
}

let client: QueryClient;

function renderWithClient(ui: ReactElement) {
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

beforeEach(() => {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	client.setQueryData(timeKeys.running(USER), null);
	useAuthStore.setState({ user: { id: USER } as never });
	vi.spyOn(timeService, "getRunning").mockResolvedValue(null);
	vi.spyOn(timeService, "listMyProjects").mockResolvedValue({
		projects: [project("p1", "Acme Website"), project("p2", "Internal ops")],
	});
	vi.spyOn(timeService, "getWorkItems").mockResolvedValue({
		tasks,
		presets: ["meeting", "review"],
	});
});

afterEach(() => {
	cleanup();
	client.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe("the task tree", () => {
	it("groups by epic and feature title, sorted, with pending task-less nodes", () => {
		const tree = buildTaskTree(
			tasks,
			[{ id: "e-new", title: "Onboarding" }],
			[{ id: "f-new", epicId: "e-Auth", epicTitle: "Auth", title: "Recovery" }],
		);
		expect(tree.map((e) => e.epicTitle)).toEqual([
			"Auth",
			"Billing",
			"Onboarding",
		]);
		expect(tree[0].features.map((f) => f.featureTitle)).toEqual([
			"Recovery",
			"Sign-in",
		]);
		expect(tree[0].features[1].tasks.map((t) => t.title)).toEqual([
			"Add SSO",
			"Fix login bug",
		]);
		expect(tree[2]).toEqual({
			epicTitle: "Onboarding",
			epicId: "e-new",
			features: [],
		});
	});

	it("names untitled nodes", () => {
		const tree = buildTaskTree([
			{ ...task("t9", "", "", ""), epic_title: null, feature_title: null },
		]);
		expect(tree[0].epicTitle).toBe("Untitled epic");
		expect(tree[0].features[0].featureTitle).toBe("Untitled feature");
	});

	it("filters by epic, feature or task title", () => {
		const tree = buildTaskTree(tasks);
		expect(filterTaskTree(tree, "billing").map((e) => e.epicTitle)).toEqual([
			"Billing",
		]);
		const bySso = filterTaskTree(tree, "sso");
		expect(bySso).toHaveLength(1);
		expect(bySso[0].features[0].tasks.map((t) => t.id)).toEqual(["t2"]);
		expect(filterTaskTree(tree, "sign-in")[0].features[0].tasks).toHaveLength(
			2,
		);
		expect(filterTaskTree(tree, "nothing")).toEqual([]);
		expect(filterTaskTree(tree, "  ")).toHaveLength(2);
	});
});

describe("TaskPickerModal (select)", () => {
	it("lists loggable projects, defaults to the most recent, and hands back a task", async () => {
		const onSelect = vi.fn();
		const onClose = vi.fn();
		renderWithClient(
			<TaskPickerModal
				open
				mode="select"
				onSelect={onSelect}
				onClose={onClose}
			/>,
		);
		const projects = await screen.findByRole("region", { name: "Project" });
		const acme = await within(projects).findByRole("button", {
			name: /Acme Website/,
		});
		await waitFor(() => expect(acme.getAttribute("aria-pressed")).toBe("true"));

		const taskColumn = screen.getByRole("region", { name: "Task" });
		fireEvent.click(
			await within(taskColumn).findByRole("button", { name: /Fix login bug/ }),
		);
		const choose = screen.getByRole("button", { name: "Choose" });
		expect((choose as HTMLButtonElement).disabled).toBe(false);
		fireEvent.click(choose);

		expect(onSelect).toHaveBeenCalledWith({
			projectId: "p1",
			projectTitle: "Acme Website",
			taskId: "t1",
			taskTitle: "Fix login bug",
			workItem: null,
		});
		expect(onClose).toHaveBeenCalled();
	});

	it("offers the presets the policy shows under 'Not on a task', marked ◦", async () => {
		const onSelect = vi.fn();
		renderWithClient(
			<TaskPickerModal
				open
				mode="select"
				onSelect={onSelect}
				onClose={vi.fn()}
			/>,
		);
		const taskColumn = await screen.findByRole("region", { name: "Task" });
		await within(taskColumn).findByText("Not on a task");
		expect(
			within(taskColumn).queryByRole("button", { name: /Admin/ }),
		).toBeNull();
		const meeting = within(taskColumn).getByRole("button", { name: /Meeting/ });
		expect(meeting.textContent).toContain("◦");
		fireEvent.click(meeting);
		fireEvent.click(screen.getByRole("button", { name: "Choose" }));
		expect(onSelect).toHaveBeenCalledWith(
			expect.objectContaining({ taskId: null, workItem: "meeting" }),
		);
	});

	it("needs a task or a preset", async () => {
		renderWithClient(
			<TaskPickerModal
				open
				mode="select"
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		await screen.findByText("Not on a task");
		expect(
			(screen.getByRole("button", { name: "Choose" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});

	it("search narrows the epics", async () => {
		renderWithClient(
			<TaskPickerModal
				open
				mode="select"
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		const epics = await screen.findByRole("region", { name: "Epic" });
		await within(epics).findByRole("button", { name: /Auth/ });
		fireEvent.change(screen.getByRole("searchbox", { name: "Find a task" }), {
			target: { value: "invoice" },
		});
		await waitFor(() =>
			expect(within(epics).queryByRole("button", { name: /Auth/ })).toBeNull(),
		);
		expect(within(epics).getByRole("button", { name: /Billing/ })).toBeTruthy();
	});

	it("opens on the task it was given", async () => {
		renderWithClient(
			<TaskPickerModal
				open
				mode="select"
				initialProjectId="p1"
				initialTaskId="t3"
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		const taskColumn = await screen.findByRole("region", { name: "Task" });
		const invoice = await within(taskColumn).findByRole("button", {
			name: /Invoice export/,
		});
		expect(invoice.getAttribute("aria-pressed")).toBe("true");
	});

	it("a locked project shows only that project", async () => {
		renderWithClient(
			<TaskPickerModal
				open
				mode="select"
				lockProject
				initialProjectId="p9"
				lockedProjectTitle="Old project"
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		const projects = await screen.findByRole("region", { name: "Project" });
		await within(projects).findByRole("button", { name: /Old project/ });
		expect(
			within(projects).queryByRole("button", { name: /Acme Website/ }),
		).toBeNull();
	});
});

describe("TaskPickerModal (start)", () => {
	async function pickFixLoginBug() {
		const taskColumn = await screen.findByRole("region", { name: "Task" });
		fireEvent.click(
			await within(taskColumn).findByRole("button", { name: /Fix login bug/ }),
		);
	}

	it("one option: read-only chip, and the start sends no logging_for", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team], selected: team }),
		);
		const start = vi
			.spyOn(timeService, "startEntry")
			.mockResolvedValue(startedEntry());
		const onStarted = vi.fn();
		const onClose = vi.fn();
		renderWithClient(
			<TaskPickerModal open onStarted={onStarted} onClose={onClose} />,
		);
		await pickFixLoginBug();
		await screen.findByText("Only option on this project");
		fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
		await waitFor(() => expect(start).toHaveBeenCalled());
		expect(start.mock.calls[0][0]).toEqual({ project_id: "p1", task_id: "t1" });
		await waitFor(() => expect(onStarted).toHaveBeenCalled());
		expect(onClose).toHaveBeenCalled();
	});

	it("2+ with a remembered default: the button names it and one tap starts", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team, agreement], prefill: agreement }),
		);
		const start = vi
			.spyOn(timeService, "startEntry")
			.mockResolvedValue(startedEntry());
		renderWithClient(<TaskPickerModal open onClose={vi.fn()} />);
		await pickFixLoginBug();
		const button = await screen.findByRole("button", {
			name: "Start for Acme Corp",
		});
		fireEvent.click(button);
		await waitFor(() => expect(start).toHaveBeenCalled());
		expect(start.mock.calls[0][0]).toEqual({
			project_id: "p1",
			task_id: "t1",
			logging_for: { kind: "assignment", id: ASG },
		});
	});

	it("2+ with nothing remembered: the For list sits in the dialog, and Start takes you there", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team, agreement] }),
		);
		const start = vi
			.spyOn(timeService, "startEntry")
			.mockResolvedValue(startedEntry());
		renderWithClient(<TaskPickerModal open onClose={vi.fn()} />);
		await pickFixLoginBug();
		const forList = await screen.findByRole("group", {
			name: "Choose who this time is for",
		});
		// Inside the modal panel, so its Tab trap and aria-modal include it.
		const panel = forList.closest('[role="dialog"][aria-modal="true"]');
		expect(panel).not.toBeNull();
		expect(
			within(panel as HTMLElement).getByRole("button", { name: "Start timer" }),
		).toBeTruthy();
		// No popover chip in the footer.
		expect(screen.queryByRole("button", { name: /Choose…/ })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Start timer" }));
		expect(start).not.toHaveBeenCalled();
		const radios = within(forList).getAllByRole("radio");
		expect(document.activeElement).toBe(radios[0]);

		fireEvent.click(within(forList).getByRole("radio", { name: /Acme Corp/ }));
		fireEvent.click(
			screen.getByRole("button", { name: "Start for Acme Corp" }),
		);
		await waitFor(() => expect(start).toHaveBeenCalled());
		expect(start.mock.calls[0][0]).toEqual({
			project_id: "p1",
			task_id: "t1",
			logging_for: { kind: "assignment", id: ASG },
			remember: true,
		});
	});

	it("2+: once the work is picked, the For list is scrolled into view", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team, agreement] }),
		);
		const scrolled: Element[] = [];
		const original = Element.prototype.scrollIntoView;
		Element.prototype.scrollIntoView = function (this: Element) {
			scrolled.push(this);
		};
		try {
			renderWithClient(<TaskPickerModal open onClose={vi.fn()} />);
			await pickFixLoginBug();
			const forSection = await screen.findByRole("region", { name: "For" });
			await waitFor(() => expect(scrolled).toContain(forSection));
		} finally {
			Element.prototype.scrollIntoView = original;
		}
	});

	it("2+ with a remembered default: the list shows it chosen, in the dialog", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team, agreement], prefill: agreement }),
		);
		renderWithClient(<TaskPickerModal open onClose={vi.fn()} />);
		await pickFixLoginBug();
		const forList = await screen.findByRole("group", {
			name: "Choose who this time is for",
		});
		const acme = within(forList).getByRole("radio", {
			name: /Acme Corp/,
		}) as HTMLInputElement;
		expect(acme.checked).toBe(true);
	});

	it("several options the resolver picked between: 'Same approver and rate either way'", async () => {
		const teamB = option(
			"team",
			"22222222-2222-4222-8222-222222222222",
			"Design Team",
		);
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [team, teamB], selected: team }),
		);
		renderWithClient(<TaskPickerModal open onClose={vi.fn()} />);
		await pickFixLoginBug();
		await screen.findByText("Same approver and rate either way");
		expect(screen.queryByText("Only option on this project")).toBeNull();
	});

	it("a failed project read says so, with Try again, not 'No projects'", async () => {
		const list = vi
			.spyOn(timeService, "listMyProjects")
			.mockRejectedValue(
				new TimeApiError({ status: 403, code: "HTTP_403", message: "" }),
			);
		renderWithClient(
			<TaskPickerModal
				open
				mode="select"
				onSelect={vi.fn()}
				onClose={vi.fn()}
			/>,
		);
		const projects = await screen.findByRole("region", { name: "Project" });
		const alert = await within(projects).findByRole("alert");
		expect(
			screen.queryByText("No projects you can log time on yet."),
		).toBeNull();
		const calls = list.mock.calls.length;
		fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
		await waitFor(() => expect(list.mock.calls.length).toBe(calls + 1));
	});
});

describe("TaskPickerModal (shared with you)", () => {
	const scope = {
		current: "w1",
		isDefault: true,
		members: ["w1"],
		defaultId: "w1",
	};

	it("lists outside projects under Shared with you, named with their workspace, and explains Just me", async () => {
		vi.spyOn(timeService, "listMyProjects").mockResolvedValue({
			projects: [
				project("p2", "Internal ops"),
				{
					...project("p1", "Acme Website"),
					workspace_id: "w-outside",
					workspace_name: "Acme Inc.",
				},
			],
		});
		const personal = option("personal", null, "Just me");
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [personal], selected: personal }),
		);
		renderWithClient(
			<LoggingScopeProvider scope={scope}>
				<TaskPickerModal open onClose={() => {}} />
			</LoggingScopeProvider>,
		);
		const heading = await screen.findByTestId("picker-shared-heading");
		expect(heading.textContent).toBe("Shared with you");
		const shared = await screen.findByRole("button", {
			name: /Acme Website · Acme Inc\./,
		});
		fireEvent.click(shared);
		const taskColumn = await screen.findByRole("region", { name: "Task" });
		fireEvent.click(
			await within(taskColumn).findByRole("button", { name: /Fix login bug/ }),
		);
		expect((await screen.findByTestId("for-shared-hint")).textContent).toBe(
			"This time stays yours. To have Acme Inc. approve it, ask them to add you to their workspace or set up an agreement.",
		);
	});
});
