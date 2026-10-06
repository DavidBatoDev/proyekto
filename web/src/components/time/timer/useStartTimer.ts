// web/src/components/time/timer/useStartTimer.ts
//
// The start flow (ux.md › Timer, › For Chip). One call, `start(request)`,
// walks every step the server can ask for:
//
//   For options     → 0: blocked, with the Why? copy; 1 (or several the
//                     resolver collapsed): no question, and the start sends
//                     no `logging_for`, so the server resolves it fresh (a
//                     stale cache never picks among options that appeared
//                     since); 2+: the picker. A remembered default is
//                     preselected and named on the button, never applied
//                     silently (L38).
//   running timer?  → once the For choice is known, the Switch prompt ("Stop
//                     Fix login bug (1:12) and start this?"). There are never
//                     two timers, and a running timer is never stopped before
//                     the person agreed to a start that can happen.
//   the start       → 409 TIMER_ALREADY_RUNNING (another device) reopens the
//                     Switch prompt; 409 LOGGING_FOR_REQUIRED / 422
//                     LOGGING_FOR_INVALID reopen the picker with the server's
//                     options; 409 TIMESHEET_LOCKED {period} offers an inline
//                     Withdraw, then retries the same start.
//
// The flow is a plain controller (`createStartTimerController`) so every step
// shares one closure and one flow token: a cancelled or superseded flow never
// reopens a prompt, while a start the server accepted still updates the
// running cache. `useStartTimer` wraps it for React; `StartTimerPrompts`
// (SwitchTimerDialog.tsx) renders its state.

import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/useToast";
import { entryWarningsCopy } from "@/lib/timeErrors";
import { invalidateTime, timeKeys, timeQueries } from "@/queries/time";
import { isTimeApiError, timeService } from "@/services/time.service";
import type {
	EntryWithWarnings,
	LoggingForRequest,
	LoggingForResult,
	LoggingOption,
	PeriodKind,
	PresetWorkItem,
	TimeEntryView,
	TimesheetDetail,
	TimesheetStatus,
	WorkType,
} from "@/services/time.types";
import {
	CANT_LOG_TITLE,
	hourCapText,
	LOGGING_FOR_INVALID_TEXT,
	periodLockedText,
	timerErrorText,
	WITHDRAWN_TOAST,
	whyNoOptionsText,
} from "../for/forCopy";
import {
	defaultRemember,
	forMode,
	isSameFor,
	preselectedOption,
	resultFromErrorExtras,
	toForRequest,
} from "../for/forOptions";
import { setRunningEntry, useTimerUserId } from "./useActiveTimer";

export interface StartTimerRequest {
	projectId: string;
	/** XOR `workItem`. */
	taskId?: string | null;
	workItem?: PresetWorkItem;
	workType?: WorkType;
	note?: string | null;
	/**
	 * A For choice the caller already showed the person (a chip beside the
	 * button). Sent as is; the server still checks it.
	 */
	loggingFor?: LoggingForRequest | null;
	/** The label of `loggingFor`, for copy. */
	loggingForLabel?: string | null;
	/** With `loggingFor`: remember it for the project. */
	remember?: boolean;
}

export type StartTimerStep =
	| "idle"
	| "resolving"
	| "switch"
	| "pick"
	| "starting"
	| "locked"
	| "blocked";

export interface LockedPeriod {
	timesheetId: string | null;
	sheetStatus: TimesheetStatus | null;
	label: string | null;
	periodKind: PeriodKind | null;
	/** Withdraw is offered only for the person's own submitted sheet. */
	canWithdraw: boolean;
	withdrawing: boolean;
	/** The sentence to show (ux.md › Timer › Locked period). */
	message: string;
}

export interface StartTimerState {
	step: StartTimerStep;
	request: StartTimerRequest | null;
	/** `switch`: the timer that would stop. */
	running: TimeEntryView | null;
	/** `pick`: the options to choose from. */
	result: LoggingForResult | null;
	/** The For choice in play (picked, or the only option). */
	choice: LoggingForRequest | null;
	/** The chosen option's label, for copy ("Start for Acme Corp"). */
	choiceLabel: string | null;
	/** "Use for new time on this project". */
	remember: boolean;
	/**
	 * The choice is the project's only option: it names the copy, but the
	 * start sends no `logging_for` (nor `remember`), so the server picks from
	 * its own fresh options and asks (409) if there are several now.
	 */
	autoChoice: boolean;
	/** An inline message in the open prompt. */
	error: string | null;
	locked: LockedPeriod | null;
	/** `blocked`: why the project takes no time from this person. */
	blocked: { title: string; why: string | null } | null;
	/**
	 * While `resolving` or `starting`: the prompt the step was entered from,
	 * so it stays on screen (busy) instead of flashing closed.
	 */
	busyIn: StartPrompt | null;
}

