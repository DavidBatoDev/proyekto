// web/src/components/time/approvals/WaitingForYouList.tsx
//
// "Waiting for you" (ux.md › The Time Page; Approvals › Bulk approve): the
// submitted sheets the viewer can decide, across every workspace.
//
//   WAITING FOR YOU (3)                                     [Approve selected]
//   ☐ Maria Santos   Prodigitality Servic… · Sep 22–28   38:15   2 days ago ⚠1
//   ☐ Ana Lim        Acme · Sep 22–28  [Pixel]           40:00   today   ⏱ +2h
//
// - Rows link to the review screen (`/time/timesheets/<id>`); on a phone they
//   are full-width rows and bulk approve stays.
// - A member with several sheets is grouped under one header (the old
//   TeamApprovalsInbox grouping, rebuilt around timesheets); the header
//   checkbox selects that person's eligible sheets.
// - A3 flags: a sheet with Needs-review entries or a running timer can't be
//   selected ("Has flags. Open it to review."), nor one over a limit that cuts
//   payable time ("Over the limit. Open it to decide the overtime."), nor one
//   whose over-limit check was skipped (`flags_partial`: unknown is not 0).
// - E27: a row whose policy workspace is not the viewer's current one gets a
//   grey workspace tag.
// - Approve selected is all or nothing (L24): one `approve-bulk` call. On a
//   stale sheet nothing is approved and the banner names the person (A10):
//   "Nothing was approved: Leo Cruz's timesheet changed. [Review]".

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Check, Loader2, Timer } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Avatar } from "@/components/common/Avatar";
import { ForWorkspaceTag } from "@/components/time/for/ForChip";
import { TIME_EMPTY_COPY } from "@/components/time/page/TimeEmptyStates";
import { TimeReasonCard } from "@/components/time/shared/TimeReasonCard";
import { ApproveSelectedDialog } from "@/components/time/sheets/DecisionDialogs";
import { StaleRevisionBanner } from "@/components/time/sheets/StaleRevisionBanner";
import {
	type SheetActionFailure,
	sheetPersonName,
	useTimesheetActions,
} from "@/components/time/sheets/useTimesheetActions";
import { APPROVAL_DISABLED_COPY, timeErrorCopy } from "@/lib/timeErrors";
import {
	chipLabel,
	deviceTimeZone,
	formatClock,
	formatDurationText,
	formatPeriodRange,
	submittedAgo,
} from "@/lib/timeFormat";
import { cn } from "@/lib/utils";
import { timeQueries } from "@/queries/time";
import type { ProfileSummary } from "@/services/teams.service";
import type { ApprovalRow, SheetScopeKind } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

// ── Pure helpers ────────────────────────────────────────────────────────────

/** A flagged row whose over-limit check was skipped: unknown is not zero. */
export const APPROVAL_UNCHECKED_COPY =
	"Not checked against the limit yet. Open it to review.";

/**
 * The most rows a Waiting page asks for. The backend's A3 over-limit check
 * (`timesheets.service.ts` FLAGS_FREEZE_MAX) previews only the first 50
 * waiting sheets of each queue page and marks the rest `flags_partial`, which
 * blocks them from bulk approve. A page of at most 50 keeps every row
 * checkable. Keep the two numbers equal.
 */
export const APPROVAL_FLAGS_PAGE_MAX = 50;

/** P5's empty state. */
/** P5's empty line, the same words as the Time page's caught-up state. */
export const WAITING_EMPTY_COPY = `${TIME_EMPTY_COPY.caughtUp} ${TIME_EMPTY_COPY.caughtUpHint}`;

export type ApprovalBlockKind = "flags" | "over_limit" | "unchecked";

/** Why a row can't be bulk-selected, or null when it can. */
export function approvalRowBlock(
	row: Pick<ApprovalRow, "flags" | "flags_partial">,
): { kind: ApprovalBlockKind; reason: string } | null {
	const flags = row.flags;
	// A backend without A3 sends no flags: nothing to hold the row back.
	if (!flags) return null;
	if ((flags.needs_review ?? 0) > 0 || (flags.running ?? 0) > 0) {
		return { kind: "flags", reason: APPROVAL_DISABLED_COPY.flags };
	}
	if ((flags.over_cap_seconds ?? 0) > 0) {
		return { kind: "over_limit", reason: APPROVAL_DISABLED_COPY.overLimit };
	}
	if (row.flags_partial || flags.flags_partial) {
		return { kind: "unchecked", reason: APPROVAL_UNCHECKED_COPY };
	}
	return null;
}

