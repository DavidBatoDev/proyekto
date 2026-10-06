/* @vitest-environment jsdom */

// Native copy rules (ux.md › Mobile; web blueprint §4) for the timer
// surfaces moved in W1-6: the floating timer, the task panel's inline timer
// and the task-row button never say contract, rate, payout or invoice, never
// show an amount on an agreement, and never link to /engagements.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => true }));

const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		useRouterState: ({
			select,
		}: {
			select: (state: { location: { pathname: string } }) => unknown;
		}) => select({ location: { pathname: "/dashboard" } }),
		Link: ({
			children,
			to,
			params,
			search,
			className,
			title,
		}: {
			children?: ReactNode;
			to: string;
			params?: Record<string, string>;
			search?: Record<string, string>;
			className?: string;
			title?: string;
		}) => {
			let href = to;
			for (const [key, value] of Object.entries(params ?? {})) {
				href = href.replace(`$${key}`, value);
			}
			if (search) href += `?${new URLSearchParams(search).toString()}`;
			return createElement("a", { href, className, title }, children);
		},
	};
});

import { timeKeys } from "@/queries/time";
import { timeService } from "@/services/time.service";
import type {
	LoggingForResult,
	LoggingOption,
	TimeEntryView,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import { FloatingActiveTimer } from "./FloatingActiveTimer";
import { TaskTimerButton } from "./TaskTimerButton";
import { TaskTimerInline } from "./TaskTimerInline";

const BANNED = /\b(contracts?|rates?|payouts?|invoices?)\b/i;
const AMOUNT = /\b[A-Z]{3}\s?[\d,]+(\.\d+)?\b|[$€£₱]\s?\d/;

function assertNativeSafe() {
	const text = document.body.textContent ?? "";
	expect(text).not.toMatch(BANNED);
	expect(text).not.toMatch(AMOUNT);
	for (const el of Array.from(
		document.body.querySelectorAll("[title], [aria-label]"),
	)) {
		expect(el.getAttribute("title") ?? "").not.toMatch(BANNED);
		expect(el.getAttribute("aria-label") ?? "").not.toMatch(BANNED);
	}
	expect(document.body.querySelector('a[href*="/engagements"]')).toBeNull();
}

const USER = "user-1";
const PROJECT = "p1";

/** The talent's own agreement time, with its cost visible on the web. */
const agreementEntry: TimeEntryView = {
	id: "e1",
	context_kind: "assignment",
	context_ref: "a1",
	context_label_snapshot: "Acme Corp",
	timesheet_id: null,
	work_item: "task",
	started_at: new Date(Date.now() - 3600_000).toISOString(),
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
	project_id: PROJECT,
	team_id: null,
	workspace_id: null,
	engagement_assignment_id: "a1",
	created_at: new Date().toISOString(),
	updated_at: new Date().toISOString(),
	timesheet: null,
	locked_reason: null,
	identity: "visible",
	member_user_id: USER,
	member_display_name_snapshot: "Leo",
	member: null,
	member_label: null,
	content: "visible",
	task_id: "task-1",
	note: null,
	task: { id: "task-1", title: "Build the API", work_type: null, status: null },
	project: { id: PROJECT, title: "Acme Website" },
	content_label: null,
	cost: "visible",
	rate_snapshot: 25,
	rate_type_snapshot: "hourly",
	currency_snapshot: "USD",
	amount_snapshot: 25,
};

const agreement: LoggingOption = {
	kind: "assignment",
	id: "a1",
	label: "Acme Corp",
	sheet_scope: { kind: "engagement", ref: "eng-1" },
	rate_source: "engagement_cost",
	workspace_tag: null,
	approver_hint: "hirer",
	engagement_id: "eng-1",
};

let client: QueryClient;

function renderNative(
	ui: ReactElement,
	opts: { running: TimeEntryView | null; forResult?: LoggingForResult },
) {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	client.setQueryData(timeKeys.running(USER), opts.running);
	vi.spyOn(timeService, "getRunning").mockResolvedValue(opts.running);
	vi.spyOn(timeService, "getLoggingFor").mockResolvedValue(
		opts.forResult ?? {
			options: [agreement],
			selected: agreement,
			prefill: null,
			unavailable: [],
		},
	);
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

beforeEach(() => {
	useAuthStore.setState({ user: { id: USER } as never });
});

afterEach(() => {
	cleanup();
	client?.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe("timer surfaces on native", () => {
	it("the floating timer on an agreement", async () => {
		renderNative(<FloatingActiveTimer />, { running: agreementEntry });
		await screen.findByRole("link", { name: "Open in Time" });
		expect(document.body.textContent).toContain("Acme Corp");
		expect(document.body.textContent).toContain("Build the API");
		assertNativeSafe();
	});

	it("the inline timer running on an agreement", async () => {
		renderNative(<TaskTimerInline projectId={PROJECT} taskId="task-1" />, {
			running: agreementEntry,
		});
		await screen.findByRole("button", { name: "Stop" });
		expect(document.body.textContent).toContain("Acme Corp");
		assertNativeSafe();
	});

	it("the inline timer idle on an agreement (the only option)", async () => {
		renderNative(<TaskTimerInline projectId={PROJECT} taskId="task-1" />, {
			running: null,
		});
		await screen.findByRole("button", { name: "Start timer" });
		expect(document.body.textContent).toContain("Acme Corp");
		assertNativeSafe();
	});

	it("the inline timer's 0-option card and its Why?", async () => {
		renderNative(<TaskTimerInline projectId={PROJECT} taskId="task-1" />, {
			running: null,
			forResult: {
				options: [],
				selected: null,
				prefill: null,
				reason: "none",
				unavailable: [],
			},
		});
		fireEvent.click(await screen.findByRole("button", { name: "Why?" }));
		await screen.findByRole("dialog");
		assertNativeSafe();
	});

	it("the task-row button, idle and running", async () => {
		renderNative(
			<>
				<TaskTimerButton projectId={PROJECT} taskId="task-1" />
				<TaskTimerButton projectId={PROJECT} taskId="task-2" />
			</>,
			{ running: agreementEntry },
		);
		await screen.findByRole("button", { name: "Stop timer" });
		await screen.findByRole("button", { name: "Start timer" });
		assertNativeSafe();
	});
});
