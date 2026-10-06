// web/src/components/time/edit/ChangeForDialog.tsx
//
// "Change For…" on one entry (the timer bar's running chip, a row menu) or on
// a selection (ux.md › For Chip › Chip details, L2, L58):
//
// - Works only on rows whose current AND target timesheets are Open or
//   Returned (L2). A row on a submitted or approved sheet, or a paid, billed,
//   legacy or approved entry, is shown disabled with its reason. When the
//   caller passes the person's timesheets, a row whose target sheet is
//   already submitted or approved is disabled up front too.
// - A change INTO an agreement skips entries logged before it (L58): each
//   remaining row's date is checked against the resolver (`logging-for?at=`),
//   and rows the agreement doesn't cover read "Logged before this agreement
//   started." The server's own refusal says the same, for anything the check
//   could not see (an entry created before the assignment).
// - Rows already on the target are skipped ("Already for Acme.").
// - Each row is its own PATCH (`logging_for` + `expected_updated_at`), one
//   at a time, with a per-row result. A STALE_REVISION is re-read and tried
//   once more (Change For sends no times or note, so nothing typed is lost).
// - The options are the project's resolver answer; for a selection spanning
//   several projects, only the choices every project offers.
// - Web says "Rates are re-estimated for the new choice."; native never
//   mentions rates.

import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
	Ban,
	Check,
	Equal,
	Loader2,
	Lock,
	type LucideIcon,
	RotateCcw,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { entryLockCopy } from "@/components/time/entries/entryRules";
import { ForChip } from "@/components/time/for/ForChip";
import { ForPicker } from "@/components/time/for/ForPicker";
import { entryWorkLabel } from "@/components/time/for/forCopy";
import {
	forChipOptionFromEntry,
	isSameFor,
	toForRequest,
} from "@/components/time/for/forOptions";
import { TimeReasonCard } from "@/components/time/shared/TimeReasonCard";
import { useToast } from "@/hooks/useToast";
import { isNativeApp } from "@/lib/platform";
import {
	beforeAgreementCopy,
	changeForRatesNote,
	entryWarningsCopy,
	lockedChipCopy,
	lockedPeriodCopy,
	nativeSafe,
	timeErrorCopy,
} from "@/lib/timeErrors";
import { contextLabel, deviceTimeZone } from "@/lib/timeFormat";
import { localDate, safeTimezone } from "@/lib/timePeriods";
import {
	invalidateTime,
	retryTimeQuery,
	TIME_STALE,
	timeKeys,
	timeQueries,
} from "@/queries/time";
import {
	isTimeApiError,
	timeService,
	toTimeApiError,
} from "@/services/time.service";
import type {
	EntryWarning,
	LoggingForRequest,
	LoggingForResult,
	LoggingOption,
	TimeEntryView,
	TimesheetSummary,
} from "@/services/time.types";
import { entrySpanLine } from "./DeleteEntryModal";

// ── Copy ────────────────────────────────────────────────────────────────────

export const CHANGE_FOR_COPY = {
	title: "Change For",
	forHeading: "For",
	entriesHeading: "Entries",
	cancel: "Cancel",
	close: "Close",
	tryAgain: "Try again",
	loading: "Loading the choices…",
	checking: "Checking…",
	changed: "Changed",
	noProject: "This entry isn't on a project, so its For can't change.",
	notAvailableOnDay: "This choice isn't available for this entry's day.",
	noOptions: "You can't log time on this project.",
	noSharedOptions:
		"These entries are on projects with no choice in common. Change them one project at a time.",
} as const;

/** "1 entry selected" / "3 entries selected". */
export function selectedCountText(count: number): string {
	return `${count} ${count === 1 ? "entry" : "entries"} selected`;
}

/** The primary button: "Change 1 entry" / "Change 3 entries". */
export function changeButtonText(count: number): string {
	return `Change ${count} ${count === 1 ? "entry" : "entries"}`;
}

/** The success toast: "3 entries are now for Acme Corp." / "1 entry is now for Just me." */
export function changedToastText(
	count: number,
	target: Pick<LoggingOption, "kind" | "label">,
): string {
	const label = contextLabel(target.kind, target.label) || target.label;
	return count === 1
		? `1 entry is now for ${label}.`
		: `${count} entries are now for ${label}.`;
}

