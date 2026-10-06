// web/src/components/time/entries/TimeEntryDetailModal.tsx
//
// One time entry as a dialog over the list it was opened from (ux.md › Entry
// detail; `/time?entry=<id>`). Ported from `team-time/TimeLogDetailModal`
// without its team dependency: the entry carries its own For, sheet and
// classes (D32), so any entry the viewer can see opens here, deciders
// included (D82).
//
// - The work and break timeline (timer entries).
// - The comment thread. Comments never unlock anything.
// - The legacy markers ("Paid outside Proyekto", "Not approved (legacy)")
//   show here only (L56).
// - Hidden content reads "A project you can't open" with the work-item kind;
//   a masked person reads "Delivery team" (and "Delivery team member" on
//   their comments).
// - A miss is a 404 card: "This time entry doesn't exist or you can't open it."
//
// Edit and Delete are the caller's (W1-3 dialogs); they show only for the
// viewer's own unlocked entry when a handler is passed.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	AlertTriangle,
	Coffee,
	Loader2,
	Lock,
	MessageSquare,
	Pencil,
	Timer,
	Trash2,
} from "lucide-react";
import {
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { useToast } from "@/hooks/useToast";
import { isNativeApp } from "@/lib/platform";
import { timeErrorCopy, timeErrorMessage } from "@/lib/timeErrors";
import {
	canShowAmounts,
	deviceTimeZone,
	formatClock,
	formatDurationText,
	formatInstantDateTime,
	formatInstantDay,
	formatInstantTime,
	formatMoneyLine,
	workItemLabel,
} from "@/lib/timeFormat";
import { localDate, safeTimezone } from "@/lib/timePeriods";
import { isUuid } from "@/lib/timeSearch";
import { cn } from "@/lib/utils";
import { invalidateTime, timeQueries } from "@/queries/time";
import { TimeApiError, timeService } from "@/services/time.service";
import type {
	CommentRow,
	SegmentRow,
	TimeEntryView,
} from "@/services/time.types";
import { useUser } from "@/stores/authStore";
import { ForChip } from "../for/ForChip";
import { forChipOptionFromEntry } from "../for/forOptions";
import { TimeReasonCard } from "../shared/TimeReasonCard";
import { useLiveNowMs } from "../timer/liveDuration";
import { AmountLines } from "./AmountLines";
import { EntryBadges } from "./EntryBadges";
import {
	amountRecord,
	ENTRY_COPY,
	type EntriesTableMode,
	type EntrySheetInfo,
	entryAmount,
	entryBreakSeconds,
	entryLockCopy,
	entryMemberLabel,
	entrySheetLine,
	entryTitle,
	entryWorkSeconds,
	isEntryLocked,
	isHiddenContent,
	isOnBreak,
	needsReviewCopy,
	sheetStatusWord,
} from "./entryRules";

/** The comment DTO's limit (`CreateCommentDto.body`). */
export const COMMENT_MAX_LENGTH = 4000;

/** AppDialog's own default stacking, which this dialog uses without `zIndex`. */
const DIALOG_Z_DEFAULT = 1200;

export const DETAIL_COPY = {
	title: "Time entry",
	timeline: "Work and break timeline",
	timelineEmpty:
		"No timeline for this entry. It was recorded before per-pause tracking, or its times were edited.",
	timelineLoading: "Loading the timeline…",
	comments: "Comments",
	commentsEmpty:
		"No comments yet. Use this thread to ask about this time or explain it.",
	commentsLoading: "Loading comments…",
	commentLabel: "Add a comment",
	commentPlaceholder:
		"Ask about this time, or explain it to whoever reviews it.",
	postComment: "Post comment",
	commentAdded: "Comment added",
	someone: "Someone",
	openSheet: "Open timesheet →",
	tryAgain: "Try again",
	work: "Work",
	break: "Break",
	now: "now",
	running: "running",
	sourceTimer: "Timer",
	sourceManual: "Manual time",
	amountFinal: "Amount at approval",
	amountEstimate: "Estimated cost",
	finalAtApproval: "(final at approval)",
	perHour: "/ hour",
} as const;

export interface TimeEntryDetailModalProps {
	/** Open while set. A non-uuid id is a miss (the 404 card), never a request. */
	entryId: string | null;
	onClose: () => void;
	/** The list's copy, shown while the fresh one loads. */
	entry?: TimeEntryView | null;
	/** The surface it opens from (default `mine`); edits need `mine` and the viewer's own entry. */
	mode?: EntriesTableMode;
	/** Clock times and days are read in this timezone. Default: the device's. */
	timeZone?: string;
	/** `comments` focuses the comment box once the entry loads (the row's "Comment"). */
	focus?: "comments" | null;
	/** The caller's sheets, for the submitted date in the lock sentence. */
	sheets?: readonly EntrySheetInfo[];
	onEdit?: (entry: TimeEntryView) => void;
	onDelete?: (entry: TimeEntryView) => void;
	/**
	 * "Open timesheet →". Default: on for the viewer's own entry, off in
	 * `review` (already on the sheet). Someone else's sheet may not open for
	 * this viewer (a team manager on a workspace sheet, D49), so a caller that
	 * knows it does passes `true`.
	 */
	showSheetLink?: boolean;
	projectWorkspaceName?: string | null;
	zIndex?: number;
}

export function TimeEntryDetailModal({
	entryId,
	onClose,
	entry,
	mode = "mine",
	timeZone,
	focus = null,
	sheets,
	onEdit,
	onDelete,
	showSheetLink,
	projectWorkspaceName,
	zIndex,
}: TimeEntryDetailModalProps) {
	const user = useUser();
	const toast = useToast();
	const qc = useQueryClient();
	const native = isNativeApp();
	const tz = safeTimezone(timeZone ?? deviceTimeZone());
	const open = Boolean(entryId);
	const valid = isUuid(entryId);
	const id = valid ? (entryId as string) : null;

	const [commentBody, setCommentBody] = useState("");
	const commentRef = useRef<HTMLTextAreaElement | null>(null);
	// Drafts belong to the entry you opened, not to the dialog.
	useEffect(() => {
		setCommentBody("");
	}, [entryId]);

	const entryQuery = useQuery({
		...timeQueries.entry(id),
		placeholderData: entry && entry.id === id ? entry : undefined,
	});
	const view = entryQuery.data;
	const isTimer = view?.source === "timer";
	const segmentsQuery = useQuery({
		...timeQueries.entrySegments(id),
		enabled: Boolean(id && isTimer),
	});
	const commentsQuery = useQuery(timeQueries.entryComments(id));

	const commentMutation = useMutation({
		mutationFn: (body: string) =>
			timeService.addEntryComment(id as string, body),
		onSuccess: async () => {
			setCommentBody("");
			toast.success(DETAIL_COPY.commentAdded);
			await invalidateTime(qc, "comment");
		},
		onError: (error) =>
			toast.error(
				timeErrorMessage(error, {
					subject: "entry",
					operation: "write",
					native,
				}),
			),
	});

	// "Comment" from a row: focus the box once it exists.
	const loaded = Boolean(view);
	useEffect(() => {
		if (!open || focus !== "comments" || !loaded) return;
		const frame = requestAnimationFrame(() => {
			const box = commentRef.current;
			if (!box) return;
			box.focus();
			box.scrollIntoView?.({ block: "nearest" });
		});
		return () => cancelAnimationFrame(frame);
	}, [open, focus, loaded]);

	const own = Boolean(
		view && user?.id && view.member_user_id && view.member_user_id === user.id,
	);
	const editable =
		Boolean(view) &&
		mode === "mine" &&
		own &&
		!isEntryLocked(view as TimeEntryView) &&
		!isHiddenContent(view as TimeEntryView);
	const runningView = Boolean(view && !view.ended_at);

	const submitComment = () => {
		const body = commentBody.trim();
		if (!body || commentMutation.isPending || !id) return;
		commentMutation.mutate(body);
	};

	const footer =
		editable && view && (onEdit || onDelete) ? (
			<div className="flex w-full flex-wrap items-center justify-end gap-2">
				{onDelete ? (
					<button
						type="button"
						onClick={() => onDelete(view)}
						className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 px-3 py-1.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10"
					>
						<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
						{ENTRY_COPY.delete}
					</button>
				) : null}
				{onEdit ? (
					<button
						type="button"
						onClick={() => onEdit(view)}
						disabled={runningView}
						title={runningView ? ENTRY_COPY.stopToEdit : undefined}
						className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
					>
						<Pencil className="h-3.5 w-3.5" aria-hidden="true" />
						{ENTRY_COPY.edit}
					</button>
				) : null}
			</div>
		) : undefined;

	let body: ReactNode;
	if (!valid) {
		body = (
			<TimeReasonCard
				tone="not-found"
				variant="inline"
				title={notFoundMessage(native)}
			/>
		);
	} else if (view) {
		body = (
			<EntryDetailBody
				view={view}
				own={own}
				mode={mode}
				tz={tz}
				native={native}
				sheet={
					view.timesheet_id
						? (sheets?.find((s) => s.id === view.timesheet_id) ?? null)
						: null
				}
				showSheetLink={showSheetLink ?? (own && mode !== "review")}
				projectWorkspaceName={projectWorkspaceName}
				zIndex={zIndex}
				segments={segmentsQuery.data}
				segmentsLoading={
					isTimer && segmentsQuery.isPending && !segmentsQuery.isError
				}
				segmentsError={
					isTimer && segmentsQuery.isError
						? timeErrorMessage(segmentsQuery.error, {
								subject: "entry",
								operation: "read",
								native,
							})
						: null
				}
				comments={commentsQuery.data}
				commentsLoading={commentsQuery.isPending}
				commentsError={
					commentsQuery.isError
						? timeErrorMessage(commentsQuery.error, {
								subject: "entry",
								operation: "read",
								native,
							})
						: null
				}
				commentForm={
					<CommentForm
						textareaRef={commentRef}
						value={commentBody}
						onChange={setCommentBody}
						onSubmit={submitComment}
						pending={commentMutation.isPending}
					/>
				}
			/>
		);
	} else if (entryQuery.isError) {
		const copy = timeErrorCopy(entryQuery.error, {
			subject: "entry",
			operation: "read",
			native,
		});
		body = copy.notFound ? (
			<TimeReasonCard tone="not-found" variant="inline" title={copy.message} />
		) : (
			<TimeReasonCard
				tone="danger"
				variant="inline"
				role="alert"
				title={copy.message}
				action={
					<button
						type="button"
						onClick={() => void entryQuery.refetch()}
						className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
					>
						{DETAIL_COPY.tryAgain}
					</button>
				}
			/>
		);
	} else {
		body = (
			<div className="flex justify-center py-12" aria-busy="true">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<AppDialog
			open={open}
			onClose={onClose}
			busy={commentMutation.isPending}
			size="lg"
			title={DETAIL_COPY.title}
			description={view ? describe(view) : undefined}
			footer={footer}
			zIndex={zIndex}
			initialFocusRef={focus === "comments" ? commentRef : undefined}
		>
			{body}
		</AppDialog>
	);
}

/** "This time entry doesn't exist or you can't open it." (a mistyped `?entry=` link). */
function notFoundMessage(native: boolean): string {
	return timeErrorCopy(
		new TimeApiError({ status: 404, code: "TIME_NOT_FOUND", message: "" }),
		{ subject: "entry", native },
	).message;
}

/** "Fix login bug · Acme Website", or the hidden label. */
function describe(view: TimeEntryView): string {
	const title = entryTitle(view);
	if (title.kind === "hidden") return title.text;
	const project = view.project?.title?.trim();
	return project ? `${title.text} · ${project}` : title.text;
}

// ── Body ────────────────────────────────────────────────────────────────────

interface EntryDetailBodyProps {
	view: TimeEntryView;
	own: boolean;
	mode: EntriesTableMode;
	tz: string;
	native: boolean;
	sheet: EntrySheetInfo | null;
	showSheetLink: boolean;
	projectWorkspaceName?: string | null;
	zIndex?: number;
	segments: SegmentRow[] | undefined;
	segmentsLoading: boolean;
	/** Why the timeline could not load, or null (never the empty sentence). */
	segmentsError: string | null;
	comments: CommentRow[] | undefined;
	commentsLoading: boolean;
	/** Why the thread could not load, or null. */
	commentsError: string | null;
	commentForm: ReactNode;
}

function EntryDetailBody({
	view,
	own,
	mode,
	tz,
	native,
	sheet,
	showSheetLink,
	projectWorkspaceName,
	zIndex,
	segments,
	segmentsLoading,
	segmentsError,
	comments,
	commentsLoading,
	commentsError,
	commentForm,
}: EntryDetailBodyProps) {
	const running = !view.ended_at;
	const nowMs = useLiveNowMs(running);
	const hidden = isHiddenContent(view);
	const title = entryTitle(view);
	const workSeconds = entryWorkSeconds(view, nowMs);
	const breakSeconds = entryBreakSeconds(view, nowMs);
	const sheetLine = entrySheetLine(view, { native, userTimezone: tz });
	const reviewNote = needsReviewCopy(view, { nowMs });
	// The lock sentence talks to the member ("Withdraw to change.").
	const lockText = own
		? entryLockCopy(view, { native, sheet, timeZone: tz })
		: null;
	const amount = entryAmount(view, nowMs);
	const amountsVisible = canShowAmounts({
		cost: view.cost,
		kind: view.context_kind,
		native,
	});
	const rate = Number(view.rate_snapshot ?? 0);
	const showRate =
		!native &&
		amountsVisible &&
		view.cost === "visible" &&
		view.rate_type_snapshot !== "fixed" &&
		Number.isFinite(rate) &&
		rate > 0;

	const day = formatInstantDay(view.started_at, tz, {
		weekday: true,
		userTimezone: tz,
	});
	const start = formatInstantTime(view.started_at, tz);
	const end = view.ended_at
		? localDate(view.ended_at, tz) === localDate(view.started_at, tz)
			? formatInstantTime(view.ended_at, tz)
			: formatInstantDateTime(view.ended_at, tz, { userTimezone: tz })
		: DETAIL_COPY.now;

	return (
		<div className="space-y-4">
			{/* Summary */}
			<section className="rounded-xl border border-border bg-card p-4">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0">
						<p className="text-2xl font-semibold tabular-nums text-foreground">
							{formatClock(workSeconds)}
						</p>
						<p className="mt-0.5 text-sm tabular-nums text-muted-foreground">
							{day} · {start} – {end}
						</p>
					</div>
					<div className="flex flex-wrap items-center justify-end gap-1.5">
						{running ? (
							<span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
								{isOnBreak(view) ? ENTRY_COPY.onBreak : ENTRY_COPY.running}
							</span>
						) : view.timesheet ? (
							<span
								className={cn(
									"inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold",
									STATUS_PILL[view.timesheet.status],
								)}
							>
								{sheetStatusWord(view.timesheet.status)}
							</span>
						) : null}
						<EntryBadges entry={view} variant="detail" native={native} />
					</div>
				</div>
				{sheetLine ? (
					<p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
						<span>{sheetLine.text}</span>
						{sheetLine.note ? (
							<span className="italic">“{sheetLine.note}”</span>
						) : null}
						{showSheetLink && view.timesheet_id ? (
							<Link
								to="/time/timesheets/$timesheetId"
								params={{ timesheetId: view.timesheet_id }}
								className="font-semibold text-primary hover:underline"
							>
								{DETAIL_COPY.openSheet}
							</Link>
						) : null}
					</p>
				) : null}
			</section>

			{reviewNote ? (
				<p
					role="note"
					className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground"
				>
					<AlertTriangle
						className="mt-0.5 h-4 w-4 shrink-0 text-warning"
						aria-hidden="true"
					/>
					{reviewNote}
				</p>
			) : null}
			{lockText ? (
				<p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
					<Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
					{lockText}
				</p>
			) : null}

			{/* Fields */}
			<dl className="rounded-xl border border-border bg-card">
				<FieldRow label="For">
					<ForChip
						option={forChipOptionFromEntry(view)}
						variant={lockText ? "locked" : "readonly"}
						lockedText={lockText}
						projectId={
							own && mode === "mine" && !hidden ? view.project_id : null
						}
						projectWorkspaceName={projectWorkspaceName}
						// Above the dialog at its own stacking (AppDialog defaults to
						// 1200; AnchoredPopover's 1100 would open behind it).
						popoverZIndex={(zIndex ?? DIALOG_Z_DEFAULT) + 10}
					/>
				</FieldRow>
				{!own ? (
					<FieldRow label="Person">{entryMemberLabel(view)}</FieldRow>
				) : null}
				<FieldRow label="Project">
					{hidden ? (
						<span className="italic text-muted-foreground">{title.text}</span>
					) : (
						view.project?.title?.trim() || "—"
					)}
				</FieldRow>
				<FieldRow label={hidden || title.kind === "preset" ? "Kind" : "Task"}>
					{hidden ? workItemLabel(view.work_item) : title.text}
				</FieldRow>
				{!hidden && view.note?.trim() ? (
					<FieldRow label="Note">
						<span className="whitespace-pre-wrap wrap-break-word">
							{view.note}
						</span>
					</FieldRow>
				) : null}
				{breakSeconds >= 60 ? (
					<FieldRow label="Break">{formatDurationText(breakSeconds)}</FieldRow>
				) : null}
				{view.payable_seconds !== null && view.payable_seconds !== undefined ? (
					<FieldRow label="Approved time">
						<span className="tabular-nums">
							{formatClock(view.payable_seconds)}
						</span>
					</FieldRow>
				) : null}
				{amount && amountsVisible ? (
					<FieldRow
						label={
							amount.final
								? DETAIL_COPY.amountFinal
								: DETAIL_COPY.amountEstimate
						}
					>
						<AmountLines
							amounts={amountRecord(amount)}
							cost={view.cost}
							kind={view.context_kind}
							native={native}
							suffix={amount.final ? undefined : DETAIL_COPY.finalAtApproval}
							className="font-semibold"
						/>
					</FieldRow>
				) : null}
				{showRate ? (
					<FieldRow label="Rate">
						<span className="tabular-nums">
							{formatMoneyLine(rate, view.currency_snapshot)}{" "}
							{DETAIL_COPY.perHour}
						</span>
					</FieldRow>
				) : null}
				<FieldRow label="Source">
					{view.source === "timer"
						? DETAIL_COPY.sourceTimer
						: DETAIL_COPY.sourceManual}
				</FieldRow>
			</dl>

			{view.source === "timer" ? (
				<SectionCard
					icon={<Timer className="h-4 w-4 text-muted-foreground" />}
					title={DETAIL_COPY.timeline}
				>
					{segmentsLoading ? (
						<p className="text-sm text-muted-foreground">
							{DETAIL_COPY.timelineLoading}
						</p>
					) : segmentsError ? (
						<p role="alert" className="text-sm text-destructive">
							{segmentsError}
						</p>
					) : (segments ?? []).length === 0 ? (
						<p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
							{DETAIL_COPY.timelineEmpty}
						</p>
					) : (
						<ol className="space-y-1.5">
							{(segments ?? []).map((segment) => (
								<SegmentItem key={segment.id} segment={segment} tz={tz} />
							))}
						</ol>
					)}
				</SectionCard>
			) : null}

			<SectionCard
				icon={<MessageSquare className="h-4 w-4 text-muted-foreground" />}
				title={DETAIL_COPY.comments}
			>
				<div className="space-y-3">
					{commentsLoading ? (
						<p className="text-sm text-muted-foreground">
							{DETAIL_COPY.commentsLoading}
						</p>
					) : commentsError ? (
						<p role="alert" className="text-sm text-destructive">
							{commentsError}
						</p>
					) : (comments ?? []).length === 0 ? (
						<p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
							{DETAIL_COPY.commentsEmpty}
						</p>
					) : (
						<ul className="space-y-2">
							{(comments ?? []).map((comment) => (
								<li
									key={comment.id}
									className="rounded-md border border-border bg-card px-3 py-2"
								>
									<div className="flex items-center justify-between gap-2">
										<span className="text-xs font-semibold text-foreground">
											{commentAuthor(comment)}
										</span>
										<span className="text-[11px] text-muted-foreground">
											{formatInstantDateTime(comment.created_at, tz, {
												userTimezone: tz,
											})}
										</span>
									</div>
									<p className="mt-1 whitespace-pre-wrap wrap-break-word text-sm text-foreground">
										{comment.body}
									</p>
								</li>
							))}
						</ul>
					)}
					{commentForm}
				</div>
			</SectionCard>
		</div>
	);
}

const STATUS_PILL = {
	open: "bg-muted text-muted-foreground",
	submitted: "bg-muted text-foreground",
	returned: "bg-warning/15 text-foreground",
	approved: "bg-success/15 text-success-foreground",
} as const;

/** A comment's byline: "Delivery team member" when the worker is masked to this viewer. */
export function commentAuthor(comment: CommentRow): string {
	const author = comment.author;
	const name =
		author?.display_name?.trim() ||
		[author?.first_name, author?.last_name].filter(Boolean).join(" ").trim() ||
		author?.email?.trim();
	if (name) return name;
	return comment.author_user_id === null
		? ENTRY_COPY.maskedCommentAuthor
		: DETAIL_COPY.someone;
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="grid grid-cols-3 gap-4 border-b border-border px-3 py-2.5 last:border-b-0">
			<dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
				{label}
			</dt>
			<dd className="col-span-2 min-w-0 text-sm text-foreground">{children}</dd>
		</div>
	);
}

function SectionCard({
	icon,
	title,
	children,
}: {
	icon: ReactNode;
	title: string;
	children: ReactNode;
}) {
	return (
		<section className="rounded-xl border border-border bg-card">
			<div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
				{icon}
				<h3 className="text-sm font-semibold text-card-foreground">{title}</h3>
			</div>
			<div className="p-3">{children}</div>
		</section>
	);
}

function SegmentItem({ segment, tz }: { segment: SegmentRow; tz: string }) {
	const isBreak = segment.kind === "break";
	const started = Date.parse(segment.started_at);
	const ended = segment.ended_at ? Date.parse(segment.ended_at) : null;
	const seconds =
		ended !== null && !Number.isNaN(ended) && !Number.isNaN(started)
			? Math.max(0, Math.floor((ended - started) / 1000))
			: null;
	return (
		<li
			className={cn(
				"flex items-center gap-3 rounded-md border px-3 py-2",
				isBreak ? "border-warning/30 bg-warning/10" : "border-border bg-card",
			)}
		>
			{isBreak ? (
				<Coffee
					className="h-3.5 w-3.5 shrink-0 text-warning"
					aria-hidden="true"
				/>
			) : (
				<Timer className="h-3.5 w-3.5 shrink-0 text-info" aria-hidden="true" />
			)}
			<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				{isBreak ? DETAIL_COPY.break : DETAIL_COPY.work}
			</span>
			<span className="text-sm tabular-nums text-foreground">
				{formatInstantTime(segment.started_at, tz)} –{" "}
				{segment.ended_at
					? formatInstantTime(segment.ended_at, tz)
					: DETAIL_COPY.now}
			</span>
			<span className="ml-auto text-xs tabular-nums text-muted-foreground">
				{seconds === null ? DETAIL_COPY.running : formatDurationText(seconds)}
			</span>
		</li>
	);
}

function CommentForm({
	textareaRef,
	value,
	onChange,
	onSubmit,
	pending,
}: {
	textareaRef: React.RefObject<HTMLTextAreaElement | null>;
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	pending: boolean;
}) {
	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			onSubmit();
		}
	};
	return (
		<div className="space-y-2">
			<label
				htmlFor="time-entry-comment"
				className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
			>
				{DETAIL_COPY.commentLabel}
			</label>
			<textarea
				id="time-entry-comment"
				ref={textareaRef}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={onKeyDown}
				rows={3}
				maxLength={COMMENT_MAX_LENGTH}
				placeholder={DETAIL_COPY.commentPlaceholder}
				className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
			/>
			<div className="flex justify-end">
				<button
					type="button"
					onClick={onSubmit}
					disabled={pending || !value.trim()}
					className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
				>
					{pending ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
					) : null}
					{DETAIL_COPY.postComment}
				</button>
			</div>
		</div>
	);
}
