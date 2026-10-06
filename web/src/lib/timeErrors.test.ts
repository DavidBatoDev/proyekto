import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanLimitError } from "@/lib/planLimitErrors";
import { TimeApiError } from "@/services/time.service";
import {
	TIME_ERROR_CODES,
	type TimeApiErrorCode,
	type TimesheetTransitionInvalidReason,
} from "@/services/time.types";
import {
	APPROVAL_DISABLED_COPY,
	beforeAgreementCopy,
	bulkApproveFailedCopy,
	changeForRatesNote,
	contractLimitCopy,
	entryWarningCopy,
	entryWarningsCopy,
	flaggedReasonCopy,
	hasAmount,
	hasNativeForbiddenWords,
	hourCapCopy,
	isTimePlanKey,
	lockedChipCopy,
	lockedPeriodCopy,
	manualTimeOffCopy,
	NATIVE_FALLBACK_COPY,
	NATIVE_WEB_ONLY_COPY,
	nativeSafe,
	nativeSafeHref,
	overLimitCopy,
	policyLimitCopy,
	retroactiveWindowCopy,
	settledEntriesCopy,
	staleRevisionCopy,
	switchTimerPrompt,
	TIME_ACCOUNT_DELETION_COPY,
	TIME_PLAN_KEYS,
	type TimeErrorCopyContext,
	type TimeToastAction,
	timeErrorCopy,
	timeErrorMessage,
	timePlanCopy,
	timePlanDowngradeCopy,
	timeToast,
	transitionReasonCopy,
	weeklyLimitLine,
} from "./timeErrors";

const platform = vi.hoisted(() => ({ native: false }));
vi.mock("@/lib/platform", () => ({ isNativeApp: () => platform.native }));

afterEach(() => {
	platform.native = false;
});

const NOW = new Date("2026-10-06T04:00:00Z");
const DATES = { now: NOW, userTimezone: "Asia/Manila" };

function apiError(
	code: string,
	extras: Record<string, unknown> = {},
	options: { status?: number; message?: string } = {},
): TimeApiError {
	return new TimeApiError({
		status: options.status ?? 409,
		code: code as TimeApiErrorCode,
		message: options.message ?? "Server copy.",
		extras,
	});
}

function axiosError(status: number, data: unknown) {
	return { isAxiosError: true, response: { status, data } };
}

const TEAM = "Prodigitality Services Inc. Team";
const TRANSITION_REASONS: TimesheetTransitionInvalidReason[] = [
	"action",
	"arguments",
	"note_too_long",
	"not_allowed",
	"state",
	"empty",
	"running_entry",
	"too_early",
	"not_auto",
	"note_required",
	"freeze_required",
	"freeze_invalid",
	"use_request_reopen",
];