export interface ApprovalGroup {
	/** The member's id (or the row id when the member is unknown). */
	key: string;
	name: string;
	avatarUrl: string | null;
	rows: ApprovalRow[];
}

/** Rows grouped by member, in the order the queue sent them (oldest submission first). */
export function groupApprovalRows(
	rows: readonly ApprovalRow[],
): ApprovalGroup[] {
	const groups = new Map<string, ApprovalGroup>();
	for (const row of rows) {
		const key = row.member_user_id ?? `sheet:${row.id}`;
		let group = groups.get(key);
		if (!group) {
			group = {
				key,
				name: sheetPersonName(row) ?? "Someone",
				avatarUrl: row.member?.avatar_url ?? null,
				rows: [],
			};
			groups.set(key, group);
		}
		group.rows.push(row);
	}
	return Array.from(groups.values());
}

function rowSeconds(row: ApprovalRow): number {
	return row.total_seconds ?? row.logged_seconds ?? 0;
}

function profileOf(group: ApprovalGroup): ProfileSummary {
	return {
		id: group.key,
		display_name: group.name,
		avatar_url: group.avatarUrl,
		email: null,
		first_name: null,
		last_name: null,
	};
}

// ── Component ───────────────────────────────────────────────────────────────

export interface WaitingForYouListProps {
	/**
	 * The viewer's current workspace: rows whose policy workspace differs get a
	 * tag (E27). `null` = no current workspace (every tagged row shows it);
	 * omitted = unknown (no tags).
	 */
	currentWorkspaceId?: string | null;
	/** Narrow to one sheet scope kind. */
	scopeKind?: SheetScopeKind;
	/** The header ("Waiting for you"); `null` hides it (Approve selected then lives in the floating bar only). */
	title?: string | null;
	/** Shown when nothing waits; `null` renders nothing instead. */
	emptyText?: string | null;
	/**
	 * Rows per page, up to `APPROVAL_FLAGS_PAGE_MAX` (50, the default). Past 50
	 * the server skips the limit check, so larger values are clamped.
	 */
	pageSize?: number;
	/** The floating "N selected · Approve selected" bar while rows are selected (default true). */
	floatingBar?: boolean;
	/** The section's id, for `#waiting` (the caller may set it on its own wrapper instead). */
	id?: string;
	now?: Date;
	userTimezone?: string;
	className?: string;
}

// Phones get 40 px targets (`max-sm:`); the desktop sizes are unchanged.
const PRIMARY =
	"inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-h-10 max-sm:px-4";
const SECONDARY =
	"inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-h-10 max-sm:px-3";
const CHECKBOX =
	"h-4 w-4 shrink-0 rounded border-input accent-primary disabled:cursor-not-allowed disabled:opacity-40";
/**
 * A 40 px tap area around a 16 px checkbox on phones. The negative margin
 * cancels the padding, so the row's layout doesn't move.
 */
const CHECK_HIT =
	"-m-3 inline-flex shrink-0 cursor-pointer p-3 has-[:disabled]:cursor-not-allowed sm:m-0 sm:p-0";

