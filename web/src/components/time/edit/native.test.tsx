/* @vitest-environment jsdom */

// Native copy rules (ux.md › Mobile; web blueprint §4): in the installed app
// the edit, delete and Change For dialogs never say contract, rate, payout or
// invoice, never show an amount on agreement time and never link to
// /engagements.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => true }));
vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		success: vi.fn(),
		error: vi.fn(),
		warning: vi.fn(),
		info: vi.fn(),
	}),
}));

import { TimeApiError, timeService } from "@/services/time.service";
import type {
	LoggingOption,
	ResolvedTimePolicy,
	TimeEntryView,
} from "@/services/time.types";
import { entryLockCopy } from "../entries/entryRules";
import {
	CHANGE_FOR_COPY,
	ChangeForDialog,
	changeForErrorCopy,
	changeForRowState,
} from "./ChangeForDialog";
import { DeleteEntryModal } from "./DeleteEntryModal";
import { EditEntryModal } from "./EditEntryModal";

const BANNED = /\b(contracts?|rates?|payouts?|invoices?)\b/i;
const AMOUNT = /\b[A-Z]{3}\s?[\d,]+(\.\d+)?\b|[$€£₱]\s?\d/;
const TZ = "Asia/Manila";

function assertNativeSafe(text: string) {
	expect(text).not.toMatch(BANNED);
	expect(text).not.toMatch(AMOUNT);
}

function assertDomSafe() {
	assertNativeSafe(document.body.textContent ?? "");
	for (const el of Array.from(document.body.querySelectorAll("[title]"))) {
		expect(el.getAttribute("title") ?? "").not.toMatch(BANNED);
	}
	expect(document.body.querySelector('a[href*="/engagements"]')).toBeNull();
}

function agreementEntry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return {
		id: "e1",
		context_kind: "assignment",
		context_ref: "a1",
		context_label_snapshot: "Acme Corp contract",
		timesheet_id: "s1",
		work_item: "task",
		started_at: "2026-10-05T01:00:00.000Z",
		ended_at: "2026-10-05T04:30:00.000Z",
		paused_at: null,
		duration_seconds: 12_600,
		break_seconds: 0,
		break_minutes: 0,
		payable_seconds: null,
		source: "manual",
		work_type_snapshot: "real_work",
		legacy_status: null,
		payout_id: null,
		flagged_reason: null,
		project_id: "p1",
		team_id: null,
		workspace_id: null,
		engagement_assignment_id: "a1",
		created_at: "2026-10-05T04:30:00.000Z",
		updated_at: "2026-10-05T04:30:00.000Z",
		timesheet: {
			id: "s1",
			status: "open",
			period_start: "2026-10-05",
			period_end: "2026-10-11",
			decision_kind: null,
			decided_by: null,
			decided_at: null,
			decision_note: null,
			scope_label_snapshot: "Acme Corp",
		},
		locked_reason: null,
		identity: "visible",
		member_user_id: "u1",
		member_display_name_snapshot: "Rico",
		member: null,
		member_label: null,
		content: "visible",
		task_id: "task-1",
		note: null,
		task: {
			id: "task-1",
			title: "Design review",
			work_type: null,
			status: null,
		},
		project: { id: "p1", title: "Acme Website" },
		content_label: null,
		cost: "visible",
		rate_snapshot: 950,
		rate_type_snapshot: "hourly",
		currency_snapshot: "PHP",
		amount_snapshot: 3325,
		...over,
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
		sheet_scope:
			kind === "personal"
				? null
				: kind === "assignment"
					? { kind: "engagement", ref: "eng-1" }
					: { kind: "workspace", ref: id ?? "" },
		rate_source: kind === "assignment" ? "engagement_cost" : "none",
		workspace_tag: null,
		approver_hint: kind === "assignment" ? "hirer" : "workspace",
		engagement_id: kind === "assignment" ? "eng-1" : undefined,
	};
}

const policy: ResolvedTimePolicy = {
	tracking_enabled: true,
	period_kind: "weekly",
	week_start: 1,
	timezone: TZ,
	period_anchor: null,
	approval_required: true,
	approver_scope: "workspace",
	allow_manual_entries: true,
	retroactive_days: 7,
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
	engagement_id: "eng-1",
};