describe("the copy table (ux.md › Error codes as shown to people)", () => {
	const web: TimeErrorCopyContext = { native: false };

	it("gives every time error code its own copy, never the code itself", () => {
		const generic = timeErrorMessage(
			apiError("SOMETHING_NEW", {}, { message: "x" }),
			web,
		);
		expect(generic).toBe(
			"Proyekto couldn't finish this. Check the details and try again.",
		);
		for (const code of TIME_ERROR_CODES) {
			const copy = timeErrorCopy(apiError(code, {}, { message: "x" }), web);
			expect(copy.code).toBe(code);
			expect(copy.message, code).not.toContain(code);
			expect(copy.message, code).not.toMatch(/_/);
			expect(copy.message, code).not.toBe(generic);
			expect(copy.message.length, code).toBeGreaterThan(10);
		}
	});

	it("writes the ux.md rows word for word", () => {
		const msg = (code: string, extras = {}, ctx: TimeErrorCopyContext = {}) =>
			timeErrorMessage(apiError(code, extras), { ...web, ...DATES, ...ctx });

		expect(msg("LOGGING_FOR_INVALID")).toBe(
			"That choice isn't available any more. Pick again.",
		);
		expect(msg("NO_LOGGING_CONTEXT")).toBe(
			"You can't log time on this project.",
		);
		expect(msg("TIME_ENTRY_NO_PROJECT_ACCESS")).toBe(
			"You don't have access to this project.",
		);
		expect(msg("TIME_ENTRY_NOT_ON_PROJECT_TEAM", {}, { label: TEAM })).toBe(
			"You're not on Prodigitality Services Inc. Team for this project.",
		);
		expect(msg("TIME_ENTRY_NOT_WORKSPACE_MEMBER", {}, { label: "Acme" })).toBe(
			"You need a seat in Acme to log time for it.",
		);
		expect(msg("TIMESHEET_LOCKED", { reason: "entry", lock: "paid" })).toBe(
			"This entry is on a submitted or approved timesheet.",
		);
		expect(
			msg(
				"TIMESHEET_LOCKED",
				{ reason: "period", timesheet_id: "s1", sheet_status: "submitted" },
				{ label: "Prodigitality" },
			),
		).toBe(
			"This week's Prodigitality timesheet is submitted. Withdraw it to add time.",
		);
		expect(
			msg(
				"MANUAL_ENTRIES_DISABLED",
				{},
				{ label: "Prodigitality", labelKind: "team" },
			),
		).toBe("Manual time is off for Prodigitality.");
		expect(
			msg(
				"RETROACTIVE_WINDOW",
				{ earliest_date: "2026-09-29" },
				{ label: "Prodigitality", labelKind: "team", retroactiveDays: 7 },
			),
		).toBe("Prodigitality accepts time up to 7 days back.");
		expect(
			msg(
				"HOUR_CAP_EXCEEDED",
				{ limit_window: "weekly", limit_hours: 40, logged_hours: 41 },
				{ label: TEAM },
			),
		).toBe(
			"This goes past the 40h weekly limit for Prodigitality Services Inc. Team.",
		);
		expect(msg("PAYOUT_SELF_NOT_ALLOWED")).toBe(
			"Someone else on the team has to record your payment.",
		);
		expect(msg("FIXED_RATE_NOT_PAYABLE_BY_ENTRY")).toBe(
			"Fixed-fee time is paid as a manual payment, not by entry.",
		);
		expect(msg("LEGACY_CONTRACT_AMBIGUOUS", { reason: "teams" })).toBe(
			"More than one team could bill hours on this contract. Set the provider's team on the contract first.",
		);
		expect(msg("ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER")).toBe(
			"This agreement's hirer doesn't deliver the client agreement on this project.",
		);
		expect(msg("TEAM_RATES_REQUIRE_APPROVAL")).toBe(
			"Approval stays on while member rates are on.",
		);
		expect(msg("ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED")).toBe(
			"Which client agreement is this work for?",
		);
		expect(msg("TIME_NOT_FOUND")).toBe(
			"This time entry doesn't exist or you can't open it.",
		);
		expect(msg("TIMESHEET_NOT_FOUND")).toBe(
			"This timesheet doesn't exist or you can't open it.",
		);
		expect(msg("TIMESHEETS_REPLACED_REVIEW")).toBe(
			"Approvals now happen by timesheet. Reload Proyekto.",
		);
		expect(msg("APP_UPDATE_REQUIRED")).toBe(
			"Update Proyekto to keep tracking time",
		);
	});

	it("marks the hidden rows and replaces them on native", () => {
		for (const code of [
			"PAYOUT_SELF_NOT_ALLOWED",
			"FIXED_RATE_NOT_PAYABLE_BY_ENTRY",
			"LEGACY_CONTRACT_AMBIGUOUS",
			"ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER",
			"INVOICE_TIME_ENTRY_NOT_BILLABLE",
		]) {
			expect(timeErrorCopy(apiError(code), web).hidden, code).toBe(true);
			expect(timeErrorCopy(apiError(code), { native: true })).toMatchObject({
				hidden: true,
				message: NATIVE_WEB_ONLY_COPY,
			});
		}
		expect(timeErrorCopy(apiError("NO_LOGGING_CONTEXT"), web).hidden).toBe(
			false,
		);
	});

	it("says what to offer next", () => {
		const action = (code: string, extras = {}) =>
			timeErrorCopy(apiError(code, extras), web).action;
		expect(action("NO_LOGGING_CONTEXT")).toBe("why");
		expect(action("LOGGING_FOR_REQUIRED")).toBe("pick_for");
		expect(action("LOGGING_FOR_INVALID")).toBe("pick_for");
		expect(action("TIMER_ALREADY_RUNNING")).toBe("switch_timer");
		expect(
			action("TIMESHEET_LOCKED", {
				reason: "period",
				sheet_status: "submitted",
			}),
		).toBe("withdraw");
		expect(
			action("TIMESHEET_LOCKED", {
				reason: "period",
				sheet_status: "approved",
			}),
		).toBeNull();
		expect(action("STALE_REVISION", { timesheet_id: "s1" })).toBe(
			"review_latest",
		);
		expect(action("STALE_REVISION", { entry_id: "e1", updated_at: "x" })).toBe(
			"reload",
		);
		expect(action("APP_UPDATE_REQUIRED")).toBe("update_app");
		expect(
			timeErrorCopy(apiError("TIMESHEETS_REPLACED_REVIEW"), { native: true })
				.action,
		).toBe("update_app");
		expect(action("TIME_INTERNAL")).toBe("retry");
	});

	it("flags 404s for a reason card", () => {
		expect(
			timeErrorCopy(apiError("TIME_NOT_FOUND", {}, { status: 404 }), web),
		).toMatchObject({ notFound: true, status: 404 });
		expect(
			timeErrorCopy(
				apiError(
					"TIME_NOT_FOUND",
					{},
					{
						status: 404,
						message: "This doesn't exist or you can't open it.",
					},
				),
				web,
			).message,
		).toBe("This doesn't exist or you can't open it.");
		expect(
			timeErrorCopy(apiError("HTTP_404", {}, { status: 404, message: "x" }), {
				...web,
				subject: "timesheet",
			}),
		).toMatchObject({
			notFound: true,
			message: "This timesheet doesn't exist or you can't open it.",
		});
		expect(
			timeErrorMessage(apiError("HTTP_404", {}, { status: 404 }), web),
		).toBe("This doesn't exist or you can't open it.");
	});
});

