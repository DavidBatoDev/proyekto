// web/src/components/time/review/TimesheetReview.tsx
//
// The timesheet review screen at `/time/timesheets/<id>` (ux.md › Approvals ›
// Review screen). The submitter, the deciders and a team manager who can view
// the sheet (`can_view_timesheet`) share the URL; anyone else, and any id
// that isn't one, gets the 404 card "This timesheet doesn't exist or you
// can't open it."
//
//   ← Time
//   Maria Santos · Prodigitality Services Inc. Team · Sep 22 – 28, 2026 (Asia/Manila)
//   Submitted Sep 29, 10:14 · 38:15 · 3 projects                [Return…] [Approve…]
//   Rules at submit: weekly · team owners & admins approve · manual time up to 7 days back
//   ┌ grid: projects × days, read-only ┐            (phones: stacked day cards)
//   ⚠ Thu is 11h 40m · 1 entry over 10h · 2 entries added later   [Show flagged]
//   ⏱ Weekly limit 40h (Prodigitality) · 38:15 logged · within limit
//   Estimated cost: PHP 6,885.00 · USD 120.00 (final at approval)   ← cost viewers only
//   Entries ▾ (grouped table, read-only; a row opens TimeEntryDetailModal)
//   History: Imported from per-entry review Sep 29 · Returned Sep 30 'Split Thu' · Resubmitted Oct 1
//
// Built on the kits: the sheet actions and dialogs (`components/time/sheets`),
// the entries table and detail modal (`components/time/entries`), the copy in
// `lib/timeErrors` / `lib/timeFormat`. The rules behind each part are in
// `reviewModel.ts`.
//
// Stale revisions: the screen remembers the revision the reader looked at.
// When a refetch brings a newer one that the reader didn't cause, it says
// "Maria changed this timesheet while you were looking. [Review the latest]"
// and holds the decision buttons until they look; a decision sent against
// an old revision comes back STALE_REVISION and the dialog says the same.

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { TimeEntriesTable } from "@/components/time/entries/TimeEntriesTable";
import { TimeEntryDetailModal } from "@/components/time/entries/TimeEntryDetailModal";
import { TimeReasonCard } from "@/components/time/shared/TimeReasonCard";
import {
	DecisionDialog,
	type DecisionDialogKind,
	SheetFailureNotice,
} from "@/components/time/sheets/DecisionDialogs";
import { StaleRevisionBanner } from "@/components/time/sheets/StaleRevisionBanner";
import { SubmitSheetDialog } from "@/components/time/sheets/SubmitSheetDialog";
import { useTimesheetActions } from "@/components/time/sheets/useTimesheetActions";
import { useIsMobile } from "@/hooks/useIsMobile";
import { isNativeApp } from "@/lib/platform";
import { serverNow } from "@/lib/serverClock";
import { staleRevisionCopy, timeErrorCopy } from "@/lib/timeErrors";
import { deviceTimeZone, goesToCopy, sheetStatusView } from "@/lib/timeFormat";
import { safeTimezone } from "@/lib/timePeriods";
import { isUuid } from "@/lib/timeSearch";
import { cn } from "@/lib/utils";
import { timeQueries } from "@/queries/time";
import { TimeApiError } from "@/services/time.service";
import type {
	TimeEntryView,
	TimesheetDetail,
	TimesheetRow,
	TimesheetSummary,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import { CostLines } from "./CostLines";
import { DayProjectGrid } from "./DayProjectGrid";
import { FlagsLine } from "./FlagsLine";
import { HistoryList } from "./HistoryList";
import { MobileDayCards } from "./MobileDayCards";
import { OverLimitPanel } from "./OverLimitPanel";
import { ReviewActions } from "./ReviewActions";
import { ReviewHeader } from "./ReviewHeader";
import {
	buildReviewGrid,
	filterLabel,
	filterReviewEntries,
	flagsLineParts,
	hasFilter,
	headerFacts,
	historyItems,
	latestEvent,
	REVIEW_COPY,
	type ReviewButtonId,
	type ReviewFilter,
	reviewButtons,
	reviewFlags,
	reviewNames,
	reviewPersonName,
	rulesView,
	settledHrefFor,
	sheetCost,
	sheetOvertime,
	sheetWeeklyLimit,
} from "./reviewModel";
import { WeeklyLimitLine } from "./WeeklyLimitLine";

export interface TimesheetReviewProps {
	/** The route's `$timesheetId` (anything that isn't a uuid is a miss). */
	timesheetId: string;
	/** The route's `?entry=`: opens that entry's detail over the screen. */
	entryId?: string | null;
	/** Opens an entry (the route writes `?entry=`). Without it the screen keeps it in state. */
	onOpenEntry?: (entryId: string) => void;
	/** Closes the entry detail (the route drops `?entry=`). */
	onCloseEntry?: () => void;
	/** Tests and fixed clocks. */
	now?: Date;
	userTimezone?: string;
}

const PAGE = "mx-auto w-full max-w-6xl space-y-5 px-4 py-4 sm:px-6 sm:py-6";

function BackLink() {
	return (
		<Link
			to="/time"
			className="inline-flex items-center gap-1 rounded-md text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-10"
		>
			<span aria-hidden="true">←</span> Time
		</Link>
	);
}

/** The 404 card ("This timesheet doesn't exist or you can't open it."). */
function NotFoundCard() {
	const copy = timeErrorCopy(
		new TimeApiError({ status: 404, code: "HTTP_404", message: "" }),
		{ subject: "timesheet", operation: "read" },
	);
	return (
		<div className={PAGE}>
			<TimeReasonCard
				tone="not-found"
				title={copy.message}
				action={
					<Link
						to="/time"
						className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
					>
						<span aria-hidden="true">←</span> Time
					</Link>
				}
			/>
		</div>
	);
}

function ReviewSkeleton() {
	return (
		<div className={PAGE} aria-busy="true" data-testid="review-loading">
			<span role="status" className="sr-only">
				{REVIEW_COPY.loading}
			</span>
			<div className="h-4 w-16 animate-pulse rounded bg-muted" />
			<div className="h-7 w-3/4 animate-pulse rounded bg-muted" />
			<div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
			<div className="h-48 w-full animate-pulse rounded-xl bg-muted" />
			<div className="h-32 w-full animate-pulse rounded-xl bg-muted" />
		</div>
	);
}

export function TimesheetReview({
	timesheetId,
	entryId = null,
	onOpenEntry,
	onCloseEntry,
	now,
	userTimezone,
}: TimesheetReviewProps) {
	const valid = isUuid(timesheetId);
	const query = useQuery({
		...timeQueries.timesheet(valid ? timesheetId : null),
		// A decider may sit on this screen: a refetch on return is how they
		// learn the sheet moved ("… changed this timesheet while you were looking").
		refetchOnWindowFocus: true,
	});

	// A 404 wins over a cached copy: TanStack keeps the last data when a
	// refetch fails, and this sheet may be someone's the viewer can no longer
	// open (access revoked, or another account in this tab).
	const missing =
		query.isError &&
		timeErrorCopy(query.error, { subject: "timesheet", operation: "read" })
			.notFound;
	if (!valid || missing) return <NotFoundCard />;
	if (query.data) {
		return (
			<ReviewBody
				key={query.data.sheet.id}
				detail={query.data}
				refetch={async () => (await query.refetch()).data}
				refetching={query.isFetching}
				entryId={entryId}
				onOpenEntry={onOpenEntry}
				onCloseEntry={onCloseEntry}
				now={now}
				userTimezone={userTimezone}
			/>
		);
	}
	if (query.isError) {
		const copy = timeErrorCopy(query.error, {
			subject: "timesheet",
			operation: "read",
		});
		if (copy.notFound) return <NotFoundCard />;
		return (
			<div className={PAGE}>
				<BackLink />
				<TimeReasonCard
					tone="danger"
					role="alert"
					title={copy.message}
					action={
						<button
							type="button"
							onClick={() => void query.refetch()}
							disabled={query.isFetching}
							className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
						>
							{query.isFetching ? (
								<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
							) : null}
							{REVIEW_COPY.tryAgain}
						</button>
					}
				/>
			</div>
		);
	}
	return <ReviewSkeleton />;
}

// ── The screen ──────────────────────────────────────────────────────────────

interface ReviewBodyProps {
	detail: TimesheetDetail;
	/** Refetch the detail; resolves to the fresh copy. */
	refetch: () => Promise<TimesheetDetail | undefined>;
	refetching: boolean;
	entryId: string | null;
	onOpenEntry?: (entryId: string) => void;
	onCloseEntry?: () => void;
	now?: Date;
	userTimezone?: string;
}

/** The sheet with the member-only A1/A2 fields the detail carries beside it. */
function sheetWithRouting(detail: TimesheetDetail): TimesheetSummary {
	return {
		...detail.sheet,
		routing_preview: detail.routing_preview ?? detail.sheet.routing_preview,
		deciders: detail.deciders ?? detail.sheet.deciders,
	};
}

function ReviewBody({
	detail,
	refetch,
	refetching,
	entryId,
	onOpenEntry,
	onCloseEntry,
	now,
	userTimezone,
}: ReviewBodyProps) {
	const viewerId = useAuthStore((state) => state.user?.id ?? null);
	const native = isNativeApp();
	const isMobile = useIsMobile(639);
	const entriesId = useId();

	const sheet = useMemo(() => sheetWithRouting(detail), [detail]);
	const { entries, viewer } = detail;
	const tz = safeTimezone(sheet.timezone);
	const readerTz = userTimezone ?? deviceTimeZone();
	const nowMs = now ? now.getTime() : undefined;
	const dateOptions = { now, userTimezone: readerTz };

	// ── Derived views ──
	const grid = useMemo(
		() => buildReviewGrid(sheet, entries, { nowMs: nowMs ?? serverNow() }),
		[sheet, entries, nowMs],
	);
	const flags = useMemo(
		() => reviewFlags(sheet, entries, grid, { nowMs: nowMs ?? serverNow() }),
		[sheet, entries, grid, nowMs],
	);
	const personName = reviewPersonName(detail);
	const isMember = viewer.is_member;
	const status = sheetStatusView(sheet, {
		...dateOptions,
		viewerId,
		events: detail.events,
		names: reviewNames(detail),
		decidersCount: detail.deciders_count,
	});
	const facts = headerFacts(sheet, grid, { now });
	const rules = rulesView(detail, { native });
	const goesTo =
		isMember && (sheet.status === "open" || sheet.status === "returned")
			? goesToCopy(
					sheet.routing_preview?.approver_scope,
					sheet.routing_preview?.deciders,
					{ scopeKind: sheet.scope_kind, label: sheet.scope_label_snapshot },
				)
			: null;
	const buttons = reviewButtons(viewer.actions, sheet.status);
	const limit = sheetWeeklyLimit(detail, grid);
	const overtime = sheetOvertime(detail);
	const canApprove = viewer.actions.includes("approve");
	const cost = sheetCost(detail, { nowMs });
	const flagParts = flagsLineParts(flags, {
		weekly: sheet.period_kind === "weekly",
		...dateOptions,
	});
	const history = historyItems(detail.events, { timeZone: tz, now });
	const tableMode = isMember ? "readonly" : "review";
	const otherPerson = isMember ? null : personName;

	// ── Stale revisions ──
	const [seenRevision, setSeenRevision] = useState(sheet.revision);
	useEffect(() => {
		if (sheet.revision <= seenRevision) return;
		// The reader's own change from elsewhere (another tab) is not news.
		const latest = latestEvent(detail.events);
		if (viewerId && latest?.actor_user_id === viewerId) {
			setSeenRevision(sheet.revision);
		}
	}, [sheet.revision, seenRevision, detail.events, viewerId]);
	// Revisions only grow: our own action moves `seenRevision` ahead of the
	// cached copy until the refetch lands, which is not a change under us.
	const changed = sheet.revision > seenRevision;
	// Name the person only when they made the change ("Maria changed…"); a
	// co-decider's change reads "This timesheet changed…".
	const changedBy = latestEvent(detail.events)?.actor_user_id ?? null;
	const changerName =
		changedBy && changedBy === sheet.member_user_id ? otherPerson : null;
	const staleCopy = staleRevisionCopy({
		subject: "timesheet",
		personName: changerName,
	});
	/** An action of ours finished: its row's revision is the one we saw. */
	const acknowledge = useCallback((row: TimesheetRow | null | undefined) => {
		if (row && typeof row.revision === "number") setSeenRevision(row.revision);
	}, []);
	const reviewLatest = useCallback(async () => {
		const fresh = await refetch();
		if (fresh) setSeenRevision(fresh.sheet.revision);
	}, [refetch]);

	// ── Filters ──
	const [filter, setFilter] = useState<ReviewFilter | null>(null);
	const [flaggedOnly, setFlaggedOnly] = useState(false);
	const [entriesOpen, setEntriesOpen] = useState(true);
	const applyFilter = (next: ReviewFilter | null) => {
		setFilter(next);
		setFlaggedOnly(false);
		if (next) setEntriesOpen(true);
	};
	const toggleFlagged = () => {
		setFlaggedOnly((on) => !on);
		setFilter(null);
		setEntriesOpen(true);
	};
	const shownEntries = useMemo(() => {
		const base = flaggedOnly
			? entries.filter((entry) => flags.flaggedIds.has(entry.id))
			: entries;
		return filterReviewEntries(base, filter, tz);
	}, [entries, flaggedOnly, flags, filter, tz]);
	const filtered = flaggedOnly || hasFilter(filter);
	const filterText = flaggedOnly
		? REVIEW_COPY.flaggedEntries
		: filter
			? filterLabel(filter, grid, dateOptions)
			: "";

	// ── Entry detail (`?entry=`) ──
	const [localEntryId, setLocalEntryId] = useState<string | null>(entryId);
	const [focus, setFocus] = useState<"comments" | null>(null);
	const openEntryId = onOpenEntry ? entryId : localEntryId;
	const openEntry = (
		entry: TimeEntryView,
		options?: { focus?: "comments" },
	) => {
		setFocus(options?.focus ?? null);
		if (onOpenEntry) onOpenEntry(entry.id);
		else setLocalEntryId(entry.id);
	};
	const closeEntry = () => {
		setFocus(null);
		if (onCloseEntry) onCloseEntry();
		else setLocalEntryId(null);
	};

	// ── Actions ──
	const actions = useTimesheetActions();
	const [dialog, setDialog] = useState<{
		kind: DecisionDialogKind;
		sheet: TimesheetSummary;
	} | null>(null);
	const [submitOpen, setSubmitOpen] = useState(false);
	const [approveOvertime, setApproveOvertime] = useState(false);
	const onAction = (id: ReviewButtonId) => {
		actions.clearFailure();
		switch (id) {
			case "withdraw":
				void actions.withdraw(sheet).then((outcome) => {
					if (outcome.ok) acknowledge(outcome.rows[0]);
				});
				return;
			case "submit":
				setSubmitOpen(true);
				return;
			default:
				// The dialog acts on the revision the reader is looking at.
				setDialog({ kind: id, sheet });
		}
	};
	const busyId: ReviewButtonId | null = actions.isPending("withdraw")
		? "withdraw"
		: null;
	const settledHref = useMemo(
		() => settledHrefFor(sheet, entries),
		[sheet, entries],
	);

	const actionBar = (
		<ReviewActions
			buttons={buttons}
			onAction={onAction}
			busyId={busyId}
			disabledReason={changed ? staleCopy.message : null}
			layout={isMobile ? "bar" : "inline"}
		/>
	);

	return (
		<div className={PAGE} data-testid="timesheet-review">
			<BackLink />

			{changed ? (
				<StaleRevisionBanner
					personName={changerName}
					onReviewLatest={() => void reviewLatest()}
					busy={refetching}
				/>
			) : null}
			<SheetFailureNotice
				failure={actions.failure}
				onReviewLatest={() => {
					actions.clearFailure();
					void reviewLatest();
				}}
				settledHref={settledHref}
			/>

			<ReviewHeader
				sheet={sheet}
				personName={personName}
				status={status}
				facts={facts}
				rules={rules}
				goesTo={goesTo}
				actions={isMobile ? null : buttons.length > 0 ? actionBar : null}
				native={native}
				now={now}
				userTimezone={readerTz}
			/>

			{entries.length === 0 ? (
				<p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
					{REVIEW_COPY.noTime}
				</p>
			) : isMobile ? (
				<MobileDayCards
					grid={grid}
					filter={filter}
					onFilter={applyFilter}
					now={now}
					userTimezone={readerTz}
				/>
			) : (
				<DayProjectGrid
					grid={grid}
					filter={filter}
					onFilter={applyFilter}
					now={now}
					userTimezone={readerTz}
				/>
			)}

			<FlagsLine
				parts={flagParts}
				flaggedCount={flags.flaggedIds.size}
				flaggedOnly={flaggedOnly}
				onToggleFlagged={toggleFlagged}
			/>

			{overtime ? (
				<>
					{limit?.source === "policy" ? (
						<WeeklyLimitLine reading={limit} />
					) : null}
					<OverLimitPanel
						overSeconds={overtime.overSeconds}
						payableSeconds={overtime.payableSeconds}
						countedSeconds={overtime.countedSeconds}
						reading={limit?.source === "agreement" ? limit : null}
						canDecide={canApprove}
						checked={approveOvertime}
						onCheckedChange={setApproveOvertime}
						disabled={changed}
					/>
				</>
			) : limit ? (
				<WeeklyLimitLine reading={limit} />
			) : null}

			<CostLines cost={cost} kind={sheet.scope_kind} native={native} />

			<section aria-labelledby={`${entriesId}-heading`} className="space-y-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h2 id={`${entriesId}-heading`} className="text-sm font-semibold">
						<button
							type="button"
							aria-expanded={entriesOpen}
							aria-controls={entriesId}
							onClick={() => setEntriesOpen((open) => !open)}
							className="inline-flex items-center gap-1 rounded-md text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-10"
						>
							{REVIEW_COPY.entries}
							<span className="font-normal text-muted-foreground tabular-nums">
								({shownEntries.length}
								{filtered ? ` of ${entries.length}` : ""})
							</span>
							<ChevronDown
								className={cn(
									"h-4 w-4 text-muted-foreground transition-transform",
									!entriesOpen && "-rotate-90",
								)}
								aria-hidden="true"
							/>
						</button>
					</h2>
					{isMember &&
					(sheet.status === "open" || sheet.status === "returned") ? (
						<Link
							to="/time"
							search={{ week: sheet.period_start }}
							className="text-sm font-semibold text-primary hover:underline"
						>
							{REVIEW_COPY.openInTime}
						</Link>
					) : null}
				</div>
				{filtered ? (
					<p
						data-testid="review-filter"
						className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
					>
						<span>
							{REVIEW_COPY.showing}{" "}
							<span className="font-medium text-foreground">{filterText}</span>
						</span>
						<button
							type="button"
							onClick={() => {
								setFilter(null);
								setFlaggedOnly(false);
							}}
							className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
						>
							<X className="h-3 w-3" aria-hidden="true" />
							{REVIEW_COPY.showAll}
						</button>
					</p>
				) : null}
				<div id={entriesId} hidden={!entriesOpen}>
					{entriesOpen ? (
						<TimeEntriesTable
							entries={shownEntries}
							mode={tableMode}
							order="oldest"
							timeZone={tz}
							defaultReviewOpen
							onOpenEntry={openEntry}
							// An empty sheet already says "No time on this timesheet yet."
							// in place of the grid; only a filter that matches nothing
							// needs a line here.
							empty={
								filtered ? (
									<p className="text-sm text-muted-foreground">
										{REVIEW_COPY.noMatch}
									</p>
								) : null
							}
						/>
					) : null}
				</div>
			</section>

			<HistoryList items={history} />

			{isMobile && buttons.length > 0 ? actionBar : null}

			<TimeEntryDetailModal
				entryId={openEntryId}
				onClose={closeEntry}
				entry={entries.find((entry) => entry.id === openEntryId) ?? null}
				mode={tableMode}
				timeZone={tz}
				focus={focus}
				showSheetLink={false}
			/>

			{dialog ? (
				<DecisionDialog
					open
					kind={dialog.kind}
					sheet={dialog.sheet}
					personName={personName}
					onClose={() => setDialog(null)}
					onDone={acknowledge}
					onReviewLatest={() => void reviewLatest()}
					overtime={dialog.kind === "approve" ? overtime : null}
					defaultApproveOvertime={approveOvertime}
					settledHref={settledHref}
					now={now}
					userTimezone={readerTz}
				/>
			) : null}

			{submitOpen ? (
				<SubmitSheetDialog
					open
					onClose={() => setSubmitOpen(false)}
					sheet={sheet}
					onSubmitted={acknowledge}
					now={now}
					userTimezone={readerTz}
				/>
			) : null}
		</div>
	);
}
