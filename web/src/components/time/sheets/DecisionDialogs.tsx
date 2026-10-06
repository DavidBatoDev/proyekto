// web/src/components/time/sheets/DecisionDialogs.tsx
//
// The decision dialogs (ux.md › Approvals, Submit, Return, Reopen):
//
// | Dialog                   | Who                                  | Note                         | Button             |
// |--------------------------|--------------------------------------|------------------------------|--------------------|
// | ApproveSheetDialog       | Decider                              | Optional (+ overtime box)    | Approve            |
// | ReturnSheetDialog        | Decider                              | Required, "What should Maria change?" | Return to Maria |
// | ReopenSheetDialog        | Decider (→ Returned)                 | Required                     | Reopen             |
// |                          | Member, own auto/self sheet (→ Open) | Optional                     | Reopen             |
// | RequestReopenSheetDialog | Member, sheet approved by someone else | Optional, to the deciders  | Ask to reopen      |
// | ApproveSelectedDialog    | Decider, bulk (no overtime: over-limit rows can't be selected) | Optional | Approve |
//
// Every dialog runs through `useTimesheetActions` (toast, invalidation, copy)
// and keeps refusals inline: a stale revision shows the StaleRevisionBanner
// ("Maria changed this timesheet while you were looking. [Review the
// latest]"), a settled reopen shows the A12 copy with its web-only link.

import { Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { isNativeApp } from "@/lib/platform";
import {
	nativeSafe,
	nativeSafeHref,
	overLimitCopy,
	transitionReasonCopy,
} from "@/lib/timeErrors";
import {
	firstName,
	formatClock,
	formatPeriodRange,
	sheetScopeLabel,
} from "@/lib/timeFormat";
import type { TimesheetRow, TimesheetSummary } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import { StaleRevisionBanner } from "./StaleRevisionBanner";
import {
	type SheetActionFailure,
	type SheetActionOutcome,
	type SheetActionTarget,
	sheetPersonName,
	useTimesheetActions,
} from "./useTimesheetActions";

/** The longest note the API accepts. */
export const SHEET_NOTE_MAX = 2000;

const PRIMARY =
	"inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY =
	"rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50";

/** A sheet a decision dialog acts on (any summary, detail sheet or approval row). */
export type DecisionSheet = SheetActionTarget &
	Partial<Omit<TimesheetSummary, keyof SheetActionTarget>>;

export interface DecisionDialogBaseProps {
	open: boolean;
	onClose: () => void;
	sheet: DecisionSheet;
	/** Whose sheet ("Maria Santos"); defaults to the sheet's member name. */
	personName?: string | null;
	/** After the action succeeded (the dialog closes itself). */
	onDone?: (row: TimesheetRow | null) => void;
	/** "Review the latest" after a stale revision (refetch the sheet); the dialog closes. */
	onReviewLatest?: () => void;
	zIndex?: number;
	now?: Date;
	userTimezone?: string;
}

/** A settled reopen's web-only link (payout or invoice) → an href, or null for no link. */
export type SettledHrefResolver = (link: {
	kind: "payout" | "invoice";
	id: string;
}) => string | null;

// ── Shared pieces ───────────────────────────────────────────────────────────

function SheetSummaryLine({
	sheet,
	personName,
	now,
	userTimezone,
}: {
	sheet: DecisionSheet;
	personName: string | null;
	now?: Date;
	userTimezone?: string;
}) {
	const parts: string[] = [];
	if (personName) parts.push(personName);
	if (sheet.scope_kind && sheet.scope_label_snapshot) {
		parts.push(sheetScopeLabel(sheet.scope_kind, sheet.scope_label_snapshot));
	}
	if (sheet.period_start && sheet.period_end) {
		parts.push(
			formatPeriodRange(sheet.period_start, sheet.period_end, {
				timezone: sheet.timezone,
				now,
				userTimezone,
			}),
		);
	}
	const total = sheet.total_seconds ?? sheet.logged_seconds ?? null;
	if (parts.length === 0 && total === null) return null;
	return (
		<p className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-foreground">
			<span className="min-w-0">{nativeSafe(parts.join(" · "))}</span>
			{total !== null ? (
				<span className="shrink-0 font-semibold tabular-nums">
					{formatClock(total)}
				</span>
			) : null}
		</p>
	);
}

function NoteField({
	label,
	placeholder,
	value,
	onChange,
	required = false,
	error,
	disabled,
}: {
	label: string;
	placeholder?: string;
	value: string;
	onChange: (value: string) => void;
	required?: boolean;
	error?: string | null;
	disabled?: boolean;
}) {
	const id = useId();
	const errorId = useId();
	return (
		<div className="space-y-1">
			<label
				htmlFor={id}
				className="block text-xs font-semibold text-muted-foreground"
			>
				{label}
			</label>
			<textarea
				id={id}
				value={value}
				onChange={(e) => onChange(e.currentTarget.value)}
				placeholder={placeholder}
				required={required}
				aria-required={required || undefined}
				aria-invalid={error ? true : undefined}
				aria-describedby={error ? errorId : undefined}
				maxLength={SHEET_NOTE_MAX}
				rows={3}
				disabled={disabled}
				className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
			/>
			{error ? (
				<p id={errorId} role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : null}
		</div>
	);
}

/** A refusal, inline: stale → banner; settled → copy (+ web link); else the sentence. */
export function SheetFailureNotice({
	failure,
	onReviewLatest,
	settledHref,
}: {
	failure: SheetActionFailure | null;
	onReviewLatest?: () => void;
	settledHref?: SettledHrefResolver;
}) {
	if (!failure) return null;
	if (failure.kind === "stale") {
		return (
			<StaleRevisionBanner
				message={failure.message}
				onReviewLatest={onReviewLatest}
			/>
		);
	}
	if (failure.kind === "note") return null;
	const link =
		failure.kind === "settled" && failure.settled?.link && !isNativeApp()
			? nativeSafeHref(settledHref?.(failure.settled.link) ?? null)
			: null;
	return (
		<div
			role="alert"
			className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-foreground"
		>
			<p>{failure.message}</p>
			{link ? (
				<a
					href={link}
					className="inline-block text-xs font-semibold text-primary hover:underline"
				>
					{failure.settled?.link?.kind === "invoice"
						? "Open the invoice →"
						: "Open the payout →"}
				</a>
			) : null}
		</div>
	);
}

function DialogFooter({
	onClose,
	busy,
	confirm,
}: {
	onClose: () => void;
	busy: boolean;
	confirm: ReactNode;
}) {
	return (
		<>
			<button
				type="button"
				className={SECONDARY}
				onClick={onClose}
				disabled={busy}
			>
				Cancel
			</button>
			{confirm}
		</>
	);
}

function ConfirmButton({
	label,
	busy,
	disabled,
	onClick,
}: {
	label: string;
	busy: boolean;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className={PRIMARY}
			onClick={onClick}
			disabled={busy || disabled}
		>
			{busy ? (
				<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
			) : null}
			{label}
		</button>
	);
}

/** Note state that resets each time the dialog opens. */
function useDialogNote(open: boolean, clear: () => void) {
	const [note, setNote] = useState("");
	const [noteError, setNoteError] = useState<string | null>(null);
	useEffect(() => {
		if (!open) return;
		setNote("");
		setNoteError(null);
		clear();
	}, [open, clear]);
	return { note, setNote, noteError, setNoteError };
}

function finish(
	outcome: SheetActionOutcome,
	onDone: ((row: TimesheetRow | null) => void) | undefined,
	onClose: () => void,
) {
	if (!outcome.ok) return;
	onDone?.(outcome.rows[0] ?? null);
	onClose();
}

// ── Approve ─────────────────────────────────────────────────────────────────

export interface ApproveSheetDialogProps extends DecisionDialogBaseProps {
	/**
	 * A cap that cuts payable time is exceeded (L12): shows "Approve the 3h 30m
	 * over the limit" with its hint. Never for a policy limit (D65).
	 */
	overtime?: { overSeconds: number; payableSeconds: number } | null;
	/** The box's starting state (the review screen's panel may already be ticked). */
	defaultApproveOvertime?: boolean;
}

export function ApproveSheetDialog({
	open,
	onClose,
	sheet,
	personName: personNameProp,
	onDone,
	onReviewLatest,
	overtime,
	defaultApproveOvertime = false,
	zIndex,
	now,
	userTimezone,
}: ApproveSheetDialogProps) {
	const actions = useTimesheetActions();
	const { note, setNote } = useDialogNote(open, actions.clearFailure);
	const [approveOvertime, setApproveOvertime] = useState(
		defaultApproveOvertime,
	);
	useEffect(() => {
		if (open) setApproveOvertime(defaultApproveOvertime);
	}, [open, defaultApproveOvertime]);
	const busy = actions.isPending("approve", sheet.id);
	const personName = personNameProp ?? sheetPersonName(sheet);
	const over =
		overtime && overtime.overSeconds > 0 ? overLimitCopy(overtime) : null;

	const confirm = async () => {
		const outcome = await actions.approve(sheet, {
			note,
			approveOvertime: over ? approveOvertime : false,
		});
		finish(outcome, onDone, onClose);
	};

	return (
		<AppDialog
			open={open}
			onClose={onClose}
			busy={busy}
			zIndex={zIndex}
			title="Approve timesheet"
			footer={
				<DialogFooter
					onClose={onClose}
					busy={busy}
					confirm={
						<ConfirmButton
							label="Approve"
							busy={busy}
							onClick={() => void confirm()}
						/>
					}
				/>
			}
		>
			<div className="space-y-3">
				<SheetSummaryLine
					sheet={sheet}
					personName={personName}
					now={now}
					userTimezone={userTimezone}
				/>
				{over ? (
					<label className="flex cursor-pointer items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">
						<input
							type="checkbox"
							className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
							checked={approveOvertime}
							onChange={(e) => setApproveOvertime(e.currentTarget.checked)}
							disabled={busy}
						/>
						<span>
							<span className="block font-semibold">{over.checkbox}</span>
							<span className="block text-xs text-muted-foreground">
								{over.hint}
							</span>
						</span>
					</label>
				) : null}
				<NoteField
					label="Note (optional)"
					value={note}
					onChange={setNote}
					disabled={busy}
				/>
				<SheetFailureNotice
					failure={actions.failure}
					onReviewLatest={() => {
						actions.clearFailure();
						onReviewLatest?.();
						onClose();
					}}
				/>
			</div>
		</AppDialog>
	);
}

// ── Return ──────────────────────────────────────────────────────────────────

export function ReturnSheetDialog({
	open,
	onClose,
	sheet,
	personName: personNameProp,
	onDone,
	onReviewLatest,
	zIndex,
	now,
	userTimezone,
}: DecisionDialogBaseProps) {
	const actions = useTimesheetActions();
	const { note, setNote, noteError, setNoteError } = useDialogNote(
		open,
		actions.clearFailure,
	);
	const busy = actions.isPending("return", sheet.id);
	const personName = personNameProp ?? sheetPersonName(sheet);
	const first = firstName(personName);

	const confirm = async () => {
		if (!note.trim()) {
			setNoteError(transitionReasonCopy("note_required", { personName }));
			return;
		}
		setNoteError(null);
		const outcome = await actions.returnSheet(sheet, { note });
		finish(outcome, onDone, onClose);
	};

	const failure = actions.failure;
	return (
		<AppDialog
			open={open}
			onClose={onClose}
			busy={busy}
			zIndex={zIndex}
			title="Return timesheet"
			footer={
				<DialogFooter
					onClose={onClose}
					busy={busy}
					confirm={
						<ConfirmButton
							label={first ? `Return to ${first}` : "Return"}
							busy={busy}
							onClick={() => void confirm()}
						/>
					}
				/>
			}
		>
			<div className="space-y-3">
				<SheetSummaryLine
					sheet={sheet}
					personName={personName}
					now={now}
					userTimezone={userTimezone}
				/>
				<NoteField
					label={first ? `Note for ${first}` : "Note"}
					placeholder={
						first ? `What should ${first} change?` : "What should change?"
					}
					value={note}
					onChange={(value) => {
						setNote(value);
						if (noteError && value.trim()) setNoteError(null);
					}}
					required
					error={
						noteError ?? (failure?.kind === "note" ? failure.message : null)
					}
					disabled={busy}
				/>
				<SheetFailureNotice
					failure={failure}
					onReviewLatest={() => {
						actions.clearFailure();
						onReviewLatest?.();
						onClose();
					}}
				/>
			</div>
		</AppDialog>
	);
}

// ── Reopen ──────────────────────────────────────────────────────────────────

export interface ReopenSheetDialogProps extends DecisionDialogBaseProps {
	/**
	 * The member reopening their own auto/self sheet (→ Open, note optional).
	 * Defaults to "the viewer is the sheet's member"; otherwise a decider
	 * reopen (→ Returned, note required).
	 */
	asMember?: boolean;
	/** Where a settled refusal's payout or invoice lives (web only). */
	settledHref?: SettledHrefResolver;
}

export function ReopenSheetDialog({
	open,
	onClose,
	sheet,
	personName: personNameProp,
	onDone,
	onReviewLatest,
	asMember: asMemberProp,
	settledHref,
	zIndex,
	now,
	userTimezone,
}: ReopenSheetDialogProps) {
	const actions = useTimesheetActions();
	const viewerId = useAuthStore((state) => state.user?.id ?? null);
	const asMember =
		asMemberProp ??
		(viewerId != null &&
			sheet.member_user_id != null &&
			sheet.member_user_id === viewerId);
	const { note, setNote, noteError, setNoteError } = useDialogNote(
		open,
		actions.clearFailure,
	);
	const busy = actions.isPending("reopen", sheet.id);
	const personName = asMember
		? null
		: (personNameProp ?? sheetPersonName(sheet));
	const first = firstName(personName);

	const confirm = async () => {
		if (!asMember && !note.trim()) {
			setNoteError(transitionReasonCopy("note_required", { personName }));
			return;
		}
		setNoteError(null);
		const outcome = await actions.reopen(sheet, { note });
		finish(outcome, onDone, onClose);
	};

	return (
		<AppDialog
			open={open}
			onClose={onClose}
			busy={busy}
			zIndex={zIndex}
			title="Reopen timesheet"
			footer={
				<DialogFooter
					onClose={onClose}
					busy={busy}
					confirm={
						<ConfirmButton
							label="Reopen"
							busy={busy}
							onClick={() => void confirm()}
						/>
					}
				/>
			}
		>
			<div className="space-y-3">
				<SheetSummaryLine
					sheet={sheet}
					personName={asMember ? null : personName}
					now={now}
					userTimezone={userTimezone}
				/>
				<p className="text-sm text-muted-foreground">
					{asMember
						? "It goes back to Open so you can change it."
						: `It goes back to ${first ?? "them"} as Returned, with your note.`}
				</p>
				<NoteField
					label={
						asMember ? "Note (optional)" : first ? `Note for ${first}` : "Note"
					}
					placeholder={
						asMember
							? undefined
							: first
								? `What should ${first} change?`
								: "What should change?"
					}
					value={note}
					onChange={(value) => {
						setNote(value);
						if (noteError && value.trim()) setNoteError(null);
					}}
					required={!asMember}
					error={noteError}
					disabled={busy}
				/>
				<SheetFailureNotice
					failure={actions.failure}
					settledHref={settledHref}
					onReviewLatest={() => {
						actions.clearFailure();
						onReviewLatest?.();
						onClose();
					}}
				/>
			</div>
		</AppDialog>
	);
}

// ── Ask to reopen ───────────────────────────────────────────────────────────

export function RequestReopenSheetDialog({
	open,
	onClose,
	sheet,
	onDone,
	onReviewLatest,
	zIndex,
	now,
	userTimezone,
}: DecisionDialogBaseProps) {
	const actions = useTimesheetActions();
	const { note, setNote } = useDialogNote(open, actions.clearFailure);
	const busy = actions.isPending("request_reopen", sheet.id);

	const confirm = async () => {
		const outcome = await actions.requestReopen(sheet, { note });
		finish(outcome, onDone, onClose);
	};

	return (
		<AppDialog
			open={open}
			onClose={onClose}
			busy={busy}
			zIndex={zIndex}
			title="Ask to reopen"
			footer={
				<DialogFooter
					onClose={onClose}
					busy={busy}
					confirm={
						<ConfirmButton
							label="Ask to reopen"
							busy={busy}
							onClick={() => void confirm()}
						/>
					}
				/>
			}
		>
			<div className="space-y-3">
				<SheetSummaryLine
					sheet={sheet}
					personName={null}
					now={now}
					userTimezone={userTimezone}
				/>
				<p className="text-sm text-muted-foreground">
					The approvers get your note and can reopen it.
				</p>
				<NoteField
					label="Note for the approvers"
					placeholder="What needs to change?"
					value={note}
					onChange={setNote}
					disabled={busy}
				/>
				<SheetFailureNotice
					failure={actions.failure}
					onReviewLatest={() => {
						actions.clearFailure();
						onReviewLatest?.();
						onClose();
					}}
				/>
			</div>
		</AppDialog>
	);
}

// ── Bulk approve ────────────────────────────────────────────────────────────

export interface ApproveSelectedDialogProps {
	open: boolean;
	onClose: () => void;
	/** How many sheets are selected. */
	count: number;
	busy?: boolean;
	/** Runs the bulk approve (the list keeps the result: success toast or the A10 banner). */
	onConfirm: (note: string) => void;
	zIndex?: number;
}

/** "Approve 3 timesheets" with an optional note. The caller runs the approve. */
export function ApproveSelectedDialog({
	open,
	onClose,
	count,
	busy = false,
	onConfirm,
	zIndex,
}: ApproveSelectedDialogProps) {
	const [note, setNote] = useState("");
	useEffect(() => {
		if (open) setNote("");
	}, [open]);
	return (
		<AppDialog
			open={open}
			onClose={onClose}
			busy={busy}
			zIndex={zIndex}
			title={
				count === 1 ? "Approve 1 timesheet" : `Approve ${count} timesheets`
			}
			footer={
				<DialogFooter
					onClose={onClose}
					busy={busy}
					confirm={
						<ConfirmButton
							label="Approve"
							busy={busy}
							disabled={count === 0}
							onClick={() => onConfirm(note)}
						/>
					}
				/>
			}
		>
			<div className="space-y-3">
				<p className="text-sm text-muted-foreground">
					All of them are approved together, or none are if one has changed.
				</p>
				<NoteField
					label="Note (optional)"
					value={note}
					onChange={setNote}
					disabled={busy}
				/>
			</div>
		</AppDialog>
	);
}

// ── One entry point ─────────────────────────────────────────────────────────

export type DecisionDialogKind =
	| "approve"
	| "return"
	| "reopen"
	| "request_reopen";

export type DecisionDialogProps = DecisionDialogBaseProps & {
	kind: DecisionDialogKind;
} & Pick<ApproveSheetDialogProps, "overtime" | "defaultApproveOvertime"> &
	Pick<ReopenSheetDialogProps, "asMember" | "settledHref">;

/** The dialog for `kind` (the review screen's buttons map one-to-one). */
export function DecisionDialog({
	kind,
	overtime,
	defaultApproveOvertime,
	asMember,
	settledHref,
	...base
}: DecisionDialogProps) {
	switch (kind) {
		case "approve":
			return (
				<ApproveSheetDialog
					{...base}
					overtime={overtime}
					defaultApproveOvertime={defaultApproveOvertime}
				/>
			);
		case "return":
			return <ReturnSheetDialog {...base} />;
		case "reopen":
			return (
				<ReopenSheetDialog
					{...base}
					asMember={asMember}
					settledHref={settledHref}
				/>
			);
		case "request_reopen":
			return <RequestReopenSheetDialog {...base} />;
		default:
			return null;
	}
}