describe("context-dependent rows", () => {
	it("uses the agreement wording for agreement time", () => {
		expect(manualTimeOffCopy({ label: "Acme", labelKind: "assignment" })).toBe(
			"Manual time is off in your agreement with Acme.",
		);
		expect(manualTimeOffCopy({ label: "Acme", labelKind: "engagement" })).toBe(
			"Manual time is off in your agreement with Acme.",
		);
		expect(manualTimeOffCopy()).toBe("Manual time is off here.");
		expect(
			retroactiveWindowCopy({
				label: "Acme",
				labelKind: "assignment",
				days: 7,
			}),
		).toBe("Your agreement with Acme accepts time up to 7 days back.");
	});

	it("words the retroactive window from days, else from the earliest date", () => {
		expect(retroactiveWindowCopy({ label: "Prodigitality", days: 1 })).toBe(
			"Prodigitality accepts time up to 1 day back.",
		);
		expect(
			retroactiveWindowCopy({
				label: "Prodigitality",
				earliestDate: "2026-09-29",
				...DATES,
			}),
		).toBe("Prodigitality accepts time from Sep 29 on.");
		expect(retroactiveWindowCopy({})).toBe(
			"This project doesn't accept time this far back.",
		);
	});

	it("locks periods by kind and status", () => {
		expect(lockedPeriodCopy()).toBe(
			"This week's timesheet is submitted. Withdraw it to add time.",
		);
		expect(
			lockedPeriodCopy({ label: "Acme", periodKind: "semi_monthly" }),
		).toBe(
			"This period's Acme timesheet is submitted. Withdraw it to add time.",
		);
		expect(lockedPeriodCopy({ label: "Acme", sheetStatus: "approved" })).toBe(
			"This week's Acme timesheet is approved, so its time can't change.",
		);
	});

	it("words hour caps by window", () => {
		expect(
			hourCapCopy(
				{ limit_window: "monthly", limit_hours: 37.5 },
				{ label: "Design" },
			),
		).toBe("This goes past the 37h 30m monthly limit for Design.");
		expect(hourCapCopy({ limit_hours: 40 })).toBe(
			"This goes past your 40h weekly limit.",
		);
		expect(hourCapCopy(null, { label: "Design" })).toBe(
			"This goes past the weekly limit for Design.",
		);
	});

	it("names the person on a stale timesheet and on a failed bulk approve", () => {
		expect(
			timeErrorMessage(apiError("STALE_REVISION", { timesheet_id: "s1" }), {
				native: false,
				personName: "Maria Santos",
			}),
		).toBe("Maria changed this timesheet while you were looking.");
		expect(staleRevisionCopy()).toEqual({
			message: "This timesheet changed while you were looking.",
			actionLabel: "Review the latest",
		});
		expect(staleRevisionCopy({ subject: "entry" })).toEqual({
			message: "This entry changed. Reload to see the latest version.",
			actionLabel: "Reload",
		});
		expect(bulkApproveFailedCopy("Leo Cruz")).toEqual({
			message: "Nothing was approved: Leo Cruz's timesheet changed.",
			actionLabel: "Review",
		});
		expect(bulkApproveFailedCopy(null).message).toBe(
			"Nothing was approved: a timesheet changed.",
		);
	});

	it("lists invalid policy fields in people words", () => {
		expect(
			timeErrorMessage(
				apiError("TIME_POLICY_INVALID", { fields: ["timezone", "week_start"] }),
				{ native: false },
			),
		).toBe(
			"Those time settings aren't valid. Check the timezone and the week start.",
		);
		expect(
			timeErrorMessage(apiError("TIME_POLICY_INVALID", { fields: ["x_y"] }), {
				native: false,
			}),
		).toBe("Those time settings aren't valid.");
	});
});