/** "Already for Acme Corp." */
export function alreadyForText(
	target: Pick<LoggingOption, "kind" | "label">,
): string {
	return `Already for ${contextLabel(target.kind, target.label) || target.label}.`;
}

// ── Pure logic ──────────────────────────────────────────────────────────────

/**
 * The For choices a selection can move to: the project's resolver answer, or
 * for several projects the options every one of them offers (in the first
 * project's order and labels). Unavailable rows are only meaningful for one
 * project. Null until every project has answered.
 */
export function sharedForResult(
	results: ReadonlyArray<LoggingForResult | null | undefined>,
): LoggingForResult | null {
	if (results.length === 0 || results.some((r) => !r)) return null;
	const list = results as LoggingForResult[];
	if (list.length === 1) return list[0];
	const [first, ...rest] = list;
	const options = first.options.filter((option) =>
		rest.every((r) => r.options.some((other) => isSameFor(other, option))),
	);
	return {
		options,
		selected: options.length === 1 ? options[0] : null,
		prefill: null,
		unavailable: [],
	};
}

/** The person's sheet a row would land on under `target` (its scope and period), if known. */
export function targetSheetFor(
	entry: Pick<TimeEntryView, "started_at">,
	target: Pick<LoggingOption, "sheet_scope">,
	timesheets: readonly TimesheetSummary[] | null | undefined,
): TimesheetSummary | null {
	const scope = target.sheet_scope;
	if (!scope || !timesheets?.length) return null;
	const ref = scope.ref.toLowerCase();
	for (const sheet of timesheets) {
		if (sheet.scope_kind !== scope.kind) continue;
		if ((sheet.scope_ref ?? "").toLowerCase() !== ref) continue;
		const day = localDate(entry.started_at, sheet.timezone);
		if (day >= sheet.period_start && day <= sheet.period_end) return sheet;
	}
	return null;
}

export type ChangeForRowStatus =
	| "pending"
	| "eligible"
	| "same"
	| "blocked"
	| "checking";

export interface ChangeForRowState {
	status: ChangeForRowStatus;
	/** Why a row is skipped or blocked (shown under it). */
	reason: string | null;
}

export interface ChangeForRowContext {
	timesheets?: readonly TimesheetSummary[] | null;
	/** The dated resolver check is still running for this row. */
	checking?: boolean;
	/** The dated resolver check says the target doesn't cover this row's day. */
	notCovered?: boolean;
	timeZone?: string;
	native?: boolean;
}

/** What Change For would do to one row (L2 sheet rule, L58 agreement rule). */
export function changeForRowState(
	entry: TimeEntryView,
	target: LoggingOption | null,
	ctx: ChangeForRowContext = {},
): ChangeForRowState {
	const native = ctx.native ?? isNativeApp();
	if (!entry.project_id) {
		return { status: "blocked", reason: CHANGE_FOR_COPY.noProject };
	}
	const lock = entryLockCopy(entry, { timeZone: ctx.timeZone, native });
	if (lock) return { status: "blocked", reason: lock };
	const sheetStatus = entry.timesheet?.status;
	if (sheetStatus === "submitted" || sheetStatus === "approved") {
		return {
			status: "blocked",
			reason: nativeSafe(lockedChipCopy(sheetStatus, null), { native }),
		};
	}
	if (!target) return { status: "pending", reason: null };
	if (isSameFor(forChipOptionFromEntry(entry), target)) {
		return {
			status: "same",
			reason: nativeSafe(alreadyForText(target), { native }),
		};
	}
	const sheet = targetSheetFor(entry, target, ctx.timesheets);
	if (sheet && (sheet.status === "submitted" || sheet.status === "approved")) {
		return {
			status: "blocked",
			reason: nativeSafe(
				lockedPeriodCopy({
					label: sheet.scope_label_snapshot,
					periodKind: sheet.period_kind,
					sheetStatus: sheet.status,
				}),
				{ native },
			),
		};
	}
	if (target.kind === "assignment") {
		if (ctx.checking) return { status: "checking", reason: null };
		if (ctx.notCovered) {
			return { status: "blocked", reason: beforeAgreementCopy(null) };
		}
	}
	return { status: "eligible", reason: null };
}

const BEFORE_AGREEMENT_SERVER_RE = /before the agreement/i;
const RETRYABLE_CODES = new Set([
	"NETWORK_ERROR",
	"CLIENT_ERROR",
	"TIME_INTERNAL",
	"STALE_REVISION",
]);

