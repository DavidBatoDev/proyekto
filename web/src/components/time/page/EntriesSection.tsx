// web/src/components/time/page/EntriesSection.tsx
//
// The Time page's entry list (ux.md › The Time Page): W1-1's
// `TimeEntriesTable` in `mine` mode, with the filters the page adds on top:
//
//   - a day picked in the strip ("Thu Oct 2 · Show the whole week");
//   - Fix on a Returned card: the list shows that sheet's entries only, so
//     its rows can be corrected before Resubmit.
//
// Needs review, the For column, locks, selection (Change For…) and the row
// menu all live in the table; this section supplies the callbacks.
//
// `useChangeEntryTask` is the write behind the row's "Change task": a PATCH
// of `task_id` (or a preset `work_item`) with `expected_updated_at`. Only the
// task changes, so a stale copy is re-read and retried once (nothing the
// person typed can be lost), unless the fresh copy has locked meanwhile.

import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { useToast } from "@/hooks/useToast";
import { entryWarningsCopy, timeErrorMessage } from "@/lib/timeErrors";
import { cn } from "@/lib/utils";
import { invalidateTime, timeKeys } from "@/queries/time";
import { isTimeApiError, timeService } from "@/services/time.service";
import type {
	TimeEntryView,
	UpdatedEntry,
	UpdateEntryInput,
} from "@/services/time.types";
import { type EntrySheetInfo, isEntryLocked } from "../entries/entryRules";
import { TimeEntriesTable } from "../entries/TimeEntriesTable";
import type { TaskPickerSelection } from "../forms/TaskPickerModal";
import { TimeReasonCard } from "../shared/TimeReasonCard";

export const ENTRIES_SECTION_COPY = {
	title: "Time entries",
	showWeek: "Show the whole week",
	showAll: "Show all entries",
	fixing: (label: string, period: string) =>
		`Showing the ${label} timesheet for ${period}. Change what the note asks for, then Resubmit.`,
	retry: "Try again",
	taskChanged: "Time entry updated.",
	changeTaskTitle: "Change task",
	changeTaskDescription: "Pick the task or preset this time was for.",
	changeTaskConfirm: "Change task",
} as const;

export interface EntriesSectionProps {
	entries: readonly TimeEntryView[];
	loading?: boolean;
	error?: unknown;
	onRetry?: () => void;
	timeZone: string;
	/** The person's sheets, for the submitted date on locked chips. */
	sheets?: readonly EntrySheetInfo[];
	/** The day picked in the strip (already applied to `entries`). */
	day?: { date: string; label: string } | null;
	onClearDay?: () => void;
	/** Fix on a Returned card (already applied to `entries`). */
	fixing?: { label: string; period: string } | null;
	onClearFix?: () => void;
	/** Rendered when there is nothing to list. */
	empty?: ReactNode;
	pendingIds?: ReadonlySet<string> | readonly string[];
	selectedIds?: ReadonlySet<string>;
	onSelectionChange?: (ids: Set<string>) => void;
	onOpenEntry?: (
		entry: TimeEntryView,
		options?: { focus?: "comments" },
	) => void;
	onStop?: (entry: TimeEntryView) => void;
	onEdit?: (entry: TimeEntryView) => void;
	onChangeTask?: (entry: TimeEntryView) => void;
	onChangeFor?: (entries: TimeEntryView[]) => void;
	onDelete?: (entry: TimeEntryView) => void;
	onOpenTask?: (entry: TimeEntryView) => void;
	canOpenTask?: (entry: TimeEntryView) => boolean;
	projectWorkspaceName?: string | null;
	className?: string;
}

const CHIP_BUTTON =
	"inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