export function WaitingForYouList({
	currentWorkspaceId,
	scopeKind,
	title = "Waiting for you",
	emptyText = WAITING_EMPTY_COPY,
	pageSize = APPROVAL_FLAGS_PAGE_MAX,
	floatingBar = true,
	id,
	now,
	userTimezone,
	className,
}: WaitingForYouListProps) {
	const userId = useAuthStore((state) => state.user?.id ?? null);
	const [page, setPage] = useState(1);
	const limit = Math.min(
		Math.max(1, Math.floor(pageSize)),
		APPROVAL_FLAGS_PAGE_MAX,
	);
	const query = useQuery(
		timeQueries.approvals(userId, {
			status: "submitted",
			scope_kind: scopeKind,
			page,
			limit,
		}),
	);
	const rows = useMemo(() => query.data?.items ?? [], [query.data]);
	const total = query.data?.total ?? rows.length;
	const groups = useMemo(() => groupApprovalRows(rows), [rows]);
	const blocks = useMemo(
		() => new Map(rows.map((row) => [row.id, approvalRowBlock(row)])),
		[rows],
	);
	const eligibleIds = useMemo(
		() => rows.filter((row) => !blocks.get(row.id)).map((row) => row.id),
		[rows, blocks],
	);

	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const [dialogOpen, setDialogOpen] = useState(false);
	const [banner, setBanner] = useState<SheetActionFailure | null>(null);
	const actions = useTimesheetActions();
	const headingId = useId();

	// A new page (or scope) starts with nothing selected.
	useEffect(() => {
		setSelected(new Set());
	}, [page, scopeKind]);

	// A page past the end (everything on it was just decided) goes back to the
	// last page that has rows, or to page 1 and its empty state.
	const pageData = query.data;
	useEffect(() => {
		if (!pageData || pageData.items.length > 0 || page <= 1) return;
		setPage(Math.max(1, Math.ceil(pageData.total / limit)));
	}, [pageData, page, limit]);

	// Only rows still on screen and still eligible count as selected.
	const selectedRows = useMemo(
		() => rows.filter((row) => selected.has(row.id) && !blocks.get(row.id)),
		[rows, selected, blocks],
	);
	const selectedCount = selectedRows.length;
	const bulkBusy = actions.isPending("approve_bulk");

	const setMany = (ids: readonly string[], on: boolean) =>
		setSelected((current) => {
			const next = new Set(current);
			for (const rowId of ids) {
				if (on) next.add(rowId);
				else next.delete(rowId);
			}
			return next;
		});

	const approveSelected = async (note: string) => {
		const targets = selectedRows;
		const outcome = await actions.approveBulk(targets, { note });
		setDialogOpen(false);
		if (outcome.ok) {
			setSelected(new Set());
			setBanner(null);
			return;
		}
		setBanner(outcome.failure);
		// Never approve the changed sheet unseen on the next click.
		const changed = outcome.failure.timesheetId;
		if (changed) setMany([changed], false);
	};

	const tz = userTimezone ?? deviceTimeZone();
	const showTag = (row: ApprovalRow) =>
		currentWorkspaceId !== undefined &&
		row.policy_workspace != null &&
		row.policy_workspace.id !== currentWorkspaceId;

	const allEligibleSelected =
		eligibleIds.length > 0 && eligibleIds.every((rowId) => selected.has(rowId));
	const someEligibleSelected =
		!allEligibleSelected && eligibleIds.some((rowId) => selected.has(rowId));

	// ── Loading, error, empty ──
	if (query.isPending && userId) {
		return (
			<section
				id={id}
				aria-busy="true"
				className={cn("space-y-2", className)}
				data-testid="waiting-for-you"
			>
				{title ? <ListTitle id={headingId} title={title} /> : null}
				{[0, 1, 2].map((n) => (
					<div
						key={n}
						className="flex animate-pulse items-center gap-3 rounded-xl border border-border bg-card px-3 py-3"
					>
						<div className="h-7 w-7 rounded-full bg-muted" />
						<div className="flex-1 space-y-2">
							<div className="h-3 w-40 rounded bg-muted" />
							<div className="h-2.5 w-24 rounded bg-muted" />
						</div>
					</div>
				))}
			</section>
		);
	}

	if (query.isError) {
		const copy = timeErrorCopy(query.error, {
			subject: "scope",
			operation: "read",
		});
		return (
			<section id={id} className={className} data-testid="waiting-for-you">
				{title ? <ListTitle id={headingId} title={title} /> : null}
				<TimeReasonCard
					variant="inline"
					tone="danger"
					title={copy.message}
					action={
						<button
							type="button"
							className={SECONDARY}
							onClick={() => void query.refetch()}
						>
							Try again
						</button>
					}
				/>
			</section>
		);
	}

	if (rows.length === 0 && page === 1) {
		if (emptyText === null) return null;
		return (
			<section id={id} className={className} data-testid="waiting-for-you">
				{title ? <ListTitle id={headingId} title={title} count={0} /> : null}
				<p className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-3 text-sm text-muted-foreground">
					<Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
					{emptyText}
				</p>
			</section>
		);
	}

	const renderRow = (row: ApprovalRow, inGroup: boolean, name: string) => {
		const block = blocks.get(row.id) ?? null;
		const label = chipLabel(row.scope_label_snapshot ?? "");
		const period = formatPeriodRange(row.period_start, row.period_end, {
			timezone: row.timezone,
			now,
			userTimezone: tz,
		});
		const review = (row.flags?.needs_review ?? 0) + (row.flags?.running ?? 0);
		const over = row.flags?.over_cap_seconds ?? 0;
		const reviewTitle = [
			row.flags?.needs_review
				? `${row.flags.needs_review} ${row.flags.needs_review === 1 ? "entry needs" : "entries need"} review`
				: null,
			row.flags?.running
				? `${row.flags.running} ${row.flags.running === 1 ? "timer is" : "timers are"} still running`
				: null,
		]
			.filter(Boolean)
			.join(" · ");
		const reasonId = `${headingId}-${row.id}-reason`;
		return (
			<div
				key={row.id}
				className={cn(
					"flex items-center gap-3 px-3 py-2",
					inGroup && "pl-6 sm:pl-12",
				)}
				data-testid="waiting-row"
				data-sheet-id={row.id}
			>
				<label className={CHECK_HIT}>
					<input
						type="checkbox"
						className={CHECKBOX}
						aria-label={`Select ${name}'s timesheet, ${period}`}
						aria-describedby={block ? reasonId : undefined}
						title={block?.reason}
						checked={!block && selected.has(row.id)}
						disabled={Boolean(block) || bulkBusy}
						onChange={(e) => setMany([row.id], e.currentTarget.checked)}
					/>
				</label>
				{block ? (
					<span id={reasonId} className="sr-only">
						{block.reason}
					</span>
				) : null}
				{inGroup ? null : (
					<Avatar
						user={{
							id: row.member_user_id ?? row.id,
							display_name: name,
							avatar_url: row.member?.avatar_url ?? null,
							email: null,
							first_name: null,
							last_name: null,
						}}
						size="sm"
					/>
				)}
				<Link
					to="/time/timesheets/$timesheetId"
					params={{ timesheetId: row.id }}
					className="group flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-3"
				>
					{inGroup ? null : (
						<span className="truncate text-sm font-semibold text-foreground group-hover:text-primary sm:w-40 sm:shrink-0">
							{name}
						</span>
					)}
					{/* Wraps instead of overlapping: on a phone the period and the
					    workspace tag drop to the next line rather than run under
					    the hours. */}
					<span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground sm:text-sm">
						<span className="min-w-0 max-w-full truncate" title={label.title}>
							{label.text}
						</span>
						<span aria-hidden="true">·</span>
						<span className="shrink-0">{period}</span>
						{showTag(row) ? (
							<ForWorkspaceTag name={row.policy_workspace?.name} />
						) : null}
					</span>
					{/* Touch has no hover, so the checkbox's tooltip never shows:
					    phones read the reason under the row (screen readers get it
					    through the checkbox's description above). */}
					{block ? (
						<span
							aria-hidden="true"
							className="text-[11px] text-muted-foreground sm:hidden"
							data-testid="waiting-block-reason"
						>
							{block.reason}
						</span>
					) : null}
				</Link>
				<span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
					{formatClock(rowSeconds(row))}
				</span>
				<span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground sm:inline">
					{submittedAgo(row.submitted_at, { now, timezone: tz })}
				</span>
				{/* The flags column keeps its width from sm up so hours line up; on a
				    phone a row without flags gives the room back to the label. */}
				<span className="flex shrink-0 items-center justify-end gap-1.5 text-xs font-semibold max-sm:empty:hidden sm:w-16">
					{review > 0 ? (
						<span
							className="inline-flex items-center gap-0.5 text-warning"
							title={reviewTitle}
							data-testid="waiting-flags"
						>
							<AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
							{review}
							<span className="sr-only">{reviewTitle}</span>
						</span>
					) : null}
					{over > 0 ? (
						<span
							className="inline-flex items-center gap-0.5 text-warning"
							title={`${formatDurationText(over)} over the limit`}
							data-testid="waiting-over"
						>
							<Timer className="h-3.5 w-3.5" aria-hidden="true" />+
							{formatDurationText(over)}
						</span>
					) : null}
				</span>
			</div>
		);
	};

	const changedId =
		banner?.kind === "stale" && banner.timesheetId ? banner.timesheetId : null;

	return (
		<section
			id={id}
			aria-labelledby={title ? headingId : undefined}
			className={cn(
				"space-y-2",
				floatingBar && selectedCount > 0 && "pb-16",
				className,
			)}
			data-testid="waiting-for-you"
		>
			{title ? (
				<div className="flex flex-wrap items-center gap-2">
					<label className={CHECK_HIT}>
						<input
							type="checkbox"
							className={CHECKBOX}
							aria-label="Select every timesheet that can be approved"
							checked={allEligibleSelected}
							ref={(el) => {
								if (el) el.indeterminate = someEligibleSelected;
							}}
							disabled={eligibleIds.length === 0 || bulkBusy}
							onChange={(e) => setMany(eligibleIds, e.currentTarget.checked)}
						/>
					</label>
					<ListTitle id={headingId} title={title} count={total} />
					<button
						type="button"
						className={cn(PRIMARY, "ml-auto")}
						disabled={selectedCount === 0 || bulkBusy}
						onClick={() => setDialogOpen(true)}
					>
						{bulkBusy ? (
							<Loader2
								className="h-3.5 w-3.5 animate-spin"
								aria-hidden="true"
							/>
						) : (
							<Check className="h-3.5 w-3.5" aria-hidden="true" />
						)}
						{selectedCount > 0
							? `Approve selected (${selectedCount})`
							: "Approve selected"}
					</button>
				</div>
			) : null}

			{banner ? (
				<StaleRevisionBanner
					message={banner.message}
					actionLabel={changedId ? "Review" : null}
					reviewTimesheetId={changedId}
					tone={banner.kind === "stale" ? "warning" : "danger"}
					onDismiss={() => setBanner(null)}
				/>
			) : null}

			<ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
				{groups.map((group) =>
					group.rows.length === 1 ? (
						<li key={group.key}>
							{renderRow(group.rows[0], false, group.name)}
						</li>
					) : (
						<li key={group.key} data-testid="waiting-group">
							<GroupHeader
								group={group}
								eligible={group.rows
									.filter((row) => !blocks.get(row.id))
									.map((row) => row.id)}
								selected={selected}
								busy={bulkBusy}
								onToggle={setMany}
							/>
							<div className="divide-y divide-border/60">
								{group.rows.map((row) => renderRow(row, true, group.name))}
							</div>
						</li>
					),
				)}
			</ul>

			{total > limit ? (
				<div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
					<span>{`Page ${page} of ${Math.ceil(total / limit)}`}</span>
					<button
						type="button"
						className={SECONDARY}
						disabled={page <= 1 || query.isFetching}
						onClick={() => setPage((p) => Math.max(1, p - 1))}
					>
						Previous
					</button>
					<button
						type="button"
						className={SECONDARY}
						disabled={page * limit >= total || query.isFetching}
						onClick={() => setPage((p) => p + 1)}
					>
						Next
					</button>
				</div>
			) : null}

			{floatingBar && selectedCount > 0 ? (
				<div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
					<div
						className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-lg"
						data-testid="waiting-floating-bar"
					>
						<span className="px-1 text-xs font-semibold text-muted-foreground">
							{`${selectedCount} selected`}
						</span>
						<button
							type="button"
							className={PRIMARY}
							disabled={bulkBusy}
							onClick={() => setDialogOpen(true)}
						>
							Approve selected
						</button>
						<button
							type="button"
							className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
							onClick={() => setSelected(new Set())}
							disabled={bulkBusy}
						>
							Clear
						</button>
					</div>
				</div>
			) : null}

			<ApproveSelectedDialog
				open={dialogOpen}
				onClose={() => setDialogOpen(false)}
				count={selectedCount}
				busy={bulkBusy}
				onConfirm={(note) => void approveSelected(note)}
			/>
		</section>
	);
}

