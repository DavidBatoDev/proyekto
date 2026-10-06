// web/src/components/time/sheets/useTimesheetActions.ts
//
// Every timesheet action a person can take from the web (ux.md › Submit,
// Return, Reopen; Approvals): submit, withdraw, approve, return, reopen, ask
// to reopen, and bulk approve. One hook so every surface (cards, the Submit
// sheet, the decision dialogs, Waiting for you, the review screen) behaves
// the same way:
//
// - each call sends the sheet's `revision` as `expected_revision` (D42);
// - success shows the ux.md toast (`timeToast`) and invalidates the `sheet`
//   event (timesheets, the approval queue and its count, overview, entries,
//   reports and payouts);
// - a refusal never throws: it comes back as a `SheetActionFailure` with the
//   sentence to show (`lib/timeErrors.ts`), whose sheet changed (a stale
//   revision names the person, A10 for bulk approve) and the A12 settled copy;
// - a refusal that means "the sheet moved under you" (409s) also invalidates
//   the `sheet` event, so "Review the latest" finds fresh data.
//
// Errors are inline by default (dialogs keep them next to the button); pass
// `toastOnError` for surfaces without a place to show them.

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { useToast } from "@/hooks/useToast";
import {
	bulkApproveFailedCopy,
	nativeSafe,
	type SettledEntriesCopy,
	settledEntriesCopy,
	staleRevisionCopy,
	type TimeErrorCopy,
	timeErrorCopy,
	timeToast,
	transitionReasonCopy,
} from "@/lib/timeErrors";
import { invalidateTime } from "@/queries/time";
import {
	type TimeApiError,
	timeService,
	toTimeApiError,
} from "@/services/time.service";
import type {
	ApproverScope,
	PeriodKind,
	SheetRoutingPreview,
	SheetScopeKind,
	TimeDecider,
	TimesheetActionInput,
	TimesheetRow,
	TimesheetStatus,
	TimesheetUserAction,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

// ── Types ───────────────────────────────────────────────────────────────────

/** A person's action on one sheet, or bulk approve over several. */
export type SheetAction = TimesheetUserAction | "approve_bulk";

/**
 * What an action needs from a sheet. Any `TimesheetRow`, `TimesheetSummary`
 * or `ApprovalRow` fits; only `id` and `revision` are required, the rest feed
 * the copy (names, scope, totals).
 */
export interface SheetActionTarget {
	id: string;
	/** Sent back as `expected_revision`. */
	revision: number;
	status?: TimesheetStatus;
	member_user_id?: string | null;
	member_display_name_snapshot?: string | null;
	/** `ApprovalRow.member` (the decider's queue). */
	member?: { display_name: string | null } | null;
	scope_kind?: SheetScopeKind;
	scope_label_snapshot?: string | null;
	approver_scope?: ApproverScope | null;
	/** A1: where a submit goes now. */
	routing_preview?: SheetRoutingPreview;
	/** A2: who a submitted sheet waits on. */
	deciders?: TimeDecider[];
	total_seconds?: number | null;
	payable_seconds?: number | null;
	logged_seconds?: number;
	period_kind?: PeriodKind;
	period_end?: string;
	timezone?: string;
}

export interface SheetActionInput {
	/** Trimmed; an empty note is not sent. Required for `return`. */
	note?: string | null;
	/** Approve only: the over-the-limit box (L12). */
	approveOvertime?: boolean;
}

/**
 * - `stale`: the sheet changed under the viewer (STALE_REVISION, or a
 *   transition refused because the state or the freeze moved).
 * - `settled`: reopen refused because time on it is paid or billed (A12).
 * - `note`: a required note is missing (checked before any request).
 * - `other`: anything else (copy from `timeErrorCopy`).
 */
export type SheetFailureKind = "stale" | "settled" | "note" | "other";

export interface SheetActionFailure {
	action: SheetAction;
	/** The sheet the failure is about (bulk: the one that changed, when known). */
	timesheetId: string | null;
	/** Null for a refusal made before any request (`note`). */
	error: TimeApiError | null;
	/** The full copy for the error (null for `note`). */
	copy: TimeErrorCopy | null;
	/** What people read. Never a raw server message or code. */
	message: string;
	kind: SheetFailureKind;
	/** Whose sheet it is ("Maria Santos"); null when it is the viewer's own. */
	personName: string | null;
	/** `settled`: the A12 copy and its web-only link. */
	settled: SettledEntriesCopy | null;
}

export type SheetActionOutcome =
	| { ok: true; action: SheetAction; rows: TimesheetRow[] }
	| { ok: false; action: SheetAction; failure: SheetActionFailure };

export interface UseTimesheetActionsOptions {
	/** Show the ux.md success toast (default true). */
	toastOnSuccess?: boolean;
	/** Toast refusals too (default false: callers show them inline). */
	toastOnError?: boolean;
	/** The policy workspace's name, for "Sent to Acme's workspace owners and admins". */
	workspaceName?: string | null;
	onSuccess?: (outcome: Extract<SheetActionOutcome, { ok: true }>) => void;
	onFailure?: (failure: SheetActionFailure) => void;
}

export interface PendingSheetAction {
	action: SheetAction;
	ids: string[];
}

export interface TimesheetActions {
	submit: (
		sheet: SheetActionTarget,
		input?: SheetActionInput,
	) => Promise<SheetActionOutcome>;
	withdraw: (sheet: SheetActionTarget) => Promise<SheetActionOutcome>;
	approve: (
		sheet: SheetActionTarget,
		input?: SheetActionInput,
	) => Promise<SheetActionOutcome>;
	/** The note is required (checked here before any request). */
	returnSheet: (
		sheet: SheetActionTarget,
		input: SheetActionInput,
	) => Promise<SheetActionOutcome>;
	/** Decider (note required by the server) or the member of an own auto/self sheet (optional). */
	reopen: (
		sheet: SheetActionTarget,
		input?: SheetActionInput,
	) => Promise<SheetActionOutcome>;
	requestReopen: (
		sheet: SheetActionTarget,
		input?: SheetActionInput,
	) => Promise<SheetActionOutcome>;
	/** All or nothing (L24). Ids and revisions are sent in the given order. */
	approveBulk: (
		sheets: readonly SheetActionTarget[],
		input?: SheetActionInput,
	) => Promise<SheetActionOutcome>;
	/** Any single-sheet action by name. */
	run: (
		action: TimesheetUserAction,
		sheet: SheetActionTarget,
		input?: SheetActionInput,
	) => Promise<SheetActionOutcome>;
	/** The action in flight, if any. */
	pending: PendingSheetAction | null;
	/** True while `action` (any, when omitted) runs, on `timesheetId` when given. */
	isPending: (action?: SheetAction, timesheetId?: string) => boolean;
	/** The last refusal (cleared by the next call or `clearFailure`). */
	failure: SheetActionFailure | null;
	clearFailure: () => void;
}

// ── Pure helpers ────────────────────────────────────────────────────────────

/** The person a sheet belongs to, as the decider's queue or the sheet names them. */
export function sheetPersonName(
	sheet: Pick<
		SheetActionTarget,
		"member" | "member_display_name_snapshot"
	> | null,
): string | null {
	const name =
		sheet?.member?.display_name?.trim() ||
		sheet?.member_display_name_snapshot?.trim() ||
		"";
	return name || null;
}

function cleanNote(note: string | null | undefined): string | undefined {
	const text = note?.trim();
	return text ? text : undefined;
}

const STALE_TRANSITION_REASONS = new Set([
	"state",
	"freeze_required",
	"freeze_invalid",
]);

/** The sheet moved under the viewer: a revision or state the request did not expect. */
export function isStaleSheetError(error: TimeApiError): boolean {
	if (error.code === "STALE_REVISION") return true;
	if (error.code === "TIMESHEET_TRANSITION_INVALID") {
		const reason = (error.extras as Record<string, unknown>).reason;
		return typeof reason === "string" && STALE_TRANSITION_REASONS.has(reason);
	}
	return false;
}

function extrasTimesheetId(error: TimeApiError): string | null {
	const id = (error.extras as Record<string, unknown>).timesheet_id;
	return typeof id === "string" && id ? id : null;
}

/**
 * The failure for `error` on `action`. `targets` are the sheets the call was
 * about (bulk: every selected sheet, so A10's `timesheet_id` can name the
 * person); `viewerId` keeps a person's own sheet from naming them.
 */
export function describeSheetFailure(
	action: SheetAction,
	thrown: unknown,
	targets: readonly SheetActionTarget[],
	viewerId: string | null,
): SheetActionFailure {
	const error = toTimeApiError(thrown);
	const namedId = extrasTimesheetId(error);
	const target =
		(namedId ? targets.find((t) => t.id === namedId) : undefined) ??
		(action === "approve_bulk" ? undefined : targets[0]);
	const own =
		target?.member_user_id != null &&
		viewerId != null &&
		target.member_user_id === viewerId;
	const personName = target && !own ? sheetPersonName(target) : null;
	const copy = timeErrorCopy(error, {
		subject: "timesheet",
		operation: "write",
		personName,
		label: target?.scope_label_snapshot ?? null,
		labelKind: target?.scope_kind ?? null,
		periodKind: target?.period_kind ?? null,
		periodEnd: target?.period_end ?? null,
	});
	const timesheetId = target?.id ?? namedId ?? null;

	if (isStaleSheetError(error)) {
		const message =
			action === "approve_bulk"
				? bulkApproveFailedCopy(personName).message
				: staleRevisionCopy({ subject: "timesheet", personName }).message;
		return {
			action,
			timesheetId,
			error,
			copy,
			message,
			kind: "stale",
			personName,
			settled: null,
		};
	}

	if (error.code === "TIMESHEET_HAS_SETTLED_ENTRIES") {
		const settled = settledEntriesCopy(error.extras);
		return {
			action,
			timesheetId,
			error,
			copy,
			message: settled.message,
			kind: "settled",
			personName,
			settled,
		};
	}

	return {
		action,
		timesheetId,
		error,
		copy,
		message:
			action === "approve_bulk" && !copy.message.startsWith("Nothing")
				? `Nothing was approved. ${copy.message}`
				: copy.message,
		kind: "other",
		personName,
		settled: null,
	};
}

/** The ux.md toast for a finished action. */
export function sheetSuccessToast(
	action: SheetAction,
	rows: readonly TimesheetRow[],
	targets: readonly SheetActionTarget[],
	options: { viewerId?: string | null; workspaceName?: string | null } = {},
): string {
	const target = targets[0];
	const row = rows.find((r) => r.id === target?.id) ?? rows[0];
	const personName = sheetPersonName(target ?? null);
	let text: string;
	switch (action) {
		case "submit": {
			const scope =
				row?.approver_scope ??
				target?.routing_preview?.approver_scope ??
				target?.approver_scope ??
				null;
			const selfSent =
				row?.status === "approved" || scope === "auto" || scope === "self";
			text = timeToast("submit", {
				approverScope: selfSent ? (scope === "auto" ? "auto" : "self") : scope,
				deciders: target?.routing_preview?.deciders ?? target?.deciders ?? null,
				goesTo: {
					scopeKind: target?.scope_kind ?? row?.scope_kind ?? null,
					label:
						target?.scope_label_snapshot ?? row?.scope_label_snapshot ?? null,
					workspaceName: options.workspaceName ?? null,
				},
				totalSeconds:
					row?.total_seconds ??
					target?.total_seconds ??
					target?.logged_seconds ??
					null,
			});
			break;
		}
		case "approve":
			text = timeToast("approve", {
				totalSeconds:
					row?.payable_seconds ??
					row?.total_seconds ??
					target?.total_seconds ??
					target?.logged_seconds ??
					null,
			});
			break;
		case "return":
			text = timeToast("return", { personName });
			break;
		case "withdraw":
			text = timeToast("withdraw");
			break;
		case "reopen": {
			const own =
				options.viewerId != null &&
				(row?.member_user_id ?? target?.member_user_id) === options.viewerId;
			text = timeToast("reopen", { personName, ownSheet: own });
			break;
		}
		case "request_reopen":
			text = timeToast("request_reopen");
			break;
		case "approve_bulk":
			text = timeToast("approve_bulk", {
				count: rows.length || targets.length,
			});
			break;
		default:
			text = "Done.";
	}
	return nativeSafe(text);
}

function noteFailure(
	action: SheetAction,
	sheet: SheetActionTarget,
	viewerId: string | null,
): SheetActionFailure {
	const own = sheet.member_user_id != null && sheet.member_user_id === viewerId;
	const personName = own ? null : sheetPersonName(sheet);
	return {
		action,
		timesheetId: sheet.id,
		error: null,
		copy: null,
		message: transitionReasonCopy("note_required", { personName }),
		kind: "note",
		personName,
		settled: null,
	};
}

/** Which failures leave the cached sheet out of date (refetch so "Review the latest" works). */
function staleCacheAfter(error: TimeApiError | null): boolean {
	if (!error) return false;
	return error.status === 409 || error.status === 404 || error.status === 410;
}

/** One service call per action (the named functions, so a spy on any of them sees it). */
const SINGLE_ACTION: Record<
	TimesheetUserAction,
	(id: string, input: TimesheetActionInput) => Promise<TimesheetRow>
> = {
	submit: (id, input) => timeService.submitTimesheet(id, input),
	withdraw: (id, input) => timeService.withdrawTimesheet(id, input),
	approve: (id, input) => timeService.approveTimesheet(id, input),
	return: (id, input) =>
		timeService.returnTimesheet(id, { ...input, note: input.note ?? "" }),
	reopen: (id, input) => timeService.reopenTimesheet(id, input),
	request_reopen: (id, input) => timeService.requestReopenTimesheet(id, input),
};

// ── Hook ────────────────────────────────────────────────────────────────────

export function useTimesheetActions(
	options: UseTimesheetActionsOptions = {},
): TimesheetActions {
	const queryClient = useQueryClient();
	const toast = useToast();
	const viewerId = useAuthStore((state) => state.user?.id ?? null);
	const [pending, setPending] = useState<PendingSheetAction | null>(null);
	const [failure, setFailure] = useState<SheetActionFailure | null>(null);
	const inFlight = useRef(new Map<string, Promise<SheetActionOutcome>>());

	// Read the latest options inside callbacks without re-creating them.
	const optionsRef = useRef(options);
	optionsRef.current = options;

	const execute = useCallback(
		(
			action: SheetAction,
			targets: readonly SheetActionTarget[],
			request: () => Promise<TimesheetRow[]>,
		): Promise<SheetActionOutcome> => {
			const ids = targets.map((t) => t.id);
			const key = `${action}:${ids.join(",")}`;
			const running = inFlight.current.get(key);
			if (running) return running;

			const work = (async (): Promise<SheetActionOutcome> => {
				setPending({ action, ids });
				setFailure(null);
				const opts = optionsRef.current;
				try {
					const rows = await request();
					const outcome = { ok: true as const, action, rows };
					void invalidateTime(queryClient, "sheet");
					if (opts.toastOnSuccess !== false) {
						toast.success(
							sheetSuccessToast(action, rows, targets, {
								viewerId,
								workspaceName: opts.workspaceName,
							}),
						);
					}
					opts.onSuccess?.(outcome);
					return outcome;
				} catch (thrown) {
					const described = describeSheetFailure(
						action,
						thrown,
						targets,
						viewerId,
					);
					if (staleCacheAfter(described.error)) {
						void invalidateTime(queryClient, "sheet");
					}
					setFailure(described);
					if (opts.toastOnError) toast.error(described.message);
					opts.onFailure?.(described);
					return { ok: false as const, action, failure: described };
				} finally {
					inFlight.current.delete(key);
					setPending((current) =>
						current && current.action === action && current.ids === ids
							? null
							: current,
					);
				}
			})();
			inFlight.current.set(key, work);
			return work;
		},
		[queryClient, toast, viewerId],
	);

	const run = useCallback(
		(
			action: TimesheetUserAction,
			sheet: SheetActionTarget,
			input: SheetActionInput = {},
		): Promise<SheetActionOutcome> => {
			const note = cleanNote(input.note);
			if (action === "return" && !note) {
				const described = noteFailure(action, sheet, viewerId);
				setFailure(described);
				optionsRef.current.onFailure?.(described);
				return Promise.resolve({ ok: false, action, failure: described });
			}
			const body: TimesheetActionInput = {
				expected_revision: sheet.revision,
				...(note ? { note } : {}),
				...(action === "approve" && input.approveOvertime
					? { approve_overtime: true }
					: {}),
			};
			return execute(action, [sheet], async () => {
				const row = await SINGLE_ACTION[action](sheet.id, body);
				return row ? [row] : [];
			});
		},
		[execute, viewerId],
	);

	const approveBulk = useCallback(
		(
			sheets: readonly SheetActionTarget[],
			input: SheetActionInput = {},
		): Promise<SheetActionOutcome> => {
			if (sheets.length === 0) {
				const described: SheetActionFailure = {
					action: "approve_bulk",
					timesheetId: null,
					error: null,
					copy: null,
					message: "Select at least one timesheet to approve.",
					kind: "other",
					personName: null,
					settled: null,
				};
				setFailure(described);
				return Promise.resolve({
					ok: false,
					action: "approve_bulk",
					failure: described,
				});
			}
			const note = cleanNote(input.note);
			return execute("approve_bulk", sheets, async () => {
				const rows = await timeService.approveTimesheetsBulk({
					ids: sheets.map((s) => s.id),
					expected_revisions: sheets.map((s) => s.revision),
					...(note ? { note } : {}),
					...(input.approveOvertime ? { approve_overtime: true } : {}),
				});
				return Array.isArray(rows) ? rows : [];
			});
		},
		[execute],
	);

	const isPending = useCallback(
		(action?: SheetAction, timesheetId?: string) => {
			if (!pending) return false;
			if (action && pending.action !== action) return false;
			if (timesheetId && !pending.ids.includes(timesheetId)) return false;
			return true;
		},
		[pending],
	);

	const clearFailure = useCallback(() => setFailure(null), []);

	return useMemo<TimesheetActions>(
		() => ({
			submit: (sheet, input) => run("submit", sheet, input),
			withdraw: (sheet) => run("withdraw", sheet),
			approve: (sheet, input) => run("approve", sheet, input),
			returnSheet: (sheet, input) => run("return", sheet, input),
			reopen: (sheet, input) => run("reopen", sheet, input),
			requestReopen: (sheet, input) => run("request_reopen", sheet, input),
			approveBulk,
			run,
			pending,
			isPending,
			failure,
			clearFailure,
		}),
		[run, approveBulk, pending, isPending, failure, clearFailure],
	);
}
