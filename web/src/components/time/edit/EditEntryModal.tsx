// web/src/components/time/edit/EditEntryModal.tsx
//
// Edit one of your own time entries: start, end, break and note (ux.md ›
// The Time Page; ported from TeamTimeModals' EditLogModal).
//
// - Times are shown and typed in `timeZone` (the view's timezone, which is the
//   context's or the person's own), never the device's by accident.
// - Only the fields that changed are sent, always with `expected_updated_at`
//   (D42). A 409 STALE_REVISION reads "This entry changed. Reload to see the
//   latest version." with a Reload that re-reads the entry and resets the form.
// - A running timer keeps an empty end ("still running"); setting one stops it
//   (the server folds an open break). Its break is managed by Pause/Resume, so
//   the break field is not shown.
// - Locked entries (paid, billed, legacy, approved or on a submitted or
//   approved timesheet) open read-only with the reason.
// - PATCH can answer `warnings` (A6: POLICY_WEEKLY_LIMIT, CONTRACT_WEEKLY_LIMIT)
//   which are shown like create's: one warning toast each.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { Loader2, Save, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { DateTimeField } from "@/components/common/DateTimeField";
import { ForChip } from "@/components/time/for/ForChip";
import { entryWorkLabel } from "@/components/time/for/forCopy";
import { forChipOptionFromEntry } from "@/components/time/for/forOptions";
import { TimeReasonCard } from "@/components/time/shared/TimeReasonCard";
import { useToast } from "@/hooks/useToast";
import { isNativeApp } from "@/lib/platform";
import {
	entryWarningsCopy,
	lockedChipCopy,
	nativeSafe,
	retroactiveWindowCopy,
	staleRevisionCopy,
	timeErrorCopy,
} from "@/lib/timeErrors";
import {
	deviceTimeZone,
	formatDurationText,
	formatInstantDay,
} from "@/lib/timeFormat";
import { retroactiveFloor, safeTimezone } from "@/lib/timePeriods";
import { invalidateTime, timeKeys, timeQueries } from "@/queries/time";
import { isTimeApiError, timeService } from "@/services/time.service";
import type {
	TimeEntryView,
	UpdatedEntry,
	UpdateEntryInput,
} from "@/services/time.types";

// ── Copy ────────────────────────────────────────────────────────────────────

export const EDIT_ENTRY_COPY = {
	title: "Edit time entry",
	description: "Change when this time started and ended, its break and note.",
	start: "Start",
	end: "End",
	breakMinutes: "Break (minutes)",
	note: "Note",
	notePlaceholder: "What did you work on?",
	runningEndHint: "Leave the end empty to keep the timer running.",
	runningEndStops: "Saving an end time stops the timer.",
	save: "Save changes",
	cancel: "Cancel",
	close: "Close",
	changeFor: "Change For…",
	forLabel: "For",
	saved: "Time entry updated.",
	startRequired: "Pick a start time.",
	endRequired: "Pick an end time.",
	rangeInvalid: "The end time must be after the start time.",
	breakTooLong:
		"The break is as long as the whole block — there would be no time left to log.",
	breakInvalid: "Enter the break in whole minutes.",
	noteTooLong: "Keep the note under 2,000 characters.",
} as const;

export const NOTE_MAX_LENGTH = 2000;

/** "Times are in Asia/Manila." when the view's zone isn't the device's. */
export function timeZoneHint(timeZone: string, device = deviceTimeZone()) {
	return timeZone === device ? null : `Times are in ${timeZone}.`;
}

/**
 * Why an entry can't change, in the backend's lock order (paid → billed →
 * legacy → frozen → sheet status). Null when it can. Native-safe: "already
 * paid" / "already being billed" (ux.md › Copy).
 */