function ListTitle({
	id,
	title,
	count,
}: {
	id: string;
	title: string;
	count?: number;
}) {
	return (
		<h2
			id={id}
			className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
		>
			{count === undefined || count === 0 ? title : `${title} (${count})`}
		</h2>
	);
}

function GroupHeader({
	group,
	eligible,
	selected,
	busy,
	onToggle,
}: {
	group: ApprovalGroup;
	eligible: string[];
	selected: ReadonlySet<string>;
	busy: boolean;
	onToggle: (ids: readonly string[], on: boolean) => void;
}) {
	const all = eligible.length > 0 && eligible.every((id) => selected.has(id));
	const some = !all && eligible.some((id) => selected.has(id));
	const seconds = group.rows.reduce((sum, row) => sum + rowSeconds(row), 0);
	return (
		<div className="flex items-center gap-3 bg-surface-muted px-3 py-2">
			<label className={CHECK_HIT}>
				<input
					type="checkbox"
					className={CHECKBOX}
					aria-label={`Select ${group.name}'s timesheets`}
					checked={all}
					ref={(el) => {
						if (el) el.indeterminate = some;
					}}
					disabled={eligible.length === 0 || busy}
					onChange={(e) => onToggle(eligible, e.currentTarget.checked)}
				/>
			</label>
			<Avatar user={profileOf(group)} size="sm" />
			<span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
				{group.name}
				<span className="ml-2 text-xs font-normal text-muted-foreground">
					{`${group.rows.length} timesheets`}
				</span>
			</span>
			<span className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
				{formatClock(seconds)}
			</span>
			<span className="hidden w-20 shrink-0 sm:inline" />
			<span className="hidden w-16 shrink-0 sm:inline" />
		</div>
	);
}