function wrapper({ children }: { children: ReactNode }) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("native: edit dialogs", () => {
	it("Edit shows an agreement entry without banned words or amounts", async () => {
		vi.spyOn(timeService, "getProjectPolicy").mockResolvedValue(policy);
		render(
			<EditEntryModal
				open
				entry={agreementEntry()}
				timeZone={TZ}
				onClose={() => {}}
			/>,
			{ wrapper },
		);
		await screen.findByText(
			"Your agreement with Acme Corp agreement accepts time up to 7 days back.",
		);
		assertDomSafe();
	});

	it("Edit and Delete explain locks without banned words", () => {
		for (const locked_reason of [
			"paid",
			"billed",
			"legacy",
			"frozen",
			"sheet_submitted",
			"sheet_approved",
		] as const) {
			const text = entryLockCopy(agreementEntry({ locked_reason }), {
				timeZone: TZ,
				native: true,
			});
			expect(text).toBeTruthy();
			assertNativeSafe(text ?? "");
		}
		render(
			<DeleteEntryModal
				open
				entry={agreementEntry({ locked_reason: "billed" })}
				timeZone={TZ}
				onClose={() => {}}
			/>,
			{ wrapper },
		);
		expect(
			screen.getByText(
				"This time is already being billed, so it can't change.",
			),
		).toBeTruthy();
		assertDomSafe();
	});

	it("Change For never mentions rates and keeps agreement labels safe", async () => {
		vi.spyOn(timeService, "getLoggingFor").mockResolvedValue({
			options: [
				option("assignment", "a1", "Acme Corp contract"),
				option("workspace", "w1", "Acme"),
			],
			selected: null,
			prefill: null,
			unavailable: [
				{
					kind: "assignment",
					id: "a2",
					label: "Pixel contract",
					reason: "contract_disabled",
				},
			],
		});
		render(
			<ChangeForDialog
				open
				entries={[
					agreementEntry(),
					agreementEntry({ id: "e2", locked_reason: "paid", payout_id: "po1" }),
				]}
				timeZone={TZ}
				onClose={() => {}}
			/>,
			{ wrapper },
		);
		await waitFor(() =>
			expect(
				screen.getByRole("group", { name: "Choose who this time is for" }),
			).toBeTruthy(),
		);
		expect(
			screen.queryByText("Rates are re-estimated for the new choice."),
		).toBeNull();
		assertDomSafe();
	});

	it("row reasons and failures stay native-safe", () => {
		const target = option("assignment", "a1", "Acme Corp contract");
		const reasons = [
			changeForRowState(agreementEntry({ context_ref: "zz" }), target, {
				native: true,
				notCovered: true,
			}).reason,
			changeForRowState(agreementEntry(), target, { native: true }).reason,
			changeForRowState(agreementEntry({ locked_reason: "paid" }), target, {
				native: true,
			}).reason,
		];
		for (const reason of reasons) assertNativeSafe(reason ?? "");

		const failures = [
			new TimeApiError({
				status: 409,
				code: "TIMESHEET_HAS_SETTLED_ENTRIES",
				message: "x",
				extras: { reason: "billed", invoice_number: "INV-0042" },
			}),
			new TimeApiError({
				status: 422,
				code: "HOUR_CAP_EXCEEDED",
				message: "x",
				extras: { limit_window: "weekly", limit_hours: 40 },
			}),
			new TimeApiError({
				status: 422,
				code: "LOGGING_FOR_INVALID",
				message:
					"This time is from before the agreement, so it can't move onto it.",
			}),
			new TimeApiError({
				status: 403,
				code: "PAYOUT_SELF_NOT_ALLOWED",
				message: "x",
			}),
		];
		for (const failure of failures) {
			assertNativeSafe(
				changeForErrorCopy(failure, target, { native: true }).message,
			);
		}
		assertNativeSafe(CHANGE_FOR_COPY.notAvailableOnDay);
	});
});
