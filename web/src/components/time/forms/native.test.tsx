/* @vitest-environment jsdom */

// Native copy rules (ux.md › Mobile; web blueprint §4): in the installed app
// the entry forms never say contract, rate, payout or invoice, never show an
// amount on agreement time, and never link to /engagements.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => true }));
vi.mock("@/components/roadmap/panels/SidePanel", () => ({
	SidePanel: () => null,
}));
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({
			children,
			to,
			params,
		}: {
			children?: ReactNode;
			to: string;
			params?: Record<string, string>;
		}) => {
			let href = to;
			for (const [key, value] of Object.entries(params ?? {})) {
				href = href.replace(`$${key}`, value);
			}
			return <a href={href}>{children}</a>;
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

import { TimeApiError, timeService } from "@/services/time.service";
import type {
	LoggingForResult,
	LoggingOption,
	ResolvedTimePolicy,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import { MANUAL_ENTRY_COPY, ManualEntryModal } from "./ManualEntryModal";
import { QUICK_ADD_COPY, QuickAddBar } from "./QuickAddBar";
import { TASK_PICKER_COPY, TaskPickerModal } from "./TaskPickerModal";
import { createEntryController, manualEntryRule } from "./useCreateEntry";

const BANNED = /\b(contracts?|rates?|payouts?|invoices?)\b/i;
const AMOUNT = /\b[A-Z]{3}\s?[\d,]+(\.\d+)?\b|[$€£₱]\s?\d/;

function assertNativeSafe(root: HTMLElement = document.body) {
	const text = root.textContent ?? "";
	expect(text).not.toMatch(BANNED);
	expect(text).not.toMatch(AMOUNT);
	for (const el of Array.from(root.querySelectorAll("[title],[aria-label]"))) {
		expect(el.getAttribute("title") ?? "").not.toMatch(BANNED);
		expect(el.getAttribute("aria-label") ?? "").not.toMatch(BANNED);
	}
	expect(root.querySelector('a[href*="/engagements"]')).toBeNull();
}

const USER = "user-1";
const TEAM = "11111111-1111-4111-8111-111111111111";
const ASG = "33333333-3333-4333-8333-333333333333";

function option(
	kind: LoggingOption["kind"],
	id: string | null,
	label: string,
	over: Partial<LoggingOption> = {},
): LoggingOption {
	return {
		kind,
		id,
		label,
		sheet_scope: kind === "personal" ? null : { kind: "engagement", ref: "e" },
		rate_source: kind === "assignment" ? "engagement_cost" : "none",
		workspace_tag: null,
		approver_hint: kind === "assignment" ? "hirer" : "workspace",
		...over,
	};
}

const agreement = option("assignment", ASG, "Acme Corp", {
	engagement_id: "eng-1",
});
const team = option("team", TEAM, "Prodigitality Services Inc. Team", {
	sheet_scope: { kind: "workspace", ref: "w" },
});

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
		retroactive_days: 7,
		rounding_minutes: 15,
		weekly_limit_minutes: 2400,
		reminder_days: 1,
		hidden_presets: [],
		tracking_mode: "required",
		sources: { allow_manual_entries: "contract" },
		plan: { time_tracking: true, time_team_rules: false },
		policy_workspace_id: "w",
		team_override_applied: false,
		member: null,
		client_hours_detail_level: "summary",
		engagement_id: "eng-1",
		...over,
	};
}

let client: QueryClient;

function renderWithClient(ui: ReactElement) {
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-10-06T04:00:00.000Z"));
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	useAuthStore.setState({ user: { id: USER } as never });
	vi.spyOn(timeService, "getRunning").mockResolvedValue(null);
	vi.spyOn(timeService, "getPreferences").mockResolvedValue(null);
	vi.spyOn(timeService, "listMyProjects").mockResolvedValue({
		projects: [
			{
				id: "p1",
				title: "Acme Website",
				workspace_id: "w1",
				options: 1,
				default_kind: "assignment",
			},
		],
	});
	vi.spyOn(timeService, "getWorkItems").mockResolvedValue({
		tasks: [],
		presets: ["meeting", "review", "admin", "other"],
	});
	vi.spyOn(timeService, "listMyEntries").mockResolvedValue({
		items: [],
		total: 0,
		page: 1,
		limit: 200,
	});
});