/** A row's failed PATCH, in people's words, and whether trying again could help. */
export function changeForErrorCopy(
	error: unknown,
	target: Pick<LoggingOption, "kind" | "label">,
	options: { native?: boolean } = {},
): { message: string; retryable: boolean } {
	const native = options.native ?? isNativeApp();
	const err = toTimeApiError(error);
	const retryable = RETRYABLE_CODES.has(err.code) || err.status >= 500;
	if (err.code === "LOGGING_FOR_INVALID") {
		const message =
			target.kind === "assignment" &&
			BEFORE_AGREEMENT_SERVER_RE.test(err.message)
				? beforeAgreementCopy(null)
				: CHANGE_FOR_COPY.notAvailableOnDay;
		return { message: nativeSafe(message, { native }), retryable: false };
	}
	return {
		message: timeErrorCopy(err, {
			native,
			label: target.kind === "personal" ? null : target.label,
			labelKind: target.kind,
			subject: "entry",
			operation: "write",
		}).message,
		retryable,
	};
}

/**
 * The resolver's labels as native may show them ("contract" → "agreement",
 * anything else banned → the web-only fallback). Ids are untouched, so the
 * choice still matches the server's options.
 */
export function nativeSafeResult(
	result: LoggingForResult | null,
	native: boolean,
): LoggingForResult | null {
	if (!result || !native) return result;
	const safe = <T extends { label: string }>(item: T): T => ({
		...item,
		label: nativeSafe(item.label, { native }),
	});
	return {
		...result,
		options: result.options.map(safe),
		selected: result.selected ? safe(result.selected) : null,
		prefill: result.prefill ? safe(result.prefill) : null,
		unavailable: result.unavailable.map(safe),
	};
}

/** A row that turned out ineligible on a fresh read (after a stale revision). */
class RowRefusal extends Error {}

// ── Component ───────────────────────────────────────────────────────────────

export interface ChangeForOutcome {
	target: LoggingForRequest;
	/** Entry ids moved to the target. */
	changed: string[];
	/** Entry ids whose PATCH was refused or failed. */
	failed: string[];
	/** Entry ids not sent (already on the target, locked, before the agreement). */
	skipped: string[];
}

export interface ChangeForDialogProps {
	open: boolean;
	/** The entries to move (one, or a selection). Snapshotted when the dialog opens. */
	entries: readonly TimeEntryView[];
	onClose: () => void;
	/** The person's timesheets around these entries (`me/timesheets`): rows whose target sheet is submitted or approved are disabled up front. */
	timesheets?: readonly TimesheetSummary[] | null;
	/** The timezone the rows' days and times are shown in. Defaults to the device's. */
	timeZone?: string;
	projectWorkspaceName?: string | null;
	/** After a run (all rows changed, or some failed and the person closed). */
	onDone?: (outcome: ChangeForOutcome) => void;
	/** AppDialog z-index; nested dialogs step up by 10. */
	zIndex?: number;
}

type RowResult =
	| { status: "working" }
	| { status: "done" }
	| { status: "failed"; message: string; retryable: boolean };

/** At most this many dated checks per target; the server decides beyond. */
const MAX_DATED_CHECKS = 50;

