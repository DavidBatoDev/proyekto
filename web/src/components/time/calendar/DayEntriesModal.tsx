// web/src/components/time/calendar/DayEntriesModal.tsx
//
// One day of the month view (ported from team-time's DayLogsModal, own time
// only): every entry that day in the view's timezone, with the day total
// (⚠ over 8 h, the day strip's rule) and the row actions of the list.
//
// - Unlocked rows: View details, Edit, Change For…, Delete.
// - Locked rows (paid, billed, legacy, approved, or on a submitted or approved
//   timesheet) keep only View details and Comment (ux.md › Submit, Return,
//   Reopen), with a locked For chip that says why.
// - Footer: Add time for this day, and Start timer on today.
// - No amounts here (the entry detail carries cost), so nothing to strip on
//   native beyond labels.

import {
	AlertTriangle,
	Eye,
	MessageSquare,
	Pencil,
	Play,
	Plus,
	Repeat,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import {
	type ActionMenuItem,
	RowActionsMenu,
} from "@/components/team-time/RowActionsMenu";
import { entryLockCopy } from "@/components/time/edit/EditEntryModal";
import { ForChip } from "@/components/time/for/ForChip";
import { entryWorkLabel } from "@/components/time/for/forCopy";
import { forChipOptionFromEntry } from "@/components/time/for/forOptions";
import { isNativeApp } from "@/lib/platform";
import { nativeSafe } from "@/lib/timeErrors";
import {
	formatClock,
	formatInstantTime,
	formatLocalDay,
} from "@/lib/timeFormat";
import { todayIn } from "@/lib/timePeriods";
import { cn } from "@/lib/utils";
import type { TimeEntryView } from "@/services/time.types";

/** A day over this many seconds shows ⚠ (the day strip's rule, ux.md › Day strip). */
export const LONG_DAY_SECONDS = 8 * 3600;
/** An entry this long or longer joins Needs review (ux.md › Timer, CHANGE-22). */
export const NEEDS_REVIEW_SECONDS = 10 * 3600;

export const DAY_ENTRIES_COPY = {
	task: "Task",
	project: "Project",
	for: "For",
	in: "In",
	out: "Out",
	duration: "Dur",
	now: "now",
	empty: "No time on this day.",
	addTime: "Add time",
	startTimer: "Start timer",
	close: "Close",
	viewDetails: "View details",
	comment: "Comment",
	edit: "Edit",
	changeFor: "Change For…",
	delete: "Delete",
	needsReview: "Needs review",
	longDay: "Over 8 hours",
	paid: "Paid",
	billed: "Billed",
	actions: "Entry actions",
} as const;

/** "1 entry" / "3 entries". */
export function entryCountText(count: number): string {
	return `${count} ${count === 1 ? "entry" : "entries"}`;
}

/**
 * An entry's seconds as of `nowMs`: its stored duration, or for a running
 * timer the time since it started (frozen at the break while paused) minus
 * the banked break.
 */
export function entrySeconds(
	entry: Pick<
		TimeEntryView,
		| "started_at"
		| "ended_at"
		| "paused_at"
		| "duration_seconds"
		| "break_seconds"
	>,
	nowMs: number = Date.now(),
): number {
	if (entry.ended_at) return Math.max(0, entry.duration_seconds ?? 0);
	const start = Date.parse(entry.started_at);
	const until = entry.paused_at ? Date.parse(entry.paused_at) : nowMs;
	if (!Number.isFinite(start) || !Number.isFinite(until)) return 0;
	return Math.max(
		0,
		Math.floor((until - start) / 1000) - Math.max(0, entry.break_seconds ?? 0),
	);
}

/** ≥ 10 h, or flagged by the cron (auto-stopped, agreement ended). */
export function needsReview(
	entry: Pick<
		TimeEntryView,
		| "started_at"
		| "ended_at"
		| "paused_at"
		| "duration_seconds"
		| "break_seconds"
		| "flagged_reason"
	>,
	nowMs?: number,
): boolean {
	return (
		Boolean(entry.flagged_reason) ||
		entrySeconds(entry, nowMs) >= NEEDS_REVIEW_SECONDS
	);
}

/**
 * The "⋯" menu portals to the body, so it must sit above this dialog (1200)
 * and the dialogs it opens (1210). A static class: Tailwind only generates
 * classes it can read in the source.
 */
const ROW_MENU_Z_CLASS = "z-1400";

/** What the open entry asks the page to do next. */
export interface OpenEntryContext {
	/** Render the entry detail above this dialog. */
	zIndex: number;
	/** "Comment": open the detail with its comment thread focused. */
	focus?: "comments";
}

export interface DayEntriesModalProps {
	open: boolean;
	/** The local date (YYYY-MM-DD) in `timeZone`. */
	date: string | null;
	/** That day's entries (any order; shown by start time). */
	entries: readonly TimeEntryView[];
	timeZone: string;
	/** The entry that was clicked to open the day, highlighted. */
	highlightEntryId?: string | null;
	onClose: () => void;
	onOpenEntry?: (entry: TimeEntryView, ctx: OpenEntryContext) => void;
	onEditEntry?: (entry: TimeEntryView) => void;
	onChangeFor?: (entry: TimeEntryView) => void;
	onDeleteEntry?: (entry: TimeEntryView) => void;
	/** "Add time" for this day (the day modal closes first). */
	onAddTime?: (date: string) => void;
	/** "Start timer", offered on today only (the day modal closes first). */
	onStartTimer?: () => void;
	/** AppDialog z-index; the row actions' dialogs and the detail go 10 above. */
	zIndex?: number;
	/** "Now" for running totals and "today" (tests). */
	nowMs?: number;
}

export function DayEntriesModal({
	open,
	date,
	entries,
	timeZone,
	highlightEntryId,
	onClose,
	onOpenEntry,
	onEditEntry,
	onChangeFor,
	onDeleteEntry,
	onAddTime,
	onStartTimer,
	zIndex = 1200,
	nowMs,
}: DayEntriesModalProps) {
	const native = isNativeApp();
	const [openMenuRowId, setOpenMenuRowId] = useState<string | null>(null);
	const now = nowMs ?? Date.now();
	const rows = [...entries].sort(
		(a, b) => Date.parse(a.started_at) - Date.parse(b.started_at),
	);
	const total = rows.reduce((sum, entry) => sum + entrySeconds(entry, now), 0);
	const longDay = total > LONG_DAY_SECONDS;
	const isToday = date ? todayIn(timeZone, new Date(now)) === date : false;
	const childZ = zIndex + 10;

	const title = date ? formatLocalDay(date, { weekday: true }) : "";

	const actionsFor = (entry: TimeEntryView): ActionMenuItem[] => {
		const locked = Boolean(entry.locked_reason);
		const items: ActionMenuItem[] = [];
		if (onOpenEntry) {
			items.push({
				id: "view",
				label: DAY_ENTRIES_COPY.viewDetails,
				icon: <Eye className="h-3.5 w-3.5" />,
				onSelect: () => onOpenEntry(entry, { zIndex: childZ }),
			});
		}
		if (locked) {
			if (onOpenEntry) {
				items.push({
					id: "comment",
					label: DAY_ENTRIES_COPY.comment,
					icon: <MessageSquare className="h-3.5 w-3.5" />,
					onSelect: () =>
						onOpenEntry(entry, { zIndex: childZ, focus: "comments" }),
				});
			}
			return items;
		}
		if (onEditEntry) {
			items.push({
				id: "edit",
				label: DAY_ENTRIES_COPY.edit,
				icon: <Pencil className="h-3.5 w-3.5" />,
				onSelect: () => onEditEntry(entry),
			});
		}
		if (onChangeFor && entry.project_id) {
			items.push({
				id: "change-for",
				label: DAY_ENTRIES_COPY.changeFor,
				icon: <Repeat className="h-3.5 w-3.5" />,
				onSelect: () => onChangeFor(entry),
			});
		}
		if (onDeleteEntry) {
			items.push({
				id: "delete",
				label: DAY_ENTRIES_COPY.delete,
				icon: <Trash2 className="h-3.5 w-3.5" />,
				tone: "danger",
				onSelect: () => onDeleteEntry(entry),
			});
		}
		return items;
	};

	const showFooterActions = Boolean(
		date && (onAddTime || (onStartTimer && isToday)),
	);

	return (
		<AppDialog
			open={open && Boolean(date)}
			onClose={onClose}
			size="xl"
			zIndex={zIndex}
			title={title}
			description={
				<span className="inline-flex items-center gap-1.5">
					{entryCountText(rows.length)}
					<span aria-hidden="true">·</span>
					<span className="tabular-nums">{formatClock(total, "0:00")}</span>
					{longDay ? (
						<AlertTriangle
							className="h-3.5 w-3.5 text-warning-foreground"
							aria-label={DAY_ENTRIES_COPY.longDay}
						/>
					) : null}
				</span>
			}
			footer={
				<>
					{showFooterActions && date ? (
						<div className="mr-auto flex items-center gap-1.5">
							{onAddTime ? (
								<button
									type="button"
									onClick={() => {
										onClose();
										onAddTime(date);
									}}
									className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
								>
									<Plus className="h-3.5 w-3.5" aria-hidden="true" />
									{DAY_ENTRIES_COPY.addTime}
								</button>
							) : null}
							{onStartTimer && isToday ? (
								<button
									type="button"
									onClick={() => {
										onClose();
										onStartTimer();
									}}
									className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
								>
									<Play className="h-3.5 w-3.5" aria-hidden="true" />
									{DAY_ENTRIES_COPY.startTimer}
								</button>
							) : null}
						</div>
					) : null}
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted"
					>
						{DAY_ENTRIES_COPY.close}
					</button>
				</>
			}
		>
			{rows.length === 0 ? (
				<p className="py-6 text-center text-sm text-muted-foreground">
					{DAY_ENTRIES_COPY.empty}
				</p>
			) : (
				<div className="-mx-5 -my-4 max-h-[60vh] overflow-y-auto">
					<table className="w-full text-xs">
						<thead className="sticky top-0 z-10 bg-card">
							<tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
								<th className="px-3 py-2 font-semibold">
									{DAY_ENTRIES_COPY.task}
								</th>
								<th className="hidden px-2 py-2 font-semibold md:table-cell">
									{DAY_ENTRIES_COPY.project}
								</th>
								<th className="hidden px-2 py-2 font-semibold sm:table-cell">
									{DAY_ENTRIES_COPY.for}
								</th>
								<th className="hidden px-2 py-2 font-semibold sm:table-cell">
									{DAY_ENTRIES_COPY.in}
								</th>
								<th className="hidden px-2 py-2 font-semibold sm:table-cell">
									{DAY_ENTRIES_COPY.out}
								</th>
								<th className="px-2 py-2 text-right font-semibold">
									{DAY_ENTRIES_COPY.duration}
								</th>
								<th className="w-10 px-2 py-2">
									<span className="sr-only">{DAY_ENTRIES_COPY.actions}</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((entry) => (
								<DayEntryRow
									key={entry.id}
									entry={entry}
									timeZone={timeZone}
									highlighted={entry.id === highlightEntryId}
									native={native}
									nowMs={now}
									items={actionsFor(entry)}
									openMenuRowId={openMenuRowId}
									onSetOpenMenuRowId={setOpenMenuRowId}
									onOpen={
										onOpenEntry
											? () => onOpenEntry(entry, { zIndex: childZ })
											: undefined
									}
								/>
							))}
						</tbody>
					</table>
				</div>
			)}
		</AppDialog>
	);
}