export function entryLockCopy(
	entry: Pick<
		TimeEntryView,
		"locked_reason" | "legacy_status" | "timesheet"
	> | null,
	options: { timeZone?: string; native?: boolean } = {},
): string | null {
	if (!entry?.locked_reason) return null;
	const native = options.native ?? isNativeApp();
	const tz = options.timeZone ?? deviceTimeZone();
	let text: string;
	switch (entry.locked_reason) {
		case "paid":
			text =
				entry.legacy_status === "paid_outside"
					? "Paid outside Proyekto, so it can't change."
					: "This time has already been paid, so it can't change.";
			break;
		case "billed":
			text = "This time is already being billed, so it can't change.";
			break;
		case "legacy":
			text = "Not approved (legacy), so it can't change.";
			break;
		case "frozen":
			text = "This time is approved, so it can't change.";
			break;
		case "sheet_submitted":
			text = lockedChipCopy("submitted", null);
			break;
		case "sheet_approved": {
			const decided = entry.timesheet?.decided_at;
			text = lockedChipCopy(
				"approved",
				decided ? formatInstantDay(decided, tz) : null,
			);
			break;
		}
		default:
			text = "This entry is on a submitted or approved timesheet.";
	}
	return nativeSafe(text, { native });
}

// ── Wall clock ↔ instant ────────────────────────────────────────────────────

const WALL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** An instant as the `yyyy-MM-ddTHH:mm` wall clock of `timeZone` ("" when unreadable). */
export function toWallClock(
	iso: string | null | undefined,
	timeZone: string,
): string {
	if (!iso) return "";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return formatInTimeZone(date, safeTimezone(timeZone), "yyyy-MM-dd'T'HH:mm");
}