export function ChangeForDialog({
	open,
	entries,
	onClose,
	timesheets,
	timeZone,
	projectWorkspaceName,
	onDone,
	zIndex = 1200,
}: ChangeForDialogProps) {
	const tz = safeTimezone(timeZone ?? deviceTimeZone());
	const queryClient = useQueryClient();
	const toast = useToast();
	const native = isNativeApp();

	const [rows, setRows] = useState<TimeEntryView[]>(() => [...entries]);
	const [target, setTarget] = useState<LoggingOption | null>(null);
	const [results, setResults] = useState<Record<string, RowResult>>({});
	const [running, setRunning] = useState(false);

	// Snapshot the rows when the dialog opens (or the selection changes before
	// anything ran). Once a run has results, the page refreshing or clearing
	// its selection underneath never swaps the rows those results describe.
	const idsKey = entries.map((entry) => entry.id).join(",");
	const hasResults = Object.keys(results).length > 0;
	useEffect(() => {
		if (!open) {
			setTarget(null);
			setResults({});
			setRunning(false);
			return;
		}
		if (hasResults || running || entries.length === 0) return;
		setRows([...entries]);
		setTarget(null);
	}, [open, idsKey]);

	const projectIds = useMemo(
		() =>
			Array.from(
				new Set(
					rows
						.map((entry) => entry.project_id)
						.filter((id): id is string => Boolean(id)),
				),
			),
		[rows],
	);

	const optionQueries = useQueries({
		queries: projectIds.map((projectId) => ({
			...timeQueries.loggingFor(projectId),
			enabled: open,
		})),
	});
	const optionsError =
		optionQueries.find((query) => query.isError)?.error ?? null;
	const shared = nativeSafeResult(
		sharedForResult(optionQueries.map((query) => query.data)),
		native,
	);
	const loadingOptions =
		open && projectIds.length > 0 && !shared && !optionsError;

	// One option and some rows aren't on it: preselect it (the Apply button
	// still asks). Several: the person picks; nothing is applied silently.
	useEffect(() => {
		if (!open || target || !shared || shared.options.length !== 1) return;
		setTarget(shared.options[0]);
	}, [open, shared, target]);

	// L58: an agreement covers only its own dates. Check each row's day.
	const datedKeys = useMemo(() => {
		if (!target || target.kind !== "assignment") return [];
		const seen = new Set<string>();
		const keys: { projectId: string; at: string }[] = [];
		for (const entry of rows) {
			if (!entry.project_id) continue;
			const pre = changeForRowState(entry, target, {
				timesheets,
				timeZone: tz,
				native,
			});
			if (pre.status !== "eligible" && pre.status !== "checking") continue;
			const key = `${entry.project_id}|${entry.started_at}`;
			if (seen.has(key)) continue;
			seen.add(key);
			keys.push({ projectId: entry.project_id, at: entry.started_at });
			if (keys.length >= MAX_DATED_CHECKS) break;
		}
		return keys;
	}, [rows, target, timesheets, tz, native]);

	const datedQueries = useQueries({
		queries: datedKeys.map(({ projectId, at }) => ({
			queryKey: [...timeKeys.loggingFor(projectId), "at", at] as const,
			queryFn: () => timeService.getLoggingFor(projectId, { at }),
			enabled: open,
			staleTime: TIME_STALE.loggingFor,
			retry: retryTimeQuery,
		})),
	});

	const datedState = new Map<string, { checking: boolean; covered: boolean }>();
	datedKeys.forEach(({ projectId, at }, index) => {
		const query = datedQueries[index];
		const covered =
			query?.data && target
				? query.data.options.some((option) => isSameFor(option, target))
				: true;
		datedState.set(`${projectId}|${at}`, {
			checking: Boolean(query?.isPending && query.fetchStatus !== "idle"),
			covered: query?.isError ? true : covered,
		});
	});

	const rowStates = rows.map((entry) => {
		const dated = datedState.get(`${entry.project_id}|${entry.started_at}`);
		return changeForRowState(entry, target, {
			timesheets,
			timeZone: tz,
			native,
			checking: dated?.checking ?? false,
			notCovered: dated ? !dated.covered : false,
		});
	});

	const pendingRows = rows.filter(
		(entry, index) =>
			rowStates[index].status === "eligible" &&
			results[entry.id]?.status !== "done",
	);
	const sendable = pendingRows.filter(
		(entry) => results[entry.id]?.status !== "failed",
	);
	const retryable = pendingRows.filter((entry) => {
		const result = results[entry.id];
		return result?.status === "failed" && result.retryable;
	});
	const checking = rowStates.some((state) => state.status === "checking");

	const outcome = (): ChangeForOutcome | null => {
		if (!target) return null;
		const changed: string[] = [];
		const failed: string[] = [];
		const skipped: string[] = [];
		rows.forEach((entry, index) => {
			const result = results[entry.id];
			if (result?.status === "done") changed.push(entry.id);
			else if (result?.status === "failed") failed.push(entry.id);
			else if (rowStates[index].status !== "eligible") skipped.push(entry.id);
		});
		return { target: toForRequest(target), changed, failed, skipped };
	};

	/** One row's PATCH; resolves with its weekly-limit warnings (A6). */
	const patchOne = async (
		entry: TimeEntryView,
		chosen: LoggingOption,
	): Promise<readonly EntryWarning[]> => {
		const body = { logging_for: toForRequest(chosen) };
		try {
			const updated = await timeService.updateEntry(entry.id, {
				...body,
				expected_updated_at: entry.updated_at,
			});
			return updated.warnings ?? [];
		} catch (err) {
			if (!isTimeApiError(err, "STALE_REVISION")) throw err;
			// The entry moved under us (a pause, another tab): re-read it and,
			// if it can still change, try once more on the fresh revision.
			const fresh = await timeService.getEntry(entry.id);
			const state = changeForRowState(fresh, chosen, {
				timesheets,
				timeZone: tz,
				native,
			});
			if (state.status === "same") return [];
			if (state.status === "blocked") {
				throw new RowRefusal(state.reason ?? "");
			}
			const retried = await timeService.updateEntry(fresh.id, {
				...body,
				expected_updated_at: fresh.updated_at,
			});
			return retried.warnings ?? [];
		}
	};

	const run = async (batch: TimeEntryView[]) => {
		if (!target || running || batch.length === 0) return;
		const chosen = target;
		setRunning(true);
		const next: Record<string, RowResult> = { ...results };
		const warnings: EntryWarning[] = [];
		for (const entry of batch) {
			next[entry.id] = { status: "working" };
			setResults({ ...next });
			try {
				warnings.push(...(await patchOne(entry, chosen)));
				next[entry.id] = { status: "done" };
			} catch (err) {
				next[entry.id] =
					err instanceof RowRefusal
						? { status: "failed", message: err.message, retryable: false }
						: {
								status: "failed",
								...changeForErrorCopy(err, chosen, { native }),
							};
			}
			setResults({ ...next });
		}
		setRunning(false);
		await invalidateTime(queryClient, "entry");
		// A move into a team, workspace or agreement past its weekly limit warns
		// (never blocks): once per sentence, however many rows crossed it.
		for (const text of entryWarningsCopy(warnings, {
			agreementLabel: chosen.kind === "assignment" ? chosen.label : null,
			native,
		})) {
			toast.warning(text);
		}
		const done = Object.values(next).filter((r) => r.status === "done").length;
		const failed = Object.values(next).some((r) => r.status === "failed");
		if (!failed) {
			if (done > 0) {
				toast.success(nativeSafe(changedToastText(done, chosen), { native }));
			}
			const summary = {
				target: toForRequest(chosen),
				changed: rows
					.filter((e) => next[e.id]?.status === "done")
					.map((e) => e.id),
				failed: [],
				skipped: rows.filter((e) => !next[e.id]).map((e) => e.id),
			};
			onDone?.(summary);
			onClose();
		}
	};

	const close = () => {
		if (running) return;
		if (hasResults) {
			const summary = outcome();
			if (summary) onDone?.(summary);
		}
		onClose();
	};

	const ratesNote = changeForRatesNote({ native });
	const canChange =
		Boolean(target) && !running && !checking && sendable.length > 0;

	let optionsBody: ReactNode;
	if (optionsError) {
		optionsBody = (
			<TimeReasonCard
				variant="inline"
				tone="danger"
				role="alert"
				title={
					timeErrorCopy(optionsError, {
						native,
						operation: "read",
						subject: "scope",
					}).message
				}
			/>
		);
	} else if (loadingOptions) {
		optionsBody = (
			<p className="flex items-center gap-2 text-xs text-muted-foreground">
				<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
				{CHANGE_FOR_COPY.loading}
			</p>
		);
	} else if (shared && shared.options.length === 0) {
		optionsBody = (
			<TimeReasonCard
				variant="inline"
				tone="neutral"
				title={
					projectIds.length > 1
						? CHANGE_FOR_COPY.noSharedOptions
						: CHANGE_FOR_COPY.noOptions
				}
			/>
		);
	} else if (shared) {
		optionsBody = (
			<ForPicker
				result={shared}
				value={target}
				onChange={(option) => {
					setTarget(option);
					setResults({});
				}}
				disabled={running}
				projectWorkspaceName={projectWorkspaceName}
			/>
		);
	} else {
		optionsBody = null;
	}

	return (
		<AppDialog
			open={open && rows.length > 0}
			onClose={close}
			busy={running}
			size="lg"
			zIndex={zIndex}
			title={CHANGE_FOR_COPY.title}
			description={selectedCountText(rows.length)}
			footer={
				<>
					<button
						type="button"
						onClick={close}
						disabled={running}
						className="rounded-lg border border-input px-3.5 py-2 text-xs font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
					>
						{hasResults ? CHANGE_FOR_COPY.close : CHANGE_FOR_COPY.cancel}
					</button>
					{hasResults && sendable.length === 0 ? (
						retryable.length > 0 ? (
							<button
								type="button"
								onClick={() => void run(retryable)}
								disabled={running}
								className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
							>
								{running ? (
									<Loader2
										className="h-3.5 w-3.5 animate-spin"
										aria-hidden="true"
									/>
								) : (
									<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
								)}
								{CHANGE_FOR_COPY.tryAgain}
							</button>
						) : null
					) : (
						<button
							type="button"
							onClick={() => void run(sendable)}
							disabled={!canChange}
							className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
						>
							{running ? (
								<Loader2
									className="h-3.5 w-3.5 animate-spin"
									aria-hidden="true"
								/>
							) : null}
							{changeButtonText(sendable.length)}
						</button>
					)}
				</>
			}
		>
			<div className="space-y-4">
				<section className="space-y-2">
					<h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						{CHANGE_FOR_COPY.forHeading}
					</h3>
					{optionsBody}
					{ratesNote && shared && shared.options.length > 0 ? (
						<p className="text-[11px] text-muted-foreground">{ratesNote}</p>
					) : null}
				</section>

				<section className="space-y-2">
					<h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						{CHANGE_FOR_COPY.entriesHeading}
					</h3>
					<ul className="divide-y divide-border rounded-lg border border-border">
						{rows.map((entry, index) => (
							<ChangeForRow
								key={entry.id}
								entry={entry}
								state={rowStates[index]}
								result={results[entry.id]}
								timeZone={tz}
								native={native}
							/>
						))}
					</ul>
				</section>
			</div>
		</AppDialog>
	);
}