/** The prompts a flow can show. */
export type StartPrompt = "switch" | "pick" | "locked";

export type StartOutcome =
	| "started"
	| "prompted"
	| "already_running"
	| "blocked"
	| "failed"
	| "ignored";

export const IDLE_START_STATE: StartTimerState = Object.freeze({
	step: "idle",
	request: null,
	running: null,
	result: null,
	choice: null,
	choiceLabel: null,
	remember: false,
	autoChoice: false,
	error: null,
	locked: null,
	blocked: null,
	busyIn: null,
}) as StartTimerState;

/** The prompt on screen: the open one, or the one a busy step came from. */
export function promptOf(state: StartTimerState): StartPrompt | null {
	if (
		state.step === "switch" ||
		state.step === "pick" ||
		state.step === "locked"
	) {
		return state.step;
	}
	if (state.step === "resolving" || state.step === "starting") {
		return state.busyIn;
	}
	return null;
}

const IDLE = IDLE_START_STATE;

/** The running timer is already this task (or this preset): nothing to start. */
export function isSameTimer(
	running: Pick<TimeEntryView, "project_id" | "task_id" | "work_item"> | null,
	request: Pick<StartTimerRequest, "projectId" | "taskId" | "workItem">,
): boolean {
	if (!running || running.project_id !== request.projectId) return false;
	if (request.taskId) return running.task_id === request.taskId;
	if (request.workItem) {
		return !running.task_id && running.work_item === request.workItem;
	}
	return false;
}

/** Steps during which a second click is ignored and the prompt cannot close. */
export function isBusyStep(state: StartTimerState): boolean {
	return (
		state.step === "resolving" ||
		state.step === "starting" ||
		Boolean(state.locked?.withdrawing)
	);
}

export interface StartTimerDeps {
	queryClient: QueryClient;
	userId: string | null;
	toast: {
		success: (message: string) => void;
		error: (message: string) => void;
		warning: (message: string) => void;
	};
	onStarted?: (entry: EntryWithWarnings) => void;
}

