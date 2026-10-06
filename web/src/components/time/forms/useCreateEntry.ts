// web/src/components/time/forms/useCreateEntry.ts
//
// "Add time" (ux.md › The Time Page › Quick add, and the More options form):
// everything the two manual-entry forms share.
//
// - `useEntryContext(projectId)`: the For choice for the project (0 / 1 / 2+
//   options, ux.md › For Chip), the chosen option's policy and the timezone
//   its days are counted in (the context's policy; "Just me" uses the
//   person's own timezone).
// - `manualEntryRule(...)`: the inline reasons a form shows before anything is
//   sent: "Manual time is off in your agreement with Acme."
//   (MANUAL_ENTRIES_DISABLED) and "Prodigitality accepts time up to 7 days
//   back." (RETROACTIVE_WINDOW).
// - `defaultEntryStart(...)` / `useDefaultStart(...)`: the start defaults to
//   the end of that day's last entry, or 09:00 in the context's timezone.
// - `useCreateEntry()`: the write (`POST /time/entries`) and every answer the
//   server can give: 409 LOGGING_FOR_REQUIRED / 422 LOGGING_FOR_INVALID update
//   the For options in place (the form shows the picker); 403
//   MANUAL_ENTRIES_DISABLED, 422 RETROACTIVE_WINDOW and HOUR_CAP_EXCEEDED read
//   inline; 409 TIMESHEET_LOCKED {period} offers an inline Withdraw, then
//   retries the same entry.
//
// The only option on a project is shown but never sent (as in the timer's
// start flow): the server resolves it fresh, so a stale cache never picks
// among options that appeared since (L38). A remembered default with 2+
// options is preselected and named on the button, never applied silently.