/** A `yyyy-MM-ddTHH:mm` wall clock of `timeZone` as a UTC ISO instant (null when unreadable). */
export function fromWallClock(
	wall: string | null | undefined,
	timeZone: string,
): string | null {
	if (!wall || !WALL_RE.test(wall)) return null;
	const date = fromZonedTime(`${wall}:00`, safeTimezone(timeZone));
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ── Draft ───────────────────────────────────────────────────────────────────

export interface EditEntryDraft {
	/** `yyyy-MM-ddTHH:mm` in the modal's timezone. */
	start: string;
	/** "" keeps a running timer running. */
	end: string;
	/** The break input as typed (whole minutes). */
	breakMinutes: string;
	note: string;
}

export function draftFromEntry(
	entry: Pick<
		TimeEntryView,
		"started_at" | "ended_at" | "break_seconds" | "note"
	>,
	timeZone: string,
): EditEntryDraft {
	return {
		start: toWallClock(entry.started_at, timeZone),
		end: toWallClock(entry.ended_at, timeZone),
		breakMinutes: String(
			Math.round(Math.max(0, entry.break_seconds ?? 0) / 60),
		),
		note: entry.note ?? "",
	};
}

export interface DraftCheck {
	/** The instants the entry would have (an untouched field keeps its exact stored value). */
	startIso: string | null;
	endIso: string | null;
	breakSeconds: number;
	/** Gross (end − start) and net (− break) seconds; null without both ends. */
	grossSeconds: number | null;
	netSeconds: number | null;
	error: string | null;
}

function breakSecondsOf(text: string): number | null {
	const trimmed = text.trim();
	if (trimmed === "") return 0;
	if (!/^\d+$/.test(trimmed)) return null;
	return Number(trimmed) * 60;
}

/** Validates a draft against the entry it edits. */
export function checkDraft(
	entry: Pick<
		TimeEntryView,
		"started_at" | "ended_at" | "break_seconds" | "note"
	>,
	draft: EditEntryDraft,
	timeZone: string,
): DraftCheck {
	const initial = draftFromEntry(entry, timeZone);
	const running = !entry.ended_at;
	const startIso =
		draft.start === initial.start
			? entry.started_at
			: fromWallClock(draft.start, timeZone);
	const endIso =
		draft.end === initial.end
			? entry.ended_at
			: draft.end
				? fromWallClock(draft.end, timeZone)
				: null;
	const parsedBreak = running
		? Math.max(0, entry.break_seconds ?? 0)
		: breakSecondsOf(draft.breakMinutes);
	const breakSeconds = parsedBreak ?? 0;
	const startMs = startIso ? Date.parse(startIso) : Number.NaN;
	const endMs = endIso ? Date.parse(endIso) : Number.NaN;
	const both = Number.isFinite(startMs) && Number.isFinite(endMs);
	const grossSeconds = both ? Math.floor((endMs - startMs) / 1000) : null;
	const netSeconds =
		grossSeconds !== null ? Math.max(0, grossSeconds - breakSeconds) : null;

	let error: string | null = null;
	if (!startIso) error = EDIT_ENTRY_COPY.startRequired;
	else if (!endIso && (!running || draft.end !== "")) {
		error = EDIT_ENTRY_COPY.endRequired;
	} else if (grossSeconds !== null && grossSeconds <= 0) {
		error = EDIT_ENTRY_COPY.rangeInvalid;
	} else if (parsedBreak === null) {
		error = EDIT_ENTRY_COPY.breakInvalid;
	} else if (
		!running &&
		grossSeconds !== null &&
		breakSeconds > 0 &&
		breakSeconds >= grossSeconds
	) {
		error = EDIT_ENTRY_COPY.breakTooLong;
	} else if (draft.note.length > NOTE_MAX_LENGTH) {
		error = EDIT_ENTRY_COPY.noteTooLong;
	}
	return { startIso, endIso, breakSeconds, grossSeconds, netSeconds, error };
}

/**
 * The PATCH body for a draft: only what changed, plus `expected_updated_at`
 * (D42). Null when nothing changed or the draft is invalid.
 */
export function buildEntryPatch(
	entry: Pick<
		TimeEntryView,
		"started_at" | "ended_at" | "break_seconds" | "note" | "updated_at"
	>,
	draft: EditEntryDraft,
	timeZone: string,
): UpdateEntryInput | null {
	const check = checkDraft(entry, draft, timeZone);
	if (check.error) return null;
	const initial = draftFromEntry(entry, timeZone);
	const patch: UpdateEntryInput = { expected_updated_at: entry.updated_at };
	let changed = false;
	if (draft.start !== initial.start && check.startIso) {
		patch.started_at = check.startIso;
		changed = true;
	}
	if (draft.end !== initial.end && check.endIso) {
		patch.ended_at = check.endIso;
		changed = true;
	}
	if (
		entry.ended_at &&
		check.breakSeconds !== Math.max(0, entry.break_seconds ?? 0) &&
		draft.breakMinutes !== initial.breakMinutes
	) {
		patch.break_seconds = check.breakSeconds;
		changed = true;
	}
	const note = draft.note.trim();
	if (note !== (entry.note ?? "").trim()) {
		patch.note = note === "" ? null : note;
		changed = true;
	}
	return changed ? patch : null;
}

/** "1h 30m minus 15m break = 1h 15m logged". */
export function durationPreview(check: DraftCheck): string | null {
	if (check.error || check.grossSeconds === null || check.netSeconds === null) {
		return null;
	}
	const gross = formatDurationText(check.grossSeconds);
	const net = formatDurationText(check.netSeconds);
	return check.breakSeconds > 0
		? `${gross} minus ${formatDurationText(check.breakSeconds)} break = ${net} logged`
		: `${net} logged`;
}

// ── Component ───────────────────────────────────────────────────────────────

export interface EditEntryModalProps {
	open: boolean;
	/** The entry as the list shows it; its `updated_at` is the revision sent back. */
	entry: TimeEntryView | null;
	onClose: () => void;
	/** The timezone times are shown and typed in (the view's). Defaults to the device's. */
	timeZone?: string;
	/** After a successful save, with the server's copy (and any warnings). */
	onSaved?: (entry: UpdatedEntry) => void;
	/** Shows "Change For…" beside the For chip (unlocked entries). */
	onChangeFor?: (entry: TimeEntryView) => void;
	/** AppDialog z-index; nested dialogs step up by 10 (1210 over a day dialog). */
	zIndex?: number;
}

const inputClass =
	"w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-60";
const labelClass =
	"block text-xs font-semibold uppercase tracking-wide text-muted-foreground";

export function EditEntryModal({
	open,
	entry,
	onClose,
	timeZone,
	onSaved,
	onChangeFor,
	zIndex = 1200,
}: EditEntryModalProps) {
	const tz = useMemo(
		() => safeTimezone(timeZone ?? deviceTimeZone()),
		[timeZone],
	);
	const queryClient = useQueryClient();
	const toast = useToast();
	const native = isNativeApp();

	// The copy being edited: the caller's, or a fresh read after a stale save.
	const [base, setBase] = useState<TimeEntryView | null>(entry);
	const [draft, setDraft] = useState<EditEntryDraft | null>(() =>
		entry ? draftFromEntry(entry, tz) : null,
	);
	const [saving, setSaving] = useState(false);
	const [reloading, setReloading] = useState(false);
	const [error, setError] = useState<{
		message: string;
		stale: boolean;
	} | null>(null);

	// Reset when the dialog opens or another entry is put in it. A refreshed
	// copy of the same entry (a poll) never wipes what is being typed: the save
	// is checked against the revision that was opened (D42).
	const entryId = entry?.id ?? "";
	useEffect(() => {
		if (!open) return;
		setBase(entry);
		setDraft(entry ? draftFromEntry(entry, tz) : null);
		setError(null);
		setSaving(false);
		setReloading(false);
	}, [open, entryId, tz]);

	const policyQuery = useQuery({
		...timeQueries.projectPolicy(
			base?.project_id,
			base
				? {
						kind: base.context_kind,
						id: base.context_kind === "personal" ? null : base.context_ref,
					}
				: null,
		),
		enabled: Boolean(open && base?.project_id && !base?.locked_reason),
		retry: false,
	});

	const lockText = entryLockCopy(base, { timeZone: tz, native });
	const locked = Boolean(lockText);
	const running = Boolean(base && !base.ended_at);
	const check = base && draft ? checkDraft(base, draft, tz) : null;
	const patch = base && draft ? buildEntryPatch(base, draft, tz) : null;
	const preview = check ? durationPreview(check) : null;
	const busy = saving || reloading;

	// Retroactive window (the entry's own policy): a floor for the start field
	// and the ux.md hint, when the policy is readable and the entry isn't
	// already older than it.
	const policy = policyQuery.data ?? null;
	const floorDate = policy
		? retroactiveFloor(new Date(), policy.timezone, policy.retroactive_days)
		: null;
	const floorIso = floorDate
		? fromWallClock(`${floorDate}T00:00`, policy?.timezone ?? tz)
		: null;
	const startMin =
		floorIso && base && Date.parse(base.started_at) >= Date.parse(floorIso)
			? toWallClock(floorIso, tz)
			: undefined;
	const retroHint =
		policy && floorDate
			? nativeSafe(
					retroactiveWindowCopy({
						label:
							base?.context_kind === "personal"
								? null
								: base?.context_label_snapshot,
						labelKind: base?.context_kind,
						days: policy.retroactive_days,
					}),
					{ native },
				)
			: null;

	const errorContext = base
		? {
				label:
					base.timesheet?.scope_label_snapshot ??
					base.context_label_snapshot ??
					null,
				labelKind: base.context_kind,
				subject: "entry" as const,
				operation: "write" as const,
				retroactiveDays: policy?.retroactive_days ?? null,
				userTimezone: tz,
			}
		: {};

	const reload = async () => {
		if (!base) return;
		setReloading(true);
		try {
			const fresh = await queryClient.fetchQuery({
				...timeQueries.entry(base.id),
				staleTime: 0,
			});
			setBase(fresh);
			setDraft(draftFromEntry(fresh, tz));
			setError(null);
			void invalidateTime(queryClient, "entry");
		} catch (err) {
			setError({
				message: timeErrorCopy(err, { ...errorContext, operation: "read" })
					.message,
				stale: false,
			});
		} finally {
			setReloading(false);
		}
	};

	const save = async () => {
		if (!base || !patch || busy || locked) return;
		setSaving(true);
		setError(null);
		try {
			const updated = await timeService.updateEntry(base.id, patch);
			const { warnings, ...view } = updated;
			queryClient.setQueryData(timeKeys.entry(base.id), view as TimeEntryView);
			void invalidateTime(queryClient, "entry");
			toast.success(EDIT_ENTRY_COPY.saved);
			const agreementLabel =
				view.context_kind === "assignment" ? view.context_label_snapshot : null;
			for (const text of entryWarningsCopy(warnings, {
				agreementLabel,
				native,
			})) {
				toast.warning(text);
			}
			onSaved?.(updated);
			onClose();
		} catch (err) {
			const stale = isTimeApiError(err, "STALE_REVISION");
			setError({
				message: stale
					? nativeSafe(staleRevisionCopy({ subject: "entry" }).message, {
							native,
						})
					: timeErrorCopy(err, errorContext).message,
				stale,
			});
			if (isTimeApiError(err, "TIMESHEET_LOCKED")) {
				void invalidateTime(queryClient, "entry");
			}
		} finally {
			setSaving(false);
		}
	};

	const set = (patchDraft: Partial<EditEntryDraft>) =>
		setDraft((current) => (current ? { ...current, ...patchDraft } : current));

	const hint = timeZoneHint(tz);
	const option = base ? forChipOptionFromEntry(base) : null;

	return (
		<AppDialog
			open={open && Boolean(base)}
			onClose={onClose}
			busy={busy}
			size="md"
			zIndex={zIndex}
			title={EDIT_ENTRY_COPY.title}
			description={locked ? undefined : EDIT_ENTRY_COPY.description}
			footer={
				locked ? (
					<button
						type="button"
						onClick={onClose}
						className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3.5 py-2 text-xs font-semibold text-foreground transition hover:bg-muted"
					>
						{EDIT_ENTRY_COPY.close}
					</button>
				) : (
					<>
						<button
							type="button"
							onClick={onClose}
							disabled={busy}
							className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3.5 py-2 text-xs font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
						>
							<XCircle className="h-3.5 w-3.5" aria-hidden="true" />
							{EDIT_ENTRY_COPY.cancel}
						</button>
						<button
							type="button"
							onClick={() => void save()}
							disabled={!patch || busy}
							className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
						>
							{saving ? (
								<Loader2
									className="h-3.5 w-3.5 animate-spin"
									aria-hidden="true"
								/>
							) : (
								<Save className="h-3.5 w-3.5" aria-hidden="true" />
							)}
							{EDIT_ENTRY_COPY.save}
						</button>
					</>
				)
			}
		>
			{base && draft ? (
				<div className="space-y-4">
					<div className="min-w-0 space-y-1.5">
						<p className="truncate text-sm font-semibold text-foreground">
							{base.work_item !== "task" && !base.task ? (
								<span aria-hidden="true" className="mr-1 text-muted-foreground">
									◦
								</span>
							) : null}
							{nativeSafe(entryWorkLabel(base), { native })}
							{base.project?.title ? (
								<span className="font-normal text-muted-foreground">
									{" · "}
									{nativeSafe(base.project.title, { native })}
								</span>
							) : null}
						</p>
						{option ? (
							<div className="flex flex-wrap items-center gap-2">
								<span className="text-xs text-muted-foreground">
									{EDIT_ENTRY_COPY.forLabel}:
								</span>
								<ForChip
									option={{
										...option,
										label: nativeSafe(option.label, { native }),
									}}
									variant={locked ? "locked" : "readonly"}
									lockedText={lockText}
								/>
								{!locked && onChangeFor ? (
									<button
										type="button"
										onClick={() => onChangeFor(base)}
										disabled={busy}
										className="text-xs font-semibold text-primary hover:underline disabled:opacity-50"
									>
										{EDIT_ENTRY_COPY.changeFor}
									</button>
								) : null}
							</div>
						) : null}
					</div>

					{lockText ? (
						<TimeReasonCard variant="inline" tone="warning" title={lockText} />
					) : null}

					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<DateTimeField
							label={EDIT_ENTRY_COPY.start}
							ariaLabel={EDIT_ENTRY_COPY.start}
							value={draft.start}
							min={startMin}
							onChange={(value) => set({ start: value })}
							disabled={busy || locked}
							zIndex={zIndex + 100}
						/>
						<div className="space-y-1">
							<DateTimeField
								label={EDIT_ENTRY_COPY.end}
								ariaLabel={EDIT_ENTRY_COPY.end}
								value={draft.end}
								min={draft.start || undefined}
								onChange={(value) => set({ end: value })}
								disabled={busy || locked}
								zIndex={zIndex + 100}
							/>
							{running && !locked ? (
								<p className="text-[11px] text-muted-foreground">
									{draft.end
										? EDIT_ENTRY_COPY.runningEndStops
										: EDIT_ENTRY_COPY.runningEndHint}
								</p>
							) : null}
						</div>
					</div>

					{running ? null : (
						<label className="block space-y-1.5">
							<span className={labelClass}>{EDIT_ENTRY_COPY.breakMinutes}</span>
							<input
								type="number"
								inputMode="numeric"
								min={0}
								step={1}
								value={draft.breakMinutes}
								onChange={(e) => set({ breakMinutes: e.target.value })}
								disabled={busy || locked}
								placeholder="0"
								className={inputClass}
							/>
						</label>
					)}

					<label className="block space-y-1.5">
						<span className={labelClass}>{EDIT_ENTRY_COPY.note}</span>
						<textarea
							value={draft.note}
							onChange={(e) => set({ note: e.target.value })}
							disabled={busy || locked}
							rows={2}
							maxLength={NOTE_MAX_LENGTH + 1}
							placeholder={EDIT_ENTRY_COPY.notePlaceholder}
							className={`${inputClass} resize-y`}
						/>
					</label>

					{preview && !locked ? (
						<div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
							{preview}
						</div>
					) : null}

					{check?.error && !locked && draftTouched(base, draft, tz) ? (
						<p className="text-xs text-destructive" role="alert">
							{check.error}
						</p>
					) : null}

					{!locked && (hint || retroHint) ? (
						<div className="space-y-0.5 text-[11px] text-muted-foreground">
							{retroHint ? <p>{retroHint}</p> : null}
							{hint ? <p>{hint}</p> : null}
						</div>
					) : null}

					{error ? (
						<TimeReasonCard
							variant="inline"
							tone={error.stale ? "info" : "danger"}
							role="alert"
							title={error.message}
							action={
								error.stale ? (
									<button
										type="button"
										onClick={() => void reload()}
										disabled={reloading}
										className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
									>
										{reloading ? (
											<Loader2
												className="h-3.5 w-3.5 animate-spin"
												aria-hidden="true"
											/>
										) : null}
										{staleRevisionCopy({ subject: "entry" }).actionLabel}
									</button>
								) : undefined
							}
						/>
					) : null}
				</div>
			) : null}
		</AppDialog>
	);
}

/** True once any field differs from the entry (validation errors show only then). */
function draftTouched(
	entry: Pick<
		TimeEntryView,
		"started_at" | "ended_at" | "break_seconds" | "note"
	>,
	draft: EditEntryDraft,
	timeZone: string,
): boolean {
	const initial = draftFromEntry(entry, timeZone);
	return (
		draft.start !== initial.start ||
		draft.end !== initial.end ||
		draft.breakMinutes !== initial.breakMinutes ||
		draft.note !== initial.note
	);
}