describe("server messages", () => {
	const web = { native: false };

	it("keeps the backend's fixed sentences", () => {
		expect(
			timeErrorMessage(
				apiError(
					"HTTP_400",
					{},
					{
						status: 400,
						message: "Add a note so the person knows what to change.",
					},
				),
				web,
			),
		).toBe("Add a note so the person knows what to change.");
		expect(
			timeErrorMessage(
				apiError(
					"HTTP_400",
					{},
					{
						status: 400,
						message:
							"This export has more than 10,000 entries. Pick a shorter range.",
					},
				),
				web,
			),
		).toBe("This export has more than 10,000 entries. Pick a shorter range.");
		expect(
			timeErrorMessage(
				apiError(
					"WORK_ITEM_INVALID",
					{},
					{
						status: 422,
						message: "Pick a task or a work item, not both.",
					},
				),
				web,
			),
		).toBe("Pick a task or a work item, not both.");
		expect(
			timeErrorMessage(
				apiError(
					"TIMER_NOT_RUNNING",
					{},
					{
						message: "This timer is already on break.",
					},
				),
				web,
			),
		).toBe("This timer is already on break.");
	});

	it("never shows class-validator output or field names", () => {
		for (const message of [
			"note must be shorter than or equal to 2000 characters",
			"expected_revision must be an integer number; property foo should not exist",
			"Expected_revision must be a number.",
			"Bad",
		]) {
			expect(
				timeErrorMessage(
					apiError("HTTP_400", {}, { status: 400, message }),
					web,
				),
			).toBe("Proyekto couldn't finish this. Check the details and try again.");
		}
	});

	it("rewrites the owner-only refusal into people words", () => {
		expect(
			timeErrorMessage(
				apiError(
					"HTTP_403",
					{},
					{
						status: 403,
						message:
							"Only the team owner can change: approval_required, rounding_minutes",
					},
				),
				web,
			),
		).toBe("Only the team owner can change approval and rounding.");
		expect(
			timeErrorMessage(
				apiError(
					"HTTP_403",
					{},
					{
						status: 403,
						message: "Only the team owner can change: mystery",
					},
				),
				web,
			),
		).toBe("Only the team owner can change these rules.");
	});

	it("maps the 500 and the no-response cases", () => {
		expect(
			timeErrorMessage(
				apiError(
					"TIME_INTERNAL",
					{},
					{
						status: 500,
						message: "Proyekto couldn't load timesheets. Try again.",
					},
				),
				web,
			),
		).toBe("Proyekto couldn't load timesheets. Try again.");
		expect(
			timeErrorMessage(
				apiError(
					"TIME_INTERNAL",
					{},
					{
						status: 500,
						message: 'relation "x" does not exist',
					},
				),
				web,
			),
		).toBe("Proyekto couldn't save this time. Try again.");
		expect(
			timeErrorMessage(apiError("TIME_INTERNAL", {}, { status: 500 }), {
				...web,
				operation: "read",
			}),
		).toBe("Proyekto couldn't load this time. Try again.");
		expect(
			timeErrorCopy(
				apiError("HTTP_502", {}, { status: 502, message: "x" }),
				web,
			),
		).toMatchObject({
			message: "Proyekto couldn't finish this. Try again.",
			action: "retry",
		});
		expect(
			timeErrorCopy({ isAxiosError: true, request: {} }, web),
		).toMatchObject({
			code: "NETWORK_ERROR",
			status: 0,
			message:
				"Proyekto couldn't reach the server. Check your connection and try again.",
		});
		expect(
			timeErrorCopy(new TypeError("Cannot read properties of undefined"), web),
		).toMatchObject({
			code: "CLIENT_ERROR",
			message: "Something went wrong in Proyekto. Try again.",
		});
	});

	it("reads raw axios errors through the shared parser", () => {
		const raw = axiosError(409, {
			error: {
				code: "TIMESHEET_LOCKED",
				message: "x",
				status: 409,
				reason: "period",
				timesheet_id: "s1",
				sheet_status: "submitted",
			},
		});
		expect(timeErrorCopy(raw, { native: false, label: "Acme" })).toMatchObject({
			code: "TIMESHEET_LOCKED",
			status: 409,
			message:
				"This week's Acme timesheet is submitted. Withdraw it to add time.",
			action: "withdraw",
		});
	});

	it("words plan limits through the time plan copy", () => {
		const raw = axiosError(403, {
			error: {
				code: "plan_limit",
				kind: "feature",
				limit_key: "time_team_rules",
				label: "Team approvers and time rules",
				plan: "pro",
				upgrade_plan: "business",
				message: "x",
				status: 403,
			},
		});
		expect(timeErrorCopy(raw, { native: false })).toMatchObject({
			code: "plan_limit",
			planKey: "time_team_rules",
			message: "Team approvers and team time rules are part of Business.",
		});
		expect(
			timeErrorCopy(raw, { native: true, workspaceName: "Acme" }).message,
		).toBe("Team time rules aren't on Acme's current plan.");

		const billing = new PlanLimitError({
			limitKey: "time_billable_invoices",
			kind: "feature",
			label: "Billable hours on invoices",
			limit: null,
			used: null,
			plan: "free",
			upgradePlan: "pro",
			workspaceId: null,
			workspaceSlug: null,
			context: "create",
			message: "",
		});
		expect(timeErrorCopy(billing, { native: false })).toMatchObject({
			code: "plan_limit",
			planKey: "time_billable_invoices",
			message:
				"Billing hours on invoices is part of Pro. You can still sign a retainer or fixed-fee contract.",
		});
		expect(timeErrorCopy(billing, { native: true })).toMatchObject({
			hidden: true,
			message: NATIVE_WEB_ONLY_COPY,
		});
	});

	it("covers the account-deletion blockers and unknown codes", () => {
		expect(
			timeErrorMessage(apiError("TEAM_HAS_OPEN_TIME"), { native: false }),
		).toBe(TIME_ACCOUNT_DELETION_COPY.TEAM_HAS_OPEN_TIME);
		expect(
			timeErrorMessage(apiError("WORKSPACE_HAS_OPEN_TIME"), { native: false }),
		).toBe(
			"This workspace has time waiting for approval or payment. Hand it to another member instead of deleting it.",
		);
		expect(
			timeErrorMessage(
				apiError("SOMETHING_NEW", {}, { message: "Try a different day." }),
				{ native: false },
			),
		).toBe("Try a different day.");
		expect(
			timeErrorMessage(apiError("SOMETHING_NEW", {}, { message: "nope" }), {
				native: false,
			}),
		).toBe("Proyekto couldn't finish this. Check the details and try again.");
	});

	it("defaults to the platform when native isn't passed", () => {
		platform.native = true;
		expect(timeErrorMessage(apiError("TIMESHEETS_REPLACED_REVIEW"))).toBe(
			"Update the app to approve timesheets.",
		);
		expect(timeErrorMessage(apiError("TEAM_RATES_REQUIRE_APPROVAL"))).toBe(
			"Approval has to stay on for this team.",
		);
	});
});

describe("transition reasons", () => {
	it("words every M3 reason", () => {
		const seen = new Set<string>();
		for (const reason of TRANSITION_REASONS) {
			const text = transitionReasonCopy(reason);
			expect(text, reason).toMatch(/[.!?]$/);
			seen.add(text);
		}
		// action/arguments and the two freeze reasons share a sentence.
		expect(seen.size).toBe(TRANSITION_REASONS.length - 2);
		expect(transitionReasonCopy("mystery")).toBe(
			"This timesheet can't do that right now.",
		);
	});

	it("dates too_early and names the person on note_required", () => {
		expect(
			transitionReasonCopy("too_early", { periodEnd: "2026-10-11", ...DATES }),
		).toBe("You can submit this timesheet from Oct 11, its last day.");
		expect(transitionReasonCopy("too_early")).toBe(
			"You can submit this timesheet from its last day.",
		);
		expect(
			transitionReasonCopy("note_required", { personName: "Maria Santos" }),
		).toBe("Add a note so Maria knows what to change.");
		expect(
			timeErrorCopy(
				apiError("TIMESHEET_TRANSITION_INVALID", { reason: "freeze_invalid" }),
				{ native: false },
			).action,
		).toBe("review_latest");
		expect(
			timeErrorCopy(
				apiError("TIMESHEET_TRANSITION_INVALID", { reason: "state" }),
				{ native: false },
			).action,
		).toBe("reload");
	});
});

