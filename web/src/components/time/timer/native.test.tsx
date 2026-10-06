/* @vitest-environment jsdom */

// Native copy rules (ux.md › Mobile; web blueprint §4) for the timer: the
// bar, the Switch prompt and every start prompt never say contract, rate,
// payout or invoice, never show an amount on an agreement, and never link to
// /engagements.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => true }));

import type { LoggingOption, TimeEntryView } from "@/services/time.types";
import { StartTimerPrompts, SwitchTimerPanel } from "./SwitchTimerDialog";
import { TimerBar } from "./TimerBar";
import type { ActiveTimer } from "./useActiveTimer";
import {
	IDLE_START_STATE,
	promptOf,
	type StartTimerFlow,
	type StartTimerState,
} from "./useStartTimer";

const BANNED = /\b(contracts?|rates?|payouts?|invoices?)\b/i;
const AMOUNT = /\b[A-Z]{3}\s?[\d,]+(\.\d+)?\b|[$€£₱]\s?\d/;

function assertNativeSafe(container: HTMLElement) {
	const text = document.body.textContent ?? container.textContent ?? "";
	expect(text).not.toMatch(BANNED);
	expect(text).not.toMatch(AMOUNT);
	for (const el of Array.from(document.body.querySelectorAll("[title]"))) {
		expect(el.getAttribute("title") ?? "").not.toMatch(BANNED);
	}
	expect(document.body.querySelector('a[href*="/engagements"]')).toBeNull();
}

const agreementEntry: TimeEntryView = {
	id: "e1",
	context_kind: "assignment",
	context_ref: "a1",
	context_label_snapshot: "Acme Corp",
	timesheet_id: null,
	work_item: "task",
	started_at: "2026-10-06T09:00:00.000Z",
	ended_at: null,
	paused_at: null,
	duration_seconds: null,
	break_seconds: 120,
	break_minutes: 2,
	payable_seconds: null,
	source: "timer",
	work_type_snapshot: "real_work",
	legacy_status: null,
	payout_id: null,
	flagged_reason: null,
	project_id: "p1",
	team_id: null,
	workspace_id: null,
	engagement_assignment_id: "a1",
	created_at: "2026-10-06T09:00:00.000Z",
	updated_at: "2026-10-06T09:00:00.000Z",
	timesheet: null,
	locked_reason: null,
	identity: "visible",
	member_user_id: "u1",
	member_display_name_snapshot: "Leo",
	member: null,
	member_label: null,
	content: "visible",
	task_id: "task-1",
	note: null,
	task: { id: "task-1", title: "Build the API", work_type: null, status: null },
	project: { id: "p1", title: "Acme Website" },
	content_label: null,
	// The person's own cost is visible on the web; native shows no amounts.
	cost: "visible",
	rate_snapshot: 25,
	currency_snapshot: "USD",
	amount_snapshot: null,
};

function timer(): ActiveTimer {
	return {
		entry: agreementEntry,
		query: {} as ActiveTimer["query"],
		isRunning: true,
		isPaused: false,
		runningTaskId: "task-1",
		runningProjectId: "p1",
		runningEntryId: "e1",
		workSeconds: 3600,
		breakSeconds: 120,
		isBusy: false,
		isPausing: false,
		isStopping: false,
		pause: vi.fn(),
		resume: vi.fn(),
		toggleBreak: vi.fn(),
		stop: vi.fn(),
		stopAsync: vi.fn(async () => true),
	};
}

const agreement: LoggingOption = {
	kind: "assignment",
	id: "a1",
	label: "Acme Corp",
	sheet_scope: { kind: "engagement", ref: "e1" },
	rate_source: "engagement_cost",
	workspace_tag: null,
	approver_hint: "hirer",
	engagement_id: "eng-1",
};

function fakeFlow(patch: Partial<StartTimerState>): StartTimerFlow {
	const state: StartTimerState = { ...IDLE_START_STATE, ...patch };
	return {
		state,
		step: state.step,
		isPending: false,
		isOpen: true,
		prompt: state.step === "blocked" ? "blocked" : promptOf(state),
		start: vi.fn(),
		confirmSwitch: vi.fn(),
		select: vi.fn(),
		setRemember: vi.fn(),
		confirmPick: vi.fn(),
		withdrawAndRetry: vi.fn(),
		cancel: vi.fn(),
	} as unknown as StartTimerFlow;
}

function wrap(children: ReactNode) {
	return (
		<QueryClientProvider client={new QueryClient()}>
			{children}
		</QueryClientProvider>
	);
}

afterEach(() => {
	cleanup();
});

describe("timer surfaces on native", () => {
	it("the timer bar on an agreement", () => {
		const { container } = render(wrap(<TimerBar timer={timer()} />));
		expect(container.textContent).toContain("Acme Corp");
		expect(container.textContent).toContain("Build the API");
		assertNativeSafe(container);
	});

	it("the approver-mode pill", () => {
		const { container } = render(
			wrap(<TimerBar variant="pill" timer={timer()} onStartTimer={vi.fn()} />),
		);
		assertNativeSafe(container);
	});

	it("the Switch prompt", () => {
		const { container } = render(
			<SwitchTimerPanel
				running={agreementEntry}
				onSwitch={vi.fn()}
				onCancel={vi.fn()}
			/>,
		);
		assertNativeSafe(container);
	});

	it.each([
		[
			"pick",
			{
				step: "pick" as const,
				request: { projectId: "p1" },
				result: {
					options: [
						agreement,
						{ ...agreement, id: "a2", label: "Pixel Studio" },
					],
					selected: null,
					prefill: agreement,
					unavailable: [
						{
							kind: "assignment" as const,
							id: "a3",
							label: "Leo Cruz",
							reason: "contract_disabled" as const,
						},
					],
				},
				choice: { kind: "assignment" as const, id: "a1" },
			},
		],
		[
			"locked",
			{
				step: "locked" as const,
				request: { projectId: "p1" },
				locked: {
					timesheetId: "s1",
					sheetStatus: "submitted" as const,
					label: "Acme Corp",
					periodKind: "weekly" as const,
					canWithdraw: true,
					withdrawing: false,
					message:
						"This week's Acme Corp timesheet is submitted. Withdraw it to add time.",
				},
			},
		],
		[
			"blocked",
			{
				step: "blocked" as const,
				request: { projectId: "p1" },
				blocked: {
					title: "You can't log time on this project",
					why: "Time on this project is logged under an agreement, and you aren't on one.",
				},
			},
		],
	])("the %s prompt", (_name, patch) => {
		const { container } = render(
			<StartTimerPrompts flow={fakeFlow(patch as Partial<StartTimerState>)} />,
		);
		expect(document.body.textContent?.length ?? 0).toBeGreaterThan(0);
		assertNativeSafe(container);
	});
});