function DayEntryRow({
	entry,
	timeZone,
	highlighted,
	native,
	nowMs,
	items,
	openMenuRowId,
	onSetOpenMenuRowId,
	onOpen,
}: {
	entry: TimeEntryView;
	timeZone: string;
	highlighted: boolean;
	native: boolean;
	nowMs: number;
	items: ActionMenuItem[];
	openMenuRowId: string | null;
	onSetOpenMenuRowId: (id: string | null) => void;
	onOpen?: () => void;
}) {
	const running = !entry.ended_at;
	const lockText = entryLockCopy(entry, { timeZone, native });
	const option = forChipOptionFromEntry(entry);
	const forChip = (
		<ForChip
			option={{ ...option, label: nativeSafe(option.label, { native }) }}
			variant={lockText ? "locked" : "readonly"}
			lockedText={lockText}
		/>
	);
	const label = nativeSafe(entryWorkLabel(entry), { native });
	const preset = entry.work_item !== "task" && !entry.task;
	const project =
		entry.content === "hidden"
			? null
			: entry.project?.title
				? nativeSafe(entry.project.title, { native })
				: null;
	const billed =
		!native && entry.locked_reason === "billed" && entry.cost === "visible";
	const review = needsReview(entry, nowMs);

	return (
		<tr
			className={cn(
				"time-row-in border-t border-border/70",
				highlighted ? "bg-primary/5" : "hover:bg-muted/50",
			)}
			data-entry-id={entry.id}
			data-highlighted={highlighted ? "true" : undefined}
		>
			<td className="max-w-56 px-3 py-2 align-middle">
				{onOpen ? (
					<button
						type="button"
						onClick={onOpen}
						className="block max-w-full truncate text-left font-medium text-foreground hover:underline"
						title={label}
					>
						{preset ? (
							<span aria-hidden="true" className="mr-1 text-muted-foreground">
								◦
							</span>
						) : null}
						{label}
					</button>
				) : (
					<span
						className="block truncate font-medium text-foreground"
						title={label}
					>
						{preset ? (
							<span aria-hidden="true" className="mr-1 text-muted-foreground">
								◦
							</span>
						) : null}
						{label}
					</span>
				)}
				<span className="mt-0.5 flex flex-wrap items-center gap-1 sm:hidden">
					{forChip}
				</span>
				{project ? (
					<span className="block truncate text-[11px] text-muted-foreground md:hidden">
						{project}
					</span>
				) : null}
				<span className="block text-[11px] tabular-nums text-muted-foreground sm:hidden">
					{formatInstantTime(entry.started_at, timeZone)}–
					{running
						? DAY_ENTRIES_COPY.now
						: formatInstantTime(entry.ended_at, timeZone)}
				</span>
			</td>
			<td className="hidden max-w-40 px-2 py-2 align-middle md:table-cell">
				<span
					className="block truncate text-muted-foreground"
					title={project ?? ""}
				>
					{project ?? "—"}
				</span>
			</td>
			<td className="hidden px-2 py-2 align-middle sm:table-cell">{forChip}</td>
			<td className="hidden px-2 py-2 align-middle tabular-nums text-muted-foreground sm:table-cell">
				{formatInstantTime(entry.started_at, timeZone)}
			</td>
			<td className="hidden px-2 py-2 align-middle tabular-nums text-muted-foreground sm:table-cell">
				{running ? (
					<span className="text-primary">{DAY_ENTRIES_COPY.now}</span>
				) : (
					formatInstantTime(entry.ended_at, timeZone)
				)}
			</td>
			<td className="px-2 py-2 text-right align-middle">
				<span className="inline-flex items-center justify-end gap-1.5">
					{review ? (
						<AlertTriangle
							className="h-3.5 w-3.5 text-warning-foreground"
							aria-label={DAY_ENTRIES_COPY.needsReview}
						/>
					) : null}
					{entry.payout_id ? (
						<span className="rounded bg-info/10 px-1.5 py-0.5 text-[10px] font-semibold text-info-foreground">
							{DAY_ENTRIES_COPY.paid}
						</span>
					) : billed ? (
						<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
							{DAY_ENTRIES_COPY.billed}
						</span>
					) : null}
					<span className="font-semibold tabular-nums text-foreground">
						{formatClock(entrySeconds(entry, nowMs), "0:00")}
					</span>
				</span>
			</td>
			<td className="px-2 py-2 text-right align-middle">
				{items.length > 0 ? (
					<RowActionsMenu
						rowId={entry.id}
						openMenuRowId={openMenuRowId}
						onSetOpenMenuRowId={onSetOpenMenuRowId}
						items={items}
						menuZIndexClassName={ROW_MENU_Z_CLASS}
					/>
				) : null}
			</td>
		</tr>
	);
}