describe("settled entries (the reopen table)", () => {
	it("names the payout or invoice on web", () => {
		expect(
			settledEntriesCopy(
				{ reason: "paid", payout_id: "p1" },
				{ native: false, payoutLabel: "#12" },
			),
		).toEqual({
			message: "This timesheet is in payout #12. Void the payout to reopen.",
			link: { kind: "payout", id: "p1" },
		});
		expect(
			settledEntriesCopy({ reason: "paid", payout_id: "p1" }, { native: false })
				.message,
		).toBe("This timesheet is in a payout. Void the payout to reopen.");
		expect(
			settledEntriesCopy(
				{
					reason: "billed",
					invoice_id: "i1",
					invoice_number: "INV-0042",
					invoice_status: "draft",
				},
				{ native: false },
			),
		).toEqual({
			message:
				"These hours are on draft invoice INV-0042. Remove them from the draft to reopen.",
			link: { kind: "invoice", id: "i1" },
		});
		expect(
			settledEntriesCopy(
				{
					reason: "billed",
					invoice_id: "i1",
					invoice_number: "INV-0042",
					invoice_status: "issued",
				},
				{ native: false },
			).message,
		).toBe(
			"Billed on invoice INV-0042. Void it without a replacement to reopen.",
		);
		expect(
			settledEntriesCopy(
				{ reason: "billed", invoice_status: "sent" },
				{ native: false },
			).message,
		).toBe("Billed on an invoice. Void it without a replacement to reopen.");
		expect(
			settledEntriesCopy({ reason: "billed" }, { native: false }).message,
		).toBe(
			"These hours are on an invoice. Remove them from the draft, or void the invoice without a replacement, to reopen.",
		);
	});

	it("says paid outside Proyekto the same way everywhere", () => {
		const legacy =
			"Includes time paid outside Proyekto, so it can't be reopened.";
		for (const native of [false, true]) {
			expect(settledEntriesCopy({ reason: "legacy" }, { native }).message).toBe(
				legacy,
			);
			expect(
				settledEntriesCopy({ reason: "paid", paid_outside: true }, { native })
					.message,
			).toBe(legacy);
		}
	});

	it("uses the native rows with no numbers or links", () => {
		expect(
			settledEntriesCopy({ reason: "paid", payout_id: "p1" }, { native: true }),
		).toEqual({
			message: "This time has already been paid. Reopen it on the web.",
			link: null,
		});
		expect(
			settledEntriesCopy(
				{
					reason: "billed",
					invoice_number: "INV-0042",
					invoice_status: "draft",
				},
				{ native: true },
			),
		).toEqual({
			message: "This time is already being billed. Reopen it on the web.",
			link: null,
		});
		expect(settledEntriesCopy(null, { native: false }).message).toBe(
			"This timesheet has time that was already paid or billed, so it can't be reopened.",
		);
	});

	it("feeds the error copy", () => {
		expect(
			timeErrorMessage(
				apiError("TIMESHEET_HAS_SETTLED_ENTRIES", {
					timesheet_id: "s1",
					reason: "billed",
					invoice_number: "INV-0042",
					invoice_status: "issued",
				}),
				{ native: false },
			),
		).toBe(
			"Billed on invoice INV-0042. Void it without a replacement to reopen.",
		);
	});
});