function ChangeForRow({
	entry,
	state,
	result,
	timeZone,
	native,
}: {
	entry: TimeEntryView;
	state: ChangeForRowState;
	result: RowResult | undefined;
	timeZone: string;
	native: boolean;
}) {
	const option = forChipOptionFromEntry(entry);
	let Icon: LucideIcon | null = null;
	let iconClass = "text-muted-foreground";
	let line: string | null = state.reason;
	let lineClass = "text-muted-foreground";
	let spinning = false;

	if (result?.status === "working") {
		Icon = Loader2;
		spinning = true;
		line = null;
	} else if (result?.status === "done") {
		Icon = Check;
		iconClass = "text-success-foreground";
		line = CHANGE_FOR_COPY.changed;
		lineClass = "text-success-foreground";
	} else if (result?.status === "failed") {
		Icon = X;
		iconClass = "text-destructive";
		line = result.message;
		lineClass = "text-destructive";
	} else if (state.status === "checking") {
		Icon = Loader2;
		spinning = true;
		line = CHANGE_FOR_COPY.checking;
	} else if (state.status === "same") {
		Icon = Equal;
	} else if (state.status === "blocked") {
		Icon = entry.locked_reason ? Lock : Ban;
		lineClass = "text-warning-foreground";
	}

	return (
		<li
			className="flex items-start gap-3 px-3 py-2"
			data-row-status={result?.status ?? state.status}
			data-entry-id={entry.id}
		>
			<span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
				{Icon ? (
					<Icon
						className={`h-3.5 w-3.5 ${iconClass} ${spinning ? "animate-spin" : ""}`}
						aria-hidden="true"
					/>
				) : null}
			</span>
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
					<span className="min-w-0 truncate text-sm font-medium text-foreground">
						{entry.work_item !== "task" && !entry.task ? (
							<span aria-hidden="true" className="mr-1 text-muted-foreground">
								◦
							</span>
						) : null}
						{nativeSafe(entryWorkLabel(entry), { native })}
					</span>
					<ForChip
						option={{ ...option, label: nativeSafe(option.label, { native }) }}
						variant={entry.locked_reason ? "locked" : "readonly"}
					/>
				</div>
				<p className="text-xs tabular-nums text-muted-foreground">
					{entrySpanLine(entry, timeZone)}
				</p>
				{line ? <p className={`mt-0.5 text-xs ${lineClass}`}>{line}</p> : null}
			</div>
		</li>
	);
}