import {
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/hooks/useToast";
import {
	entryWarningsCopy,
	lockedPeriodCopy,
	manualTimeOffCopy,
	nativeSafe,
	retroactiveWindowCopy,
	timeErrorCopy,
	timeToast,
} from "@/lib/timeErrors";
import { deviceTimeZone, formatDurationText } from "@/lib/timeFormat";
import {
	addDays,
	isLocalDate,
	isValidTimezone,
	localDate,
	retroactiveFloor,
	safeTimezone,
} from "@/lib/timePeriods";
import { invalidateTime, timeKeys, timeQueries } from "@/queries/time";
import { isTimeApiError, timeService } from "@/services/time.service";
import type {
	ContextKind,
	EntryWithWarnings,
	LoggingForRequest,
	LoggingForResult,
	LoggingOption,
	PeriodKind,
	PresetWorkItem,
	ResolvedTimePolicy,
	TimeEntryView,
	TimesheetDetail,
	TimesheetStatus,
	WorkType,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import {
	defaultRemember,
	type ForMode,
	forMode,
	isSameFor,
	preselectedOption,
	resultFromErrorExtras,
	toForRequest,
} from "../for/forOptions";

// ── Wall clock in a timezone ────────────────────────────────────────────────

/** The form value of a date-time field: `yyyy-MM-ddTHH:mm`. */
const WALL_CLOCK_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/** The start time a day defaults to when it has no entry yet. */
export const DEFAULT_DAY_START = "09:00";

/** An instant as the wall clock of `tz` (`yyyy-MM-ddTHH:mm`); "" when unreadable. */
export function toWallClock(at: Date | string | null | undefined, tz: string) {
	if (at === null || at === undefined || at === "") return "";
	const date = at instanceof Date ? at : new Date(at);
	if (Number.isNaN(date.getTime())) return "";
	return formatInTimeZone(date, safeTimezone(tz), "yyyy-MM-dd'T'HH:mm");
}

/** A wall clock of `tz` (`yyyy-MM-ddTHH:mm`) as an instant; null when unreadable. */
export function fromWallClock(
	value: string | null | undefined,
	tz: string,
): Date | null {
	const match = WALL_CLOCK_RE.exec(value?.trim() ?? "");
	if (!match || !isLocalDate(match[1])) return null;
	if (Number(match[2]) > 23 || Number(match[3]) > 59) return null;
	const date = fromZonedTime(
		`${match[1]}T${match[2]}:${match[3]}:00`,
		safeTimezone(tz),
	);
	return Number.isNaN(date.getTime()) ? null : date;
}

/** `day` at `time` (`HH:mm`, default 09:00) in `tz`. */
export function dayAt(day: string, tz: string, time = DEFAULT_DAY_START): Date {
	return fromWallClock(`${day}T${time}`, tz) ?? new Date(Number.NaN);
}

// ── Defaults ────────────────────────────────────────────────────────────────

/**
 * Where new time on `day` starts (ux.md › Quick add): the end of that day's
 * last finished entry (days counted in `timezone`), else 09:00 there. A
 * running timer has no end yet and is skipped.
 */
export function defaultEntryStart(input: {
	day: string;
	timezone: string;
	entries?: readonly Pick<TimeEntryView, "started_at" | "ended_at">[] | null;
}): Date {
	const tz = safeTimezone(input.timezone);
	let last: number | null = null;
	for (const entry of input.entries ?? []) {
		if (!entry.ended_at) continue;
		let startDay: string;
		try {
			startDay = localDate(entry.started_at, tz);
		} catch {
			continue;
		}
		if (startDay !== input.day) continue;
		const end = new Date(entry.ended_at).getTime();
		if (Number.isFinite(end) && (last === null || end > last)) last = end;
	}
	return last === null ? dayAt(input.day, tz) : new Date(last);
}

// ── Inline rules ────────────────────────────────────────────────────────────

export interface ManualEntryRule {
	/** Adding is refused before anything is sent. */
	blocked: boolean;
	reason: "manual_off" | "retroactive" | null;
	/** The sentence to show inline. */
	message: string | null;
	/** The oldest local date the context accepts (null = no limit). */
	floor: string | null;
}

export const OPEN_MANUAL_RULE: ManualEntryRule = Object.freeze({
	blocked: false,
	reason: null,
	message: null,
	floor: null,
}) as ManualEntryRule;

/**
 * The reasons a manual entry would be refused, read from the chosen option's
 * policy before sending (the server stays the authority):
 * `allow_manual_entries: false` and the retroactive window, counted in the
 * context's timezone. "Just me" has no policy, so nothing is refused.
 */
export function manualEntryRule(input: {
	policy: Pick<
		ResolvedTimePolicy,
		"allow_manual_entries" | "retroactive_days"
	> | null;
	option: Pick<LoggingOption, "kind" | "label"> | null;
	/** The entry's start day in `timezone` (`YYYY-MM-DD`); null when unknown. */
	day: string | null;
	timezone: string;
	now?: Date;
	/** Defaults to `isNativeApp()` (a label naming a banned word falls back). */
	native?: boolean;
}): ManualEntryRule {
	const { policy, option } = input;
	if (!policy || !option || option.kind === "personal") return OPEN_MANUAL_RULE;
	const label = option.label;
	const labelKind = option.kind;
	if (policy.allow_manual_entries === false) {
		return {
			blocked: true,
			reason: "manual_off",
			message: nativeSafe(manualTimeOffCopy({ label, labelKind }), {
				native: input.native,
			}),
			floor: null,
		};
	}
	const floor = retroactiveFloor(
		input.now ?? new Date(),
		safeTimezone(input.timezone),
		policy.retroactive_days ?? null,
	);
	if (floor && input.day && input.day < floor) {
		return {
			blocked: true,
			reason: "retroactive",
			message: nativeSafe(
				retroactiveWindowCopy({
					label,
					labelKind,
					days: policy.retroactive_days,
					earliestDate: floor,
				}),
				{ native: input.native },
			),
			floor,
		};
	}
	return { ...OPEN_MANUAL_RULE, floor };
}

// ── The For choice and its policy ───────────────────────────────────────────

export interface ForChoice {
	projectId: string | null;
	result: LoggingForResult | null;
	mode: ForMode;
	/** The option in play: the only one, the picked one, or the remembered prefill. */
	option: LoggingOption | null;
	/** `option` as the write body's `logging_for`. */
	choice: LoggingForRequest | null;
	/** "Use for new time on this project". */
	remember: boolean;
	/** The project's only option: named in copy, never sent. */
	autoChoice: boolean;
	/** 2+ options and nothing chosen yet. */
	needsChoice: boolean;
	/** 2+ options and the choice came from the remembered default (one tap confirms). */
	isPrefill: boolean;
	isLoading: boolean;
	error: unknown;
	select: (option: Pick<LoggingOption, "kind" | "id">) => void;
	setRemember: (remember: boolean) => void;
}

interface PickState {
	projectId: string | null;
	picked: LoggingForRequest | null;
	remember: boolean | null;
}

/** The For choice of a project, derived from the resolver's answer (pure). */
export function deriveForChoice(
	result: LoggingForResult | null,
	picked: LoggingForRequest | null,
	rememberOverride: boolean | null,
): Pick<
	ForChoice,
	| "mode"
	| "option"
	| "choice"
	| "remember"
	| "autoChoice"
	| "needsChoice"
	| "isPrefill"
> {
	const mode = forMode(result);
	if (!result || mode === "none") {
		return {
			mode,
			option: null,
			choice: null,
			remember: false,
			autoChoice: false,
			needsChoice: false,
			isPrefill: false,
		};
	}
	if (mode === "single") {
		const only = result.selected ?? result.options[0];
		return {
			mode,
			option: only,
			choice: toForRequest(only),
			remember: false,
			autoChoice: true,
			needsChoice: false,
			isPrefill: false,
		};
	}
	const chosen =
		(picked && result.options.find((o) => isSameFor(o, picked))) || null;
	const option = chosen ?? preselectedOption(result);
	return {
		mode,
		option,
		choice: option ? toForRequest(option) : null,
		remember: rememberOverride ?? defaultRemember(result, option),
		autoChoice: false,
		needsChoice: !option,
		isPrefill: !chosen && Boolean(option),
	};
}

/** The For choice for `projectId` (`GET logging-for`, 30 s cache). */
export function useForChoice(
	projectId: string | null | undefined,
	options: { enabled?: boolean; initial?: LoggingForRequest | null } = {},
): ForChoice {
	const id = projectId || null;
	const query = useQuery({
		...timeQueries.loggingFor(id),
		enabled: Boolean(id) && options.enabled !== false,
	});
	const [pick, setPick] = useState<PickState>(() => ({
		projectId: id,
		picked: options.initial ?? null,
		remember: null,
	}));
	// Another project: its own choice, from scratch.
	const current: PickState =
		pick.projectId === id
			? pick
			: { projectId: id, picked: null, remember: null };
	const result = query.data ?? null;
	const derived = useMemo(
		() => deriveForChoice(result, current.picked, current.remember),
		[result, current.picked, current.remember],
	);
	return {
		projectId: id,
		result,
		...derived,
		isLoading: Boolean(id) && query.isPending && query.fetchStatus !== "idle",
		error: query.error,
		select: (option) =>
			setPick({
				projectId: id,
				picked: toForRequest(option),
				remember: null,
			}),
		setRemember: (remember) =>
			setPick((prev) => ({
				projectId: id,
				picked: prev.projectId === id ? prev.picked : null,
				remember,
			})),
	};
}

/** The person's own timezone: their Time preference, else the device's. */
export function useUserTimezone(): string {
	const userId = useAuthStore((state) => state.user?.id ?? null);
	const prefs = useQuery(timeQueries.preferences(userId));
	const stored = prefs.data?.timezone;
	return stored && isValidTimezone(stored) ? stored : deviceTimeZone();
}

/** The timezone an option's days are counted in. */
export function contextTimezone(
	option: Pick<LoggingOption, "kind"> | null,
	policy: Pick<ResolvedTimePolicy, "timezone"> | null | undefined,
	userTimezone: string,
): string {
	if (!option || option.kind === "personal" || !policy?.timezone) {
		return safeTimezone(userTimezone);
	}
	return safeTimezone(policy.timezone);
}

export interface EntryContext {
	forChoice: ForChoice;
	/** The chosen option's resolved policy (null for "Just me" or before a choice). */
	policy: ResolvedTimePolicy | null;
	policyLoading: boolean;
	/** Where days are counted: the context's policy timezone, or the person's own. */
	timezone: string;
	userTimezone: string;
}

/** The For choice, its policy and timezone for a project. */
export function useEntryContext(
	projectId: string | null | undefined,
	options: { enabled?: boolean; initialFor?: LoggingForRequest | null } = {},
): EntryContext {
	const forChoice = useForChoice(projectId, {
		enabled: options.enabled,
		initial: options.initialFor,
	});
	const userTimezone = useUserTimezone();
	const option = forChoice.option;
	const governed = Boolean(option && option.kind !== "personal");
	const forRef = option ? toForRequest(option) : null;
	const policyQuery = useQuery({
		...timeQueries.projectPolicy(projectId, forRef),
		enabled:
			Boolean(projectId) && governed && options.enabled !== false && !!forRef,
	});
	const policy = governed ? (policyQuery.data ?? null) : null;
	return {
		forChoice,
		policy,
		policyLoading:
			governed && policyQuery.isPending && policyQuery.fetchStatus !== "idle",
		timezone: contextTimezone(option, policy, userTimezone),
		userTimezone,
	};
}

/**
 * The default start on `day` (see `defaultEntryStart`) from the person's own
 * entries around that day. Null while loading.
 */
export function useDefaultStart(input: {
	day: string | null;
	timezone: string;
	enabled?: boolean;
}): { start: Date | null; isLoading: boolean } {
	const userId = useAuthStore((state) => state.user?.id ?? null);
	const day = input.day && isLocalDate(input.day) ? input.day : null;
	// One day either side: the list is ranged in the person's own timezone,
	// the day in the context's.
	const query = useQuery({
		...timeQueries.myEntries(userId, {
			from: day ? addDays(day, -1) : "",
			to: day ? addDays(day, 1) : "",
			limit: 200,
		}),
		enabled: Boolean(userId && day) && input.enabled !== false,
	});
	const items = query.data?.items;
	const start = useMemo(() => {
		if (!day) return null;
		if (!items && query.isPending && query.fetchStatus !== "idle") return null;
		return defaultEntryStart({
			day,
			timezone: input.timezone,
			entries: items ?? [],
		});
	}, [day, input.timezone, items, query.isPending, query.fetchStatus]);
	return {
		start,
		isLoading: Boolean(day) && query.isPending && query.fetchStatus !== "idle",
	};
}

// ── The write ───────────────────────────────────────────────────────────────

export interface CreateEntryRequest {
	projectId: string;
	/** XOR `workItem`. */
	taskId?: string | null;
	workItem?: PresetWorkItem | null;
	/** ISO instants. */
	startedAt: string;
	endedAt: string;
	breakSeconds?: number;
	note?: string | null;
	workType?: WorkType;
	/** The For choice (`forRequestFields(forChoice)`). */
	loggingFor?: LoggingForRequest | null;
	remember?: boolean;
	/** The only option: not sent (the server resolves it fresh). */
	autoChoice?: boolean;
	/** The chosen option's label and kind, for copy. */
	forLabel?: string | null;
	forKind?: ContextKind | null;
	/** The policy's retroactive window, for RETROACTIVE_WINDOW copy. */
	retroactiveDays?: number | null;
}

/** A For choice as the request's For fields. */
export function forRequestFields(
	forChoice: Pick<
		ForChoice,
		"choice" | "remember" | "autoChoice" | "option"
	> | null,
): Pick<
	CreateEntryRequest,
	"loggingFor" | "remember" | "autoChoice" | "forLabel" | "forKind"
> {
	return {
		loggingFor: forChoice?.choice ?? null,
		remember: forChoice?.remember ?? false,
		autoChoice: forChoice?.autoChoice ?? false,
		forLabel: forChoice?.option?.label ?? null,
		forKind: forChoice?.option?.kind ?? null,
	};
}

/** The body `POST /time/entries` gets (the only option is never sent). */
export function createEntryBody(request: CreateEntryRequest) {
	const sendChoice = !request.autoChoice && Boolean(request.loggingFor);
	const note = request.note?.trim();
	const breakSeconds = Math.max(0, Math.round(request.breakSeconds ?? 0));
	return {
		project_id: request.projectId,
		...(request.taskId ? { task_id: request.taskId } : {}),
		...(request.workItem && !request.taskId
			? { work_item: request.workItem }
			: {}),
		started_at: request.startedAt,
		ended_at: request.endedAt,
		...(breakSeconds > 0 ? { break_seconds: breakSeconds } : {}),
		...(note ? { note } : {}),
		...(request.workType ? { work_type: request.workType } : {}),
		...(sendChoice && request.loggingFor
			? { logging_for: request.loggingFor }
			: {}),
		...(sendChoice && request.remember ? { remember: true } : {}),
	};
}

export type CreateEntryOutcome =
	| "created"
	| "pick"
	| "locked"
	| "failed"
	| "ignored";

export interface LockedSheet {
	timesheetId: string | null;
	sheetStatus: TimesheetStatus | null;
	label: string | null;
	periodKind: PeriodKind | null;
	/** Only the person's own submitted sheet can be withdrawn. */
	canWithdraw: boolean;
	withdrawing: boolean;
	/** "This week's Prodigitality timesheet is submitted. Withdraw it to add time." */
	message: string;
}

export interface CreateEntryState {
	status: "idle" | "saving" | "error" | "pick" | "locked";
	/** The inline message, with the code it came from. */
	error: { code: string; message: string } | null;
	locked: LockedSheet | null;
	request: CreateEntryRequest | null;
}

export const IDLE_CREATE_STATE: CreateEntryState = Object.freeze({
	status: "idle",
	error: null,
	locked: null,
	request: null,
}) as CreateEntryState;

export interface CreateEntryDeps {
	queryClient: QueryClient;
	toast: {
		success: (message: string) => void;
		warning: (message: string) => void;
	};
	onCreated?: (entry: EntryWithWarnings) => void;
}

/** "Added 1h 30m." (the toast after a manual entry). */
export function entryAddedToast(
	entry: Pick<TimeEntryView, "duration_seconds">,
): string {
	const seconds = entry.duration_seconds ?? 0;
	return seconds > 0 ? `Added ${formatDurationText(seconds)}.` : "Time added.";
}

/** The flow as plain functions; `useCreateEntry` binds it to React state. */
export function createEntryController(
	getDeps: () => CreateEntryDeps,
	onChange: (state: CreateEntryState) => void,
) {
	let state: CreateEntryState = IDLE_CREATE_STATE;
	let token = 0;
	const set = (next: CreateEntryState) => {
		state = next;
		onChange(next);
	};
	const isLive = (flow: number) => flow === token;

	const copyContext = (request: CreateEntryRequest) => ({
		label: request.forLabel ?? null,
		labelKind: request.forKind ?? null,
		retroactiveDays: request.retroactiveDays ?? null,
		subject: "entry" as const,
		operation: "write" as const,
	});

	const send = async (
		flow: number,
		request: CreateEntryRequest,
	): Promise<CreateEntryOutcome> => {
		set({ ...IDLE_CREATE_STATE, status: "saving", request });
		let row: EntryWithWarnings;
		try {
			row = await timeService.createEntry(createEntryBody(request));
		} catch (error) {
			return onError(flow, request, error);
		}
		const deps = getDeps();
		void invalidateTime(deps.queryClient, "entry");
		deps.toast.success(entryAddedToast(row));
		const agreementLabel =
			row.context_kind === "assignment"
				? row.context_label_snapshot
				: request.forKind === "assignment"
					? request.forLabel
					: null;
		for (const text of entryWarningsCopy(row.warnings, { agreementLabel })) {
			deps.toast.warning(text);
		}
		if (isLive(flow)) set(IDLE_CREATE_STATE);
		deps.onCreated?.(row);
		return "created";
	};

	const onError = async (
		flow: number,
		request: CreateEntryRequest,
		error: unknown,
	): Promise<CreateEntryOutcome> => {
		if (!isLive(flow)) return "failed";
		const { queryClient } = getDeps();
		const copy = timeErrorCopy(error, copyContext(request));
		const inline = { code: copy.code, message: copy.message };

		// Several options now (the cache said one), or the choice went stale:
		// the server's options replace the cached ones and the form asks.
		if (isTimeApiError(error, "LOGGING_FOR_REQUIRED", "LOGGING_FOR_INVALID")) {
			const key = timeKeys.loggingFor(request.projectId);
			const previous = queryClient.getQueryData<LoggingForResult>(key);
			const next = resultFromErrorExtras(error.extras, previous);
			if (next) queryClient.setQueryData(key, next);
			void queryClient.invalidateQueries({ queryKey: key });
			set({ ...IDLE_CREATE_STATE, status: "pick", error: inline, request });
			return "pick";
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
				...IDLE_CREATE_STATE,
				status: "locked",
				request,
				locked: {
					timesheetId,
					sheetStatus,
					label: null,
					periodKind: null,
					canWithdraw: Boolean(timesheetId) && sheetStatus === "submitted",
					withdrawing: false,
					// The For label may not be the sheet's (a Pro team's time lands on
					// the workspace sheet): unnamed until the sheet itself is read.
					message: lockedMessage(
						{ scope_label_snapshot: "", period_kind: "weekly" },
						sheetStatus,
					),
				},
			});
			if (timesheetId) void describeLocked(flow, timesheetId);
			return "locked";
		}

		if (isTimeApiError(error, "NO_LOGGING_CONTEXT")) {
			void queryClient.invalidateQueries({
				queryKey: timeKeys.loggingFor(request.projectId),
			});
			void queryClient.invalidateQueries({
				queryKey: ["time", "me", "projects"],
			});
		}
		if (
			isTimeApiError(
				error,
				"MANUAL_ENTRIES_DISABLED",
				"RETROACTIVE_WINDOW",
				"HOUR_CAP_EXCEEDED",
			)
		) {
			// The policy moved since the form read it: the inline rule refreshes.
			void queryClient.invalidateQueries({
				queryKey: ["time", "project-policy", request.projectId],
			});
		}
		set({ ...IDLE_CREATE_STATE, status: "error", error: inline, request });
		return "failed";
	};

	/** Fills the locked notice with the sheet's label and whether Withdraw applies. */
	const describeLocked = async (flow: number, timesheetId: string) => {
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
		if (!isLive(flow) || state.status !== "locked") return;
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
				message: lockedMessage(sheet, sheetStatus),
			},
		});
	};

	const lockedMessage = (
		sheet: Pick<
			TimesheetDetail["sheet"],
			"scope_label_snapshot" | "period_kind"
		>,
		sheetStatus: TimesheetStatus | null,
	) =>
		nativeSafe(
			lockedPeriodCopy({
				label: sheet.scope_label_snapshot,
				periodKind: sheet.period_kind,
				sheetStatus,
			}),
			{ stripAmounts: true },
		);

	const create = async (
		request: CreateEntryRequest,
	): Promise<CreateEntryOutcome> => {
		if (state.status === "saving" || state.locked?.withdrawing) {
			return "ignored";
		}
		token += 1;
		return send(token, request);
	};

	/** The locked notice's Withdraw: withdraw the sheet, then add the same entry. */
	const withdrawAndRetry = async (): Promise<CreateEntryOutcome> => {
		const current = state;
		const locked = current.locked;
		if (
			current.status !== "locked" ||
			!current.request ||
			!locked?.timesheetId ||
			!locked.canWithdraw ||
			locked.withdrawing
		) {
			return "ignored";
		}
		const flow = token;
		const request = current.request;
		const timesheetId = locked.timesheetId;
		const { queryClient, toast } = getDeps();
		set({ ...current, error: null, locked: { ...locked, withdrawing: true } });

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
			if (isLive(flow)) {
				const copy = timeErrorCopy(error, {
					subject: "timesheet",
					operation: "write",
				});
				set({
					...state,
					error: { code: copy.code, message: copy.message },
					locked: { ...locked, withdrawing: false },
				});
			}
			return "failed";
		}
		void invalidateTime(queryClient, "sheet");
		if (!isLive(flow)) return "failed";
		if (notSubmitted?.sheet.status === "approved") {
			set({
				...state,
				locked: {
					...locked,
					withdrawing: false,
					canWithdraw: false,
					sheetStatus: "approved",
					message: lockedMessage(notSubmitted.sheet, "approved"),
				},
			});
			return "locked";
		}
		if (!notSubmitted) toast.success(timeToast("withdraw"));
		// Withdrawn (or already open again): the same entry.
		return send(flow, request);
	};

	/** Clears the inline state (a closed form). Ignored while a call is in flight. */
	const reset = () => {
		if (state.status === "saving" || state.locked?.withdrawing) return;
		token += 1;
		set(IDLE_CREATE_STATE);
	};

	return {
		getState: () => state,
		create,
		withdrawAndRetry,
		reset,
	};
}

export type CreateEntryController = ReturnType<typeof createEntryController>;

export interface UseCreateEntryOptions {
	onCreated?: (entry: EntryWithWarnings) => void;
}

export function useCreateEntry(options: UseCreateEntryOptions = {}) {
	const queryClient = useQueryClient();
	const toast = useToast();
	const deps: CreateEntryDeps = {
		queryClient,
		toast,
		onCreated: options.onCreated,
	};
	const depsRef = useRef(deps);
	useEffect(() => {
		depsRef.current = deps;
	});
	const [state, setState] = useState<CreateEntryState>(IDLE_CREATE_STATE);
	const [controller] = useState(() =>
		createEntryController(() => depsRef.current, setState),
	);
	return {
		state,
		/** Saving, or withdrawing a locked sheet. */
		isPending: state.status === "saving" || Boolean(state.locked?.withdrawing),
		create: controller.create,
		withdrawAndRetry: controller.withdrawAndRetry,
		reset: controller.reset,
	};
}

export type CreateEntryFlow = ReturnType<typeof useCreateEntry>;