describe("warnings", () => {
	it("words overlaps", () => {
		expect(
			entryWarningCopy(
				{ code: "OVERLAP", entry_ids: ["a"] },
				{ native: false },
			),
		).toBe("This overlaps another entry.");
		expect(
			entryWarningCopy(
				{ code: "OVERLAP", entry_ids: ["a", "b"] },
				{ native: false },
			),
		).toBe("This overlaps 2 other entries.");
	});

	it("words the agreement limit as ux.md does", () => {
		expect(
			entryWarningCopy(
				{
					code: "CONTRACT_WEEKLY_LIMIT",
					limit_minutes: 2400,
					logged_minutes: 2610,
				},
				{ agreementLabel: "Acme", native: false },
			),
		).toBe("Your agreement with Acme allows 40h a week. You logged 43h 30m.");
		expect(
			contractLimitCopy({
				label: "Acme",
				limitMinutes: 2400,
				loggedMinutes: 2610,
				approverName: "Ana Reyes",
			}),
		).toBe(
			"Your agreement with Acme allows 40h a week. You logged 43h 30m. The 3h 30m over needs Ana's approval.",
		);
	});

	it("words the policy limit as an indicator that never cuts hours", () => {
		const text = entryWarningCopy(
			{
				code: "POLICY_WEEKLY_LIMIT",
				limit_minutes: 2400,
				logged_minutes: 2610,
				label: "Prodigitality",
			},
			{ native: false },
		);
		expect(text).toBe(
			"Prodigitality has a 40h weekly limit. You've logged 43h 30m this week.",
		);
		expect(text).not.toMatch(/\b(cut|unpaid|won't be paid|approval)\b/i);
		expect(policyLimitCopy({ limitMinutes: 600, loggedMinutes: 30 })).toBe(
			"There's a 10h weekly limit here. You've logged 30m this week.",
		);
	});

	it("lists warnings once each", () => {
		expect(
			entryWarningsCopy(
				[
					{ code: "OVERLAP", entry_ids: ["a"] },
					{ code: "OVERLAP", entry_ids: ["b"] },
					{
						code: "POLICY_WEEKLY_LIMIT",
						limit_minutes: 2400,
						logged_minutes: 2460,
						label: "Acme",
					},
				],
				{ native: false },
			),
		).toEqual([
			"This overlaps another entry.",
			"Acme has a 40h weekly limit. You've logged 41h this week.",
		]);
		expect(entryWarningsCopy(null)).toEqual([]);
	});

	it("writes the review screen's weekly-limit lines", () => {
		expect(
			weeklyLimitLine({
				source: "policy",
				label: "Prodigitality",
				limitMinutes: 2400,
				loggedSeconds: 38 * 3600 + 15 * 60,
			}),
		).toBe("Weekly limit 40h (Prodigitality) · 38:15 logged · within limit");
		expect(
			weeklyLimitLine({
				source: "agreement",
				label: "Acme Corp",
				limitMinutes: 2400,
				loggedSeconds: 43 * 3600 + 30 * 60,
			}),
		).toBe(
			"Weekly limit 40h in the agreement with Acme Corp · 43:30 logged · 3:30 over",
		);
	});

	it("writes the over-the-limit panel", () => {
		expect(
			overLimitCopy({ overSeconds: 3.5 * 3600, payableSeconds: 40 * 3600 }),
		).toEqual({
			checkbox: "Approve the 3h 30m over the limit",
			hint: "Left unticked, 40:00 is approved for payment; the extra time stays on record.",
		});
	});
});

describe("plan copy (tier names only)", () => {
	const WEB: Record<string, string> = {
		time_tracking:
			"Timesheets and approvals are part of Pro. Upgrade Acme to send time for approval.",
		time_billable_invoices:
			"Billing hours on invoices is part of Pro. You can still sign a retainer or fixed-fee contract.",
		time_team_rules: "Team approvers and team time rules are part of Business.",
		time_payouts: "Payouts are part of Business.",
		time_reports_export:
			"Workspace-wide time reports and export are part of Business.",
		time_audit_export: "Time audit export is part of Enterprise.",
		time_approval_chains: "Custom approval chains: Enterprise",
	};
	const NATIVE: Record<string, string | null> = {
		time_tracking:
			"Timesheets and approvals aren't on Acme's current plan. A workspace owner can change this on the web.",
		time_billable_invoices: null,
		time_team_rules: "Team time rules aren't on Acme's current plan.",
		time_payouts: null,
		time_reports_export:
			"Workspace-wide time reports and export are part of Business.",
		time_audit_export: null,
		time_approval_chains: "Custom approval chains: Enterprise",
	};

	it("covers the seven keys on web and native", () => {
		expect(TIME_PLAN_KEYS).toHaveLength(7);
		for (const key of TIME_PLAN_KEYS) {
			expect(
				timePlanCopy(key, { workspaceName: "Acme", native: false }),
				key,
			).toBe(WEB[key]);
			expect(
				timePlanCopy(key, { workspaceName: "Acme", native: true }),
				key,
			).toBe(NATIVE[key]);
		}
	});

	it("words the cut-off editor and missing workspace names", () => {
		const cutoffs =
			"Billing and pay cut-offs are part of Pro (billing) or Business (payouts).";
		expect(
			timePlanCopy("time_billable_invoices", {
				context: "cutoffs",
				native: false,
			}),
		).toBe(cutoffs);
		expect(
			timePlanCopy("time_payouts", { context: "cutoffs", native: false }),
		).toBe(cutoffs);
		expect(timePlanCopy("time_tracking", { native: false })).toBe(
			"Timesheets and approvals are part of Pro. Upgrade your workspace to send time for approval.",
		);
		expect(timePlanCopy("time_tracking", { native: true })).toBe(
			"Timesheets and approvals aren't on your workspace's current plan. A workspace owner can change this on the web.",
		);
		expect(timePlanDowngradeCopy({ workspaceName: "Acme" })).toBe(
			"Acme's plan no longer includes timesheets. Your existing time is safe, and open timesheets can still be decided.",
		);
		expect(timePlanDowngradeCopy()).toMatch(/^Your workspace's plan no longer/);
		expect(isTimePlanKey("time_payouts")).toBe(true);
		expect(isTimePlanKey("projects")).toBe(false);
	});

	it("never names a price, a per-user charge or a billing period", () => {
		for (const native of [false, true]) {
			for (const key of TIME_PLAN_KEYS) {
				for (const context of ["contract", "cutoffs"] as const) {
					const text = timePlanCopy(key, {
						native,
						context,
						workspaceName: "Acme",
					});
					if (text === null) continue;
					expect(text).not.toMatch(/\d|[$€£₱]|per user|\/month|pricing/i);
					expect(text).toMatch(/Pro|Business|Enterprise|current plan/);
				}
			}
		}
	});
});

describe("toasts", () => {
	it("writes the toast table", () => {
		expect(
			timeToast("submit", {
				approverScope: "team",
				goesTo: { scopeKind: "team", label: TEAM },
			}),
		).toBe(
			"Sent to Prodigitality Services Inc. Team's owners and admins for approval.",
		);
		expect(
			timeToast("submit", {
				approverScope: "hirer",
				deciders: [{ id: "a", display_name: "Ana Reyes" }],
			}),
		).toBe("Sent to Ana Reyes for approval.");
		expect(
			timeToast("submit", {
				approverScope: "self",
				totalSeconds: 38 * 3600 + 900,
			}),
		).toBe("Approved · 38:15");
		expect(timeToast("submit")).toBe("Sent to your approvers for approval.");
		expect(timeToast("approve", { totalSeconds: 38 * 3600 + 900 })).toBe(
			"Approved · 38:15 frozen",
		);
		expect(timeToast("return", { personName: "Maria Santos" })).toBe(
			"Returned to Maria",
		);
		expect(timeToast("withdraw")).toBe("Withdrawn. You can edit again.");
		expect(timeToast("reopen", { personName: "Maria Santos" })).toBe(
			"Reopened. Maria can edit again.",
		);
		expect(timeToast("reopen", { ownSheet: true })).toBe(
			"Reopened. You can edit again.",
		);
		expect(timeToast("approve_bulk", { count: 3 })).toBe(
			"Approved 3 timesheets",
		);
		expect(timeToast("approve_bulk", { count: 1 })).toBe(
			"Approved 1 timesheet",
		);
		expect(timeToast("request_reopen")).toBe(
			"Asked to reopen. The approvers have your note.",
		);
	});
});

describe("small builders", () => {
	it("writes the switch prompt with the task and its time", () => {
		expect(switchTimerPrompt("Fix login bug", 4364)).toEqual({
			text: "Stop Fix login bug (1:12) and start this?",
			task: "Fix login bug",
			elapsed: "1:12",
			confirmLabel: "Switch",
		});
		expect(switchTimerPrompt(null, null).text).toBe(
			"Stop your running timer (0:00) and start this?",
		);
	});

	it("writes the locked chip, flags and the Change For lines", () => {
		expect(lockedChipCopy("submitted", "Oct 6")).toBe(
			"Submitted Oct 6. Withdraw to change.",
		);
		expect(lockedChipCopy("approved", null)).toBe(
			"Approved. Ask to reopen to change.",
		);
		expect(flaggedReasonCopy("auto_stopped_24h")).toBe(
			"Stopped automatically after 24 hours. Check the end time.",
		);
		expect(
			flaggedReasonCopy("stopped_by_assignment_end", {
				agreementLabel: "Acme",
			}),
		).toBe("Stopped when your agreement with Acme ended.");
		expect(flaggedReasonCopy(null)).toBeNull();
		expect(beforeAgreementCopy("2026-09-15", DATES)).toBe(
			"Logged before this agreement started on Sep 15.",
		);
		expect(changeForRatesNote({ native: false })).toBe(
			"Rates are re-estimated for the new choice.",
		);
		expect(changeForRatesNote({ native: true })).toBeNull();
		expect(APPROVAL_DISABLED_COPY).toEqual({
			flags: "Has flags. Open it to review.",
			overLimit: "Over the limit. Open it to decide the overtime.",
		});
		expect(TIME_ACCOUNT_DELETION_COPY.openTimesheets).toBe(
			"Your open timesheets will be sent for approval when you delete your account.",
		);
	});
});

describe("nativeSafe", () => {
	it("passes web text through untouched", () => {
		expect(nativeSafe("Set by your contract rate", { native: false })).toBe(
			"Set by your contract rate",
		);
	});

	it("says agreement instead of contract on native", () => {
		expect(
			nativeSafe("Set by your contract with Acme.", { native: true }),
		).toBe("Set by your agreement with Acme.");
		expect(nativeSafe("Contracts end today.", { native: true })).toBe(
			"Agreements end today.",
		);
	});

	it("falls back when a rate, payout or invoice is named", () => {
		for (const text of [
			"Your rate changed.",
			"Rates are re-estimated.",
			"This is in a payout.",
			"Payouts are off.",
			"On invoice INV-0042.",
			"Already invoiced.",
		]) {
			expect(nativeSafe(text, { native: true }), text).toBe(
				NATIVE_FALLBACK_COPY,
			);
		}
		expect(
			nativeSafe("Your rate changed.", { native: true, fallback: "x" }),
		).toBe("x");
	});

	it("leaves words that only contain the letters alone", () => {
		for (const text of [
			"Keep these separate.",
			"An accurate total.",
			"Pay cut-offs.",
		]) {
			expect(nativeSafe(text, { native: true })).toBe(text);
		}
	});

	it("strips amounts when asked", () => {
		expect(nativeSafe("Estimated PHP 6,885.00.", { native: true })).toBe(
			"Estimated PHP 6,885.00.",
		);
		expect(
			nativeSafe("Estimated PHP 6,885.00.", {
				native: true,
				stripAmounts: true,
			}),
		).toBe(NATIVE_FALLBACK_COPY);
		expect(hasAmount("USD 120.00")).toBe(true);
		expect(hasAmount("$120")).toBe(true);
		expect(hasAmount("INV-0042 for Sep 22–28")).toBe(false);
		expect(hasAmount("38:15 logged")).toBe(false);
	});

	it("drops /engagements links on native only", () => {
		expect(nativeSafeHref("/engagements/e1", { native: true })).toBeNull();
		expect(
			nativeSafeHref("/w/acme/engagements?x=1", { native: true }),
		).toBeNull();
		expect(nativeSafeHref("/engagements/e1", { native: false })).toBe(
			"/engagements/e1",
		);
		expect(nativeSafeHref("/time?entry=e1", { native: true })).toBe(
			"/time?entry=e1",
		);
		expect(nativeSafeHref(null)).toBeNull();
	});

	it("reads the platform by default", () => {
		platform.native = true;
		expect(nativeSafe("Your contract.")).toBe("Your agreement.");
		platform.native = false;
		expect(nativeSafe("Your contract.")).toBe("Your contract.");
	});
});

/**
 * The §4 native sweep: with the platform mocked native, nothing this module
 * says names a contract, rate, payout or invoice, shows an amount, or links
 * to /engagements — even when the server's own message does.
 */
describe("native sweep", () => {
	const NASTY =
		"The contract rate PHP 6,885.00 was invoiced via payout. See /engagements/e1.";
	const EXTRAS: Record<string, Record<string, unknown>[]> = {
		TIMESHEET_LOCKED: [
			{ reason: "entry", lock: "paid", entry_id: "e1" },
			{ reason: "period", timesheet_id: "s1", sheet_status: "submitted" },
			{ reason: "period", timesheet_id: "s1", sheet_status: "approved" },
		],
		TIMESHEET_HAS_SETTLED_ENTRIES: [
			{ reason: "paid", payout_id: "p1" },
			{ reason: "paid", paid_outside: true },
			{
				reason: "billed",
				invoice_id: "i1",
				invoice_number: "INV-0042",
				invoice_status: "draft",
			},
			{
				reason: "billed",
				invoice_number: "INV-0042",
				invoice_status: "issued",
			},
			{ reason: "legacy" },
			{},
		],
		HOUR_CAP_EXCEEDED: [{ limit_window: "weekly", limit_hours: 40 }],
		RETROACTIVE_WINDOW: [{ earliest_date: "2026-09-29" }],
		LEGACY_CONTRACT_AMBIGUOUS: [{ reason: "teams" }, { reason: "contracts" }],
		STALE_REVISION: [{ entry_id: "e1" }, { timesheet_id: "s1" }],
		TIMESHEET_TRANSITION_INVALID: TRANSITION_REASONS.map((reason) => ({
			reason,
		})),
		TIME_POLICY_INVALID: [{ fields: ["timezone"] }],
		INVOICE_TIME_ENTRY_NOT_BILLABLE: [{ reason: "reservation_mismatch" }],
	};
	const CODES = [
		...TIME_ERROR_CODES,
		"TIME_INTERNAL",
		"NETWORK_ERROR",
		"CLIENT_ERROR",
		"missing_permission",
		"plan_limit",
		"TEAM_HAS_OPEN_TIME",
		"WORKSPACE_HAS_OPEN_TIME",
		"HTTP_400",
		"HTTP_404",
		"HTTP_500",
		"SOMETHING_NEW",
	];
	const CONTEXTS: TimeErrorCopyContext[] = [
		{ label: "Acme Corp", labelKind: "engagement", personName: "Maria Santos" },
		{ label: "Rico for Pixel", labelKind: "assignment" },
		{ label: TEAM, labelKind: "team", retroactiveDays: 7 },
		{},
	];

	function expectNativeClean(text: string, where: string) {
		expect(hasNativeForbiddenWords(text), `${where}: ${text}`).toBe(false);
		expect(hasAmount(text), `${where}: ${text}`).toBe(false);
		expect(text, where).not.toMatch(/\/engagements/);
		expect(text, where).not.toMatch(/\bProdigy\b/);
	}

	it("keeps every error message native-clean", () => {
		platform.native = true;
		for (const code of CODES) {
			for (const extras of EXTRAS[code] ?? [{}]) {
				for (const ctx of CONTEXTS) {
					for (const message of [NASTY, "Short."]) {
						const copy = timeErrorCopy(
							apiError(code, extras, {
								status: code.startsWith("HTTP_") ? Number(code.slice(5)) : 409,
								message,
							}),
							{ ...ctx, ...DATES },
						);
						expectNativeClean(
							copy.message,
							`${code} ${JSON.stringify(extras)}`,
						);
					}
				}
			}
		}
	});

	it("keeps every other builder native-clean", () => {
		platform.native = true;
		const texts: string[] = [
			...TIME_PLAN_KEYS.flatMap((key) =>
				(["contract", "cutoffs"] as const).map(
					(context) =>
						timePlanCopy(key, { workspaceName: "Acme", context }) ?? "",
				),
			),
			timePlanDowngradeCopy({ workspaceName: "Acme" }),
			...(
				[
					"submit",
					"approve",
					"return",
					"withdraw",
					"reopen",
					"request_reopen",
					"approve_bulk",
				] as TimeToastAction[]
			).map((action) =>
				timeToast(action, {
					approverScope: "hirer",
					deciders: [{ id: "a", display_name: "Ana Reyes" }],
					totalSeconds: 3600,
					personName: "Maria Santos",
					count: 2,
				}),
			),
			...EXTRAS.TIMESHEET_HAS_SETTLED_ENTRIES.map(
				(extras) => settledEntriesCopy(extras).message,
			),
			...TRANSITION_REASONS.map((reason) => transitionReasonCopy(reason)),
			entryWarningCopy(
				{
					code: "CONTRACT_WEEKLY_LIMIT",
					limit_minutes: 2400,
					logged_minutes: 2610,
				},
				{ agreementLabel: "Acme" },
			),
			entryWarningCopy({
				code: "POLICY_WEEKLY_LIMIT",
				limit_minutes: 2400,
				logged_minutes: 2610,
				label: "Acme",
			}),
			weeklyLimitLine({
				source: "agreement",
				label: "Acme Corp",
				limitMinutes: 2400,
				loggedSeconds: 156600,
			}),
			overLimitCopy({ overSeconds: 12600, payableSeconds: 144000 }).hint,
			flaggedReasonCopy("stopped_by_assignment_end", {
				agreementLabel: "Acme",
			}) ?? "",
			lockedChipCopy("submitted", "Oct 6"),
			switchTimerPrompt("Fix login bug", 4364).text,
			bulkApproveFailedCopy("Leo Cruz").message,
			...Object.values(APPROVAL_DISABLED_COPY),
			...Object.values(TIME_ACCOUNT_DELETION_COPY),
		];
		for (const text of texts) expectNativeClean(text, "builder");
		expect(changeForRatesNote()).toBeNull();
	});

	it("never uses the retired words on web either", () => {
		const banned =
			/\btime logs?\b|\blogging for\b|\bpersonal context\b|\breject(?:ed)?\b|\bProdigy\b/i;
		for (const code of CODES) {
			for (const extras of EXTRAS[code] ?? [{}]) {
				const text = timeErrorMessage(apiError(code, extras), {
					native: false,
					label: "Acme",
				});
				expect(text, code).not.toMatch(banned);
			}
		}
	});
});