afterEach(() => {
	cleanup();
	client.clear();
	useAuthStore.setState({ user: null });
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe("native copy", () => {
	it("the static copy never uses a banned word", () => {
		for (const text of [
			...Object.values(QUICK_ADD_COPY),
			...Object.values(TASK_PICKER_COPY),
			...Object.values(MANUAL_ENTRY_COPY),
		]) {
			expect(text).not.toMatch(BANNED);
		}
	});

	it("the agreement's inline reasons say 'agreement'", () => {
		const off = manualEntryRule({
			policy: policy({ allow_manual_entries: false }),
			option: agreement,
			day: "2026-10-06",
			timezone: "Asia/Manila",
			native: true,
		});
		expect(off.message).toBe(
			"Manual time is off in your agreement with Acme Corp.",
		);
		const window = manualEntryRule({
			policy: policy(),
			option: agreement,
			day: "2026-09-01",
			timezone: "Asia/Manila",
		});
		expect(window.message).toBe(
			"Your agreement with Acme Corp accepts time up to 7 days back.",
		);
	});

	it("quick add on an agreement with manual time off", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [agreement], selected: agreement }),
		);
		vi.spyOn(timeService, "getProjectPolicy").mockResolvedValue(
			policy({ allow_manual_entries: false }),
		);
		renderWithClient(<QuickAddBar />);
		await screen.findByText(
			"Manual time is off in your agreement with Acme Corp.",
		);
		assertNativeSafe();
		// The read-only chip's "Who approves this time" popover too.
		fireEvent.click(screen.getByRole("button", { name: /Acme Corp/ }));
		await screen.findByText("Who approves this time");
		assertNativeSafe();
	});

	it("the full form with two options, an unavailable agreement and a server refusal", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({
				options: [agreement, team],
				prefill: agreement,
				unavailable: [
					{
						kind: "assignment",
						id: "a2",
						label: "Pixel Studio",
						reason: "contract_disabled",
					},
				],
			}),
		);
		vi.spyOn(timeService, "getProjectPolicy").mockResolvedValue(policy());
		vi.spyOn(timeService, "createEntry").mockRejectedValue(
			new TimeApiError({
				status: 422,
				code: "HOUR_CAP_EXCEEDED",
				message: "Over the contract cap of USD 400.00 (rate 10/h).",
				extras: { limit_window: "weekly", limit_hours: 40 },
			}),
		);
		renderWithClient(
			<ManualEntryModal
				open
				initial={{
					projectId: "p1",
					workItem: "meeting",
					startedAt: "2026-10-05T01:00:00.000Z",
					endedAt: "2026-10-05T02:00:00.000Z",
				}}
				onClose={vi.fn()}
			/>,
		);
		const add = await screen.findByRole("button", {
			name: "Add for Acme Corp",
		});
		await screen.findByText(
			/Time tracking is off in your agreement with Pixel Studio/,
		);
		assertNativeSafe();
		await waitFor(() =>
			expect((add as HTMLButtonElement).disabled).toBe(false),
		);
		fireEvent.click(add);
		await screen.findByRole("alert");
		assertNativeSafe();
	});

	it("the task picker's start step on an agreement", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
			forResult({ options: [agreement], selected: agreement }),
		);
		renderWithClient(<TaskPickerModal open onClose={vi.fn()} />);
		const taskColumn = await screen.findByRole("region", { name: "Task" });
		fireEvent.click(
			await within(taskColumn).findByRole("button", { name: /Meeting/ }),
		);
		await screen.findByText("Only option on this project");
		assertNativeSafe();
	});

	it("a locked agreement sheet's notice stays native-safe", async () => {
		const states: string[] = [];
		const controller = createEntryController(
			() => ({
				queryClient: client,
				toast: { success: vi.fn(), warning: vi.fn() },
			}),
			(state) => {
				if (state.locked) states.push(state.locked.message);
				if (state.error) states.push(state.error.message);
			},
		);
		vi.spyOn(timeService, "createEntry").mockRejectedValue(
			new TimeApiError({
				status: 409,
				code: "TIMESHEET_LOCKED",
				message: "x",
				extras: {
					reason: "period",
					timesheet_id: null,
					sheet_status: "approved",
				},
			}),
		);
		await controller.create({
			projectId: "p1",
			workItem: "meeting",
			startedAt: "2026-10-05T01:00:00.000Z",
			endedAt: "2026-10-05T02:00:00.000Z",
			loggingFor: { kind: "assignment", id: ASG },
			forLabel: "Acme Corp",
			forKind: "assignment",
		});
		expect(states.length).toBeGreaterThan(0);
		for (const text of states) {
			expect(text).not.toMatch(BANNED);
			expect(text).not.toMatch(AMOUNT);
		}
	});
});