/** The flow as plain functions; the hook below binds it to React state. */
export function createStartTimerController(
	getDeps: () => StartTimerDeps,
	onChange: (state: StartTimerState) => void,
) {
	let state: StartTimerState = IDLE;
	let token = 0;

	const set = (next: StartTimerState) => {
		state = next;
		onChange(next);
	};
	const isLive = (flow: number) => flow === token;
	const setIfLive = (flow: number, next: StartTimerState) => {
		if (isLive(flow)) set(next);
	};

	const runningKey = () => timeKeys.running(getDeps().userId);
	const readRunning = (): TimeEntryView | null =>
		getDeps().queryClient.getQueryData<TimeEntryView | null>(runningKey()) ??
		null;

	const fetchRunning = async (): Promise<TimeEntryView | null> => {
		const { queryClient, userId } = getDeps();
		try {
			return await queryClient.fetchQuery({
				...timeQueries.running(userId),
				staleTime: 0,
			});
		} catch {
			return readRunning();
		}
	};

	const fetchLoggingFor = (projectId: string, fresh: boolean) =>
		getDeps().queryClient.fetchQuery(
			fresh
				? { ...timeQueries.loggingFor(projectId), staleTime: 0 }
				: timeQueries.loggingFor(projectId),
		);

	const blockedState = (request: StartTimerRequest): StartTimerState => ({
		...IDLE,
		step: "blocked",
		request,
		blocked: { title: CANT_LOG_TITLE, why: whyNoOptionsText("viewer") },
	});

	/** The picker, preselecting what the server (or the person) chose before. */
	const pickState = (
		request: StartTimerRequest,
		result: LoggingForResult,
		error: string | null,
	): StartTimerState => {
		const pre = preselectedOption(result);
		return {
			...IDLE,
			step: "pick",
			request,
			result,
			choice: pre ? toForRequest(pre) : null,
			choiceLabel: pre?.label ?? null,
			remember: defaultRemember(result, pre),
			error,
		};
	};

	// ── The start call ────────────────────────────────────────────────────────

	/** A For choice in hand, ready to start with. */
	interface Choice {
		choice: LoggingForRequest;
		choiceLabel: string | null;
		remember: boolean;
		/** See `StartTimerState.autoChoice`: true means it is not sent. */
		autoChoice: boolean;
	}

	interface Attempt extends Choice {
		flow: number;
		request: StartTimerRequest;
		/** Retries already spent on a vanished running timer. */
		retries: number;
	}

	/** The choice fields of a state (the switch and locked steps carry them). */
	const choiceOf = (s: StartTimerState): Choice | null =>
		s.choice
			? {
					choice: s.choice,
					choiceLabel: s.choiceLabel,
					remember: s.remember,
					autoChoice: s.autoChoice,
				}
			: null;

	const startWith = async (attempt: Attempt): Promise<StartOutcome> => {
		const { request, choice, choiceLabel, remember, autoChoice } = attempt;
		const from = promptOf(state);
		setIfLive(attempt.flow, {
			...(from ? state : IDLE),
			step: "starting",
			request,
			choice,
			choiceLabel,
			remember,
			autoChoice,
			error: null,
			busyIn: from,
		});
		// The only option is not sent: the server resolves it fresh (L38).
		const sendChoice = !autoChoice;
		let row: EntryWithWarnings;
		try {
			row = await timeService.startEntry({
				project_id: request.projectId,
				...(request.taskId ? { task_id: request.taskId } : {}),
				...(request.workItem && !request.taskId
					? { work_item: request.workItem }
					: {}),
				...(request.workType ? { work_type: request.workType } : {}),
				...(request.note ? { note: request.note } : {}),
				...(sendChoice ? { logging_for: choice } : {}),
				...(sendChoice && remember ? { remember: true } : {}),
			});
		} catch (error) {
			return onStartError(attempt, error);
		}
		const deps = getDeps();
		// The server started it: the cache follows even if the flow was cancelled.
		setRunningEntry(deps.queryClient, deps.userId, row);
		void invalidateTime(deps.queryClient, "entry");
		// An unsent choice is named by what the server actually picked.
		const startedLabel = autoChoice
			? row.context_label_snapshot?.trim() || choiceLabel
			: choiceLabel;
		// The same toasts Add time and edits show (lib/timeErrors).
		for (const text of entryWarningsCopy(row.warnings, {
			agreementLabel: row.context_kind === "assignment" ? startedLabel : null,
		})) {
			deps.toast.warning(text);
		}
		setIfLive(attempt.flow, IDLE);
		deps.onStarted?.(row);
		return "started";
	};

	const onStartError = async (
		attempt: Attempt,
		error: unknown,
	): Promise<StartOutcome> => {
		const { flow, request, choice, choiceLabel, remember, autoChoice } =
			attempt;
		// A superseded flow: say nothing, open nothing.
		if (!isLive(flow)) return "failed";
		const { queryClient, toast } = getDeps();

		// Another device started a timer since the cache last looked.
		if (isTimeApiError(error, "TIMER_ALREADY_RUNNING")) {
			const running = await fetchRunning();
			if (!isLive(flow)) return "failed";
			if (running && isSameTimer(running, request)) {
				set(IDLE);
				return "already_running";
			}
			if (running) {
				set({
					...IDLE,
					step: "switch",
					request,
					running,
					choice,
					choiceLabel,
					remember,
					autoChoice,
				});
				return "prompted";
			}
			// It stopped in between: try once more.
			if (attempt.retries < 1) {
				return startWith({ ...attempt, retries: attempt.retries + 1 });
			}
		}

		// Several options now (the cache said one), or the choice went stale.
		if (isTimeApiError(error, "LOGGING_FOR_REQUIRED", "LOGGING_FOR_INVALID")) {
			const invalid = error.code === "LOGGING_FOR_INVALID";
			const key = timeKeys.loggingFor(request.projectId);
			const previous = queryClient.getQueryData<LoggingForResult>(key);
			void queryClient.invalidateQueries({ queryKey: key });
			let result = resultFromErrorExtras(error.extras, previous);
			if (!result) {
				try {
					result = await fetchLoggingFor(request.projectId, true);
				} catch {
					result = null;
				}
			}
			if (!isLive(flow)) return "failed";
			if (!result || forMode(result) === "none") {
				set(blockedState(request));
				return "blocked";
			}
			set(
				pickState(request, result, invalid ? LOGGING_FOR_INVALID_TEXT : null),
			);
			return "prompted";
		}

		if (
			isTimeApiError(error, "TIMESHEET_LOCKED") &&
			(error.extras as Record<string, unknown>).reason === "period"
		) {
			const extras = error.extras as Record<string, unknown>;
			const timesheetId =
				typeof extras.timesheet_id === "string" ? extras.timesheet_id : null;
			const sheetStatus =
				typeof extras.sheet_status === "string"
					? (extras.sheet_status as TimesheetStatus)
					: null;
			set({
				...IDLE,
				step: "locked",
				request,
				choice,
				choiceLabel,
				remember,
				autoChoice,
				locked: {
					timesheetId,
					sheetStatus,
					label: null,
					periodKind: null,
					canWithdraw: Boolean(timesheetId) && sheetStatus === "submitted",
					withdrawing: false,
					message: periodLockedText({ sheetStatus }),
				},
			});
			if (timesheetId) void describeLockedSheet(flow, timesheetId);
			return "prompted";
		}

		if (isTimeApiError(error, "NO_LOGGING_CONTEXT")) {
			void queryClient.invalidateQueries({
				queryKey: timeKeys.loggingFor(request.projectId),
			});
			set(blockedState(request));
			return "blocked";
		}

		toast.error(
			isTimeApiError(error, "HOUR_CAP_EXCEEDED")
				? hourCapText(error.extras, choiceLabel)
				: timerErrorText(error),
		);
		set(IDLE);
		return "failed";
	};

	/** Fills the locked card with the sheet's label and whether Withdraw applies. */
	const describeLockedSheet = async (flow: number, timesheetId: string) => {
		let detail: TimesheetDetail;
		try {
			detail = await getDeps().queryClient.fetchQuery({
				...timeQueries.timesheet(timesheetId),
				staleTime: 0,
			});
		} catch {
			return;
		}
		const locked = state.locked;
		if (!isLive(flow) || state.step !== "locked") return;
		if (!locked || locked.timesheetId !== timesheetId) return;
		const sheet = detail.sheet;
		const sheetStatus = sheet.status ?? locked.sheetStatus;
		const actions = detail.viewer?.actions ?? [];
		set({
			...state,
			locked: {
				...locked,
				sheetStatus,
				label: sheet.scope_label_snapshot ?? null,
				periodKind: sheet.period_kind ?? null,
				canWithdraw:
					sheetStatus === "submitted" && actions.includes("withdraw"),
				message: periodLockedText({
					label: sheet.scope_label_snapshot,
					periodKind: sheet.period_kind,
					sheetStatus,
				}),
			},
		});
	};

	// ── The For choice, then the running check ────────────────────────────────

	/**
	 * The For choice for a start: the caller's own, or the only option (marked
	 * `autoChoice`, so it is not sent). With 0 options (blocked), 2+ (the
	 * picker) or a failed read the flow stops there, and `stopped` is its
	 * outcome.
	 */
	const resolveChoice = async (
		flow: number,
		request: StartTimerRequest,
	): Promise<{ choice: Choice } | { stopped: StartOutcome }> => {
		if (request.loggingFor) {
			return {
				choice: {
					choice: request.loggingFor,
					choiceLabel: request.loggingForLabel ?? null,
					remember: request.remember === true,
					autoChoice: false,
				},
			};
		}
		const from = promptOf(state);
		setIfLive(flow, {
			...(from ? state : IDLE),
			step: "resolving",
			request,
			error: null,
			busyIn: from,
		});
		let result: LoggingForResult;
		try {
			result = await fetchLoggingFor(request.projectId, false);
		} catch (error) {
			if (!isLive(flow)) return { stopped: "failed" };
			getDeps().toast.error(timerErrorText(error, undefined, "read"));
			set(IDLE);
			return { stopped: "failed" };
		}
		if (!isLive(flow)) return { stopped: "failed" };
		const mode = forMode(result);
		if (mode === "none") {
			set(blockedState(request));
			return { stopped: "blocked" };
		}
		if (mode === "single") {
			const only = result.selected ?? result.options[0];
			return {
				choice: {
					choice: toForRequest(only),
					choiceLabel: only.label,
					remember: false,
					autoChoice: true,
				},
			};
		}
		set(pickState(request, result, null));
		return { stopped: "prompted" };
	};

	/**
	 * A choice in hand: the Switch prompt when another timer runs (never two
	 * timers), else the start.
	 */
	const switchOrStart = (
		flow: number,
		request: StartTimerRequest,
		choice: Choice,
	): Promise<StartOutcome> | StartOutcome => {
		if (!isLive(flow)) return "failed";
		const running = readRunning();
		if (running) {
			if (isSameTimer(running, request)) {
				set(IDLE);
				return "already_running";
			}
			set({ ...IDLE, step: "switch", request, running, ...choice });
			return "prompted";
		}
		return startWith({ flow, request, ...choice, retries: 0 });
	};

	// ── Public actions ────────────────────────────────────────────────────────

	const start = async (request: StartTimerRequest): Promise<StartOutcome> => {
		if (!request.projectId || isBusyStep(state)) return "ignored";
		token += 1;
		const flow = token;
		const running = readRunning();
		if (running && isSameTimer(running, request)) {
			set(IDLE);
			return "already_running";
		}
		// The For step comes first: Switch is offered only for a start that can
		// happen, so a picker cancelled or a project with no option never leaves
		// the person with their timer stopped and nothing started.
		const resolved = await resolveChoice(flow, request);
		if ("stopped" in resolved) return resolved.stopped;
		return switchOrStart(flow, request, resolved.choice);
	};

	/** Switch: stop the running timer the prompt named, then start this one. */
	const confirmSwitch = async (): Promise<StartOutcome> => {
		const current = state;
		if (current.step !== "switch" || !current.request) return "ignored";
		const flow = token;
		const request = current.request;
		const shown = current.running;
		// The poll moved on since the prompt opened (that timer stopped and
		// another started elsewhere): ask about the one running now, never stop
		// a timer the person was not shown.
		const cached = readRunning();
		if (cached && cached.id !== shown?.id) {
			if (isSameTimer(cached, request)) {
				set(IDLE);
				return "already_running";
			}
			set({ ...current, running: cached, error: null });
			return "prompted";
		}
		let choice = choiceOf(current);
		if (!choice) {
			// Not reached by the flows above (Switch always follows the For step);
			// resolve before stopping anything all the same.
			const resolved = await resolveChoice(flow, request);
			if ("stopped" in resolved) return resolved.stopped;
			choice = resolved.choice;
		}
		set({
			...current,
			...choice,
			step: "starting",
			error: null,
			busyIn: "switch",
		});
		if (shown) {
			try {
				await timeService.stopEntry(shown.id);
			} catch (error) {
				// Already stopped elsewhere (another device, the cron): carry on.
				if (!isTimeApiError(error, "TIMER_NOT_RUNNING")) {
					setIfLive(flow, {
						...current,
						...choice,
						error: timerErrorText(error),
					});
					return "failed";
				}
			}
			const { queryClient, userId } = getDeps();
			setRunningEntry(queryClient, userId, null);
			void invalidateTime(queryClient, "entry");
		}
		if (!isLive(flow)) return "failed";
		return startWith({ flow, request, ...choice, retries: 0 });
	};

	/** The picker's selection (does not start). */
	const select = (option: Pick<LoggingOption, "kind" | "id" | "label">) => {
		if (state.step !== "pick") return;
		set({
			...state,
			choice: toForRequest(option),
			choiceLabel: option.label,
			remember: defaultRemember(state.result, option),
			error: null,
		});
	};

	const setRemember = (remember: boolean) => {
		if (state.step !== "pick") return;
		set({ ...state, remember });
	};

	/** The picker's primary button ("Start for Acme Corp"). */
	const confirmPick = async (): Promise<StartOutcome> => {
		const current = state;
		if (current.step !== "pick" || !current.request || !current.choice) {
			return "ignored";
		}
		const picked = current.choice;
		const label =
			current.result?.options.find((o) => isSameFor(o, picked))?.label ??
			current.choiceLabel;
		// A timer runs: the Switch prompt next, with this choice kept.
		return switchOrStart(token, current.request, {
			choice: picked,
			choiceLabel: label ?? null,
			remember: current.remember,
			autoChoice: false,
		});
	};

	/** The locked card's Withdraw: withdraw the sheet, then retry the same start. */
	const withdrawAndRetry = async (): Promise<StartOutcome> => {
		const current = state;
		const locked = current.locked;
		const choice = choiceOf(current);
		if (
			current.step !== "locked" ||
			!current.request ||
			!choice ||
			!locked?.timesheetId ||
			!locked.canWithdraw ||
			locked.withdrawing
		) {
			return "ignored";
		}
		const flow = token;
		const timesheetId = locked.timesheetId;
		const { queryClient, toast } = getDeps();
		set({ ...current, error: null, locked: { ...locked, withdrawing: true } });

		const fail = (message: string, patch: Partial<LockedPeriod> = {}) => {
			setIfLive(flow, {
				...state,
				error: message,
				locked: { ...(state.locked ?? locked), ...patch, withdrawing: false },
			});
			return "failed" as const;
		};

		/** Reads the sheet fresh (its revision), then withdraws it if still submitted. */
		const withdrawOnce = async (): Promise<TimesheetDetail | null> => {
			const detail = await queryClient.fetchQuery({
				...timeQueries.timesheet(timesheetId),
				staleTime: 0,
			});
			if (detail.sheet.status !== "submitted") return detail;
			await timeService.withdrawTimesheet(timesheetId, {
				expected_revision: detail.sheet.revision,
			});
			return null;
		};

		let notSubmitted: TimesheetDetail | null;
		try {
			try {
				notSubmitted = await withdrawOnce();
			} catch (error) {
				// The sheet moved under us: read it again and try once more.
				if (!isTimeApiError(error, "STALE_REVISION")) throw error;
				notSubmitted = await withdrawOnce();
			}
		} catch (error) {
			return fail(timerErrorText(error));
		}
		void invalidateTime(queryClient, "sheet");
		if (!isLive(flow)) return "failed";
		if (!notSubmitted) toast.success(WITHDRAWN_TOAST);
		if (notSubmitted?.sheet.status === "approved") {
			return fail(
				periodLockedText({
					label: notSubmitted.sheet.scope_label_snapshot,
					periodKind: notSubmitted.sheet.period_kind,
					sheetStatus: "approved",
				}),
				{ canWithdraw: false, sheetStatus: "approved" },
			);
		}
		// Withdrawn (or already open again): the same start, the same choice.
		return startWith({ flow, request: current.request, ...choice, retries: 0 });
	};

	/** Closes any prompt. Ignored while a call is in flight. */
	const cancel = () => {
		if (isBusyStep(state)) return;
		token += 1;
		set(IDLE);
	};

	return {
		getState: () => state,
		start,
		confirmSwitch,
		select,
		setRemember,
		confirmPick,
		withdrawAndRetry,
		cancel,
	};
}