export function EntriesSection({
	entries,
	loading = false,
	error,
	onRetry,
	timeZone,
	sheets,
	day,
	onClearDay,
	fixing,
	onClearFix,
	empty,
	pendingIds,
	selectedIds,
	onSelectionChange,
	onOpenEntry,
	onStop,
	onEdit,
	onChangeTask,
	onChangeFor,
	onDelete,
	onOpenTask,
	canOpenTask,
	projectWorkspaceName,
	className,
}: EntriesSectionProps) {
	return (
		<section
			aria-labelledby="time-entries-heading"
			className={cn("space-y-2", className)}
			data-testid="time-entries"
		>
			<h2 id="time-entries-heading" className="sr-only">
				{ENTRIES_SECTION_COPY.title}
			</h2>

			{fixing ? (
				<div
					role="status"
					className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground"
					data-testid="fix-filter"
				>
					<span className="min-w-0 flex-1">
						{ENTRIES_SECTION_COPY.fixing(fixing.label, fixing.period)}
					</span>
					{onClearFix ? (
						<button type="button" className={CHIP_BUTTON} onClick={onClearFix}>
							<X className="h-3.5 w-3.5" aria-hidden="true" />
							{ENTRIES_SECTION_COPY.showAll}
						</button>
					) : null}
				</div>
			) : null}

			{day ? (
				<div
					className="flex flex-wrap items-center gap-2 text-xs"
					data-testid="day-filter"
				>
					<span className="rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-foreground">
						{day.label}
					</span>
					{onClearDay ? (
						<button type="button" className={CHIP_BUTTON} onClick={onClearDay}>
							<X className="h-3.5 w-3.5" aria-hidden="true" />
							{ENTRIES_SECTION_COPY.showWeek}
						</button>
					) : null}
				</div>
			) : null}

			{error ? (
				<TimeReasonCard
					variant="inline"
					tone="danger"
					role="alert"
					title={timeErrorMessage(error, {
						operation: "read",
						subject: "entry",
					})}
					action={
						onRetry ? (
							<button
								type="button"
								onClick={onRetry}
								className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
							>
								{ENTRIES_SECTION_COPY.retry}
							</button>
						) : null
					}
				/>
			) : (
				<TimeEntriesTable
					entries={entries}
					mode="mine"
					loading={loading}
					timeZone={timeZone}
					sheets={sheets}
					pendingIds={pendingIds}
					empty={empty}
					onOpenEntry={onOpenEntry}
					onStop={onStop}
					onEdit={onEdit}
					onChangeTask={onChangeTask}
					onChangeFor={onChangeFor}
					onDelete={onDelete}
					onOpenTask={onOpenTask}
					canOpenTask={canOpenTask}
					projectWorkspaceName={projectWorkspaceName}
					selection={
						selectedIds && onSelectionChange
							? { selectedIds, onChange: onSelectionChange }
							: undefined
					}
				/>
			)}
		</section>
	);
}

// ── Change task ─────────────────────────────────────────────────────────────

/** The PATCH body for a new task or preset, or null when nothing changes. */
export function changeTaskBody(
	entry: Pick<TimeEntryView, "task_id" | "work_item">,
	selection: Pick<TaskPickerSelection, "taskId" | "workItem">,
): Omit<UpdateEntryInput, "expected_updated_at"> | null {
	if (selection.taskId) {
		return selection.taskId === entry.task_id
			? null
			: { task_id: selection.taskId };
	}
	const preset = selection.workItem ?? "other";
	if (!entry.task_id && entry.work_item === preset) return null;
	return { task_id: null, work_item: preset };
}

export function useChangeEntryTask() {
	const queryClient = useQueryClient();
	const toast = useToast();
	const [pendingId, setPendingId] = useState<string | null>(null);

	const change = useCallback(
		async (
			entry: TimeEntryView,
			selection: Pick<TaskPickerSelection, "taskId" | "workItem">,
		): Promise<boolean> => {
			const body = changeTaskBody(entry, selection);
			if (!body) return true;
			setPendingId(entry.id);
			try {
				let updated: UpdatedEntry;
				try {
					updated = await timeService.updateEntry(entry.id, {
						...body,
						expected_updated_at: entry.updated_at,
					});
				} catch (error) {
					if (!isTimeApiError(error, "STALE_REVISION")) throw error;
					const fresh = await timeService.getEntry(entry.id);
					if (isEntryLocked(fresh)) throw error;
					updated = await timeService.updateEntry(entry.id, {
						...body,
						expected_updated_at: fresh.updated_at,
					});
				}
				queryClient.setQueryData(timeKeys.entry(entry.id), updated);
				void invalidateTime(queryClient, "entry");
				toast.success(ENTRIES_SECTION_COPY.taskChanged);
				for (const line of entryWarningsCopy(updated.warnings, {
					agreementLabel:
						updated.context_kind === "assignment"
							? updated.context_label_snapshot
							: null,
				})) {
					toast.warning(line);
				}
				return true;
			} catch (error) {
				toast.error(
					timeErrorMessage(error, { subject: "entry", operation: "write" }),
				);
				return false;
			} finally {
				setPendingId(null);
			}
		},
		[queryClient, toast],
	);

	return { change, pendingId };
}