export type StartTimerController = ReturnType<
	typeof createStartTimerController
>;

export interface UseStartTimerOptions {
	onStarted?: (entry: EntryWithWarnings) => void;
}

export function useStartTimer(options: UseStartTimerOptions = {}) {
	const queryClient = useQueryClient();
	const toast = useToast();
	const userId = useTimerUserId();
	const deps: StartTimerDeps = {
		queryClient,
		userId,
		toast,
		onStarted: options.onStarted,
	};
	const depsRef = useRef(deps);
	useEffect(() => {
		depsRef.current = deps;
	});

	const [state, setState] = useState<StartTimerState>(IDLE);
	const [controller] = useState(() =>
		createStartTimerController(() => depsRef.current, setState),
	);

	const step = state.step;
	return {
		state,
		step,
		/** Resolving the For options, starting, or withdrawing. */
		isPending: isBusyStep(state),
		/** A prompt is showing (Switch, picker, locked period, blocked). */
		isOpen: step === "blocked" || promptOf(state) !== null,
		/** The prompt on screen, busy or not. */
		prompt: step === "blocked" ? ("blocked" as const) : promptOf(state),
		start: controller.start,
		confirmSwitch: controller.confirmSwitch,
		select: controller.select,
		setRemember: controller.setRemember,
		confirmPick: controller.confirmPick,
		withdrawAndRetry: controller.withdrawAndRetry,
		cancel: controller.cancel,
	};
}

export type StartTimerFlow = ReturnType<typeof useStartTimer>;
