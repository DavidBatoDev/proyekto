// web/src/components/time/edit/DeleteEntryModal.tsx
//
// Delete one of your own time entries (ported from TeamTimeModals'
// DeleteTimeLogModal onto AppDialog and theme tokens).
//
// - A locked entry (paid, billed, legacy, approved, or on a submitted or
//   approved timesheet) can't be deleted: the dialog says why and offers
//   only Close. The server refuses it too (409 TIMESHEET_LOCKED).
// - Deleting a running timer stops it (D61), and the running cache drops it
//   at once so the timer bar doesn't linger until the next poll.
// - A 404 means it is already gone (another tab, another device): that is the
//   outcome the person asked for, so it closes like a success.

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { entryLockCopy } from "@/components/time/entries/entryRules";
import { entryWorkLabel } from "@/components/time/for/forCopy";
import { TimeReasonCard } from "@/components/time/shared/TimeReasonCard";
import { useToast } from "@/hooks/useToast";
import { isNativeApp } from "@/lib/platform";
import { nativeSafe, timeErrorCopy } from "@/lib/timeErrors";
import {
	deviceTimeZone,
	formatClock,
	formatInstantDay,
	formatInstantTime,
} from "@/lib/timeFormat";
import { safeTimezone } from "@/lib/timePeriods";
import { invalidateTime, timeKeys } from "@/queries/time";
import { timeService, toTimeApiError } from "@/services/time.service";
import type { TimeEntryView } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";

export const DELETE_ENTRY_COPY = {
	title: "Delete time entry?",
	cancel: "Cancel",
	close: "Close",
	confirm: "Delete",
	deleting: "Deleting…",
	irreversible: "This can't be undone.",
	runningNote: "The timer is still running. Deleting it stops the timer.",
	deleted: "Time entry deleted.",
} as const;

/** "Delete this time entry for Fix login bug?" */
export function deleteEntryQuestion(
	entry: Pick<TimeEntryView, "task" | "work_item" | "content_label"> | null,
): string {
	const label = entry ? entryWorkLabel(entry) : "";
	return label
		? `Delete this time entry for ${label}?`
		: "Delete this time entry?";
}

/** "Thu Oct 1 · 09:00–12:30 · 3:30" ("now" while running). */
export function entrySpanLine(
	entry: Pick<TimeEntryView, "started_at" | "ended_at" | "duration_seconds">,
	timeZone: string,
): string {
	const day = formatInstantDay(entry.started_at, timeZone, { weekday: true });
	const start = formatInstantTime(entry.started_at, timeZone);
	const end = entry.ended_at
		? formatInstantTime(entry.ended_at, timeZone)
		: "now";
	const parts = [day, `${start}–${end}`];
	if (entry.ended_at) parts.push(formatClock(entry.duration_seconds));
	return parts.join(" · ");
}

export interface DeleteEntryModalProps {
	open: boolean;
	entry: TimeEntryView | null;
	onClose: () => void;
	/** After the entry is gone (deleted now, or already missing). */
	onDeleted?: (entryId: string) => void;
	/** The timezone the entry's day and times are shown in. Defaults to the device's. */
	timeZone?: string;
	/** AppDialog z-index; nested dialogs step up by 10. */
	zIndex?: number;
}

export function DeleteEntryModal({
	open,
	entry,
	onClose,
	onDeleted,
	timeZone,
	zIndex = 1200,
}: DeleteEntryModalProps) {
	const tz = safeTimezone(timeZone ?? deviceTimeZone());
	const queryClient = useQueryClient();
	const toast = useToast();
	const userId = useAuthStore((state) => state.user?.id ?? null);
	const native = isNativeApp();
	const [deleting, setDeleting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const cancelRef = useRef<HTMLButtonElement | null>(null);

	const entryId = entry?.id ?? "";
	useEffect(() => {
		if (!open) return;
		setDeleting(false);
		setError(null);
	}, [open, entryId]);

	const lockText = entry
		? entryLockCopy(entry, { timeZone: tz, native })
		: null;
	const running = Boolean(entry && !entry.ended_at);

	const finish = (target: TimeEntryView) => {
		queryClient.setQueryData<TimeEntryView | null>(
			timeKeys.running(userId),
			(current) => (current?.id === target.id ? null : current),
		);
		queryClient.removeQueries({ queryKey: timeKeys.entry(target.id) });
		void invalidateTime(queryClient, "entry");
		toast.success(DELETE_ENTRY_COPY.deleted);
		onDeleted?.(target.id);
		onClose();
	};

	const confirm = async () => {
		if (!entry || deleting || lockText) return;
		setDeleting(true);
		setError(null);
		try {
			await timeService.deleteEntry(entry.id);
			finish(entry);
		} catch (err) {
			const apiError = toTimeApiError(err);
			if (apiError.status === 404) {
				finish(entry);
				return;
			}
			setError(
				timeErrorCopy(err, {
					subject: "entry",
					operation: "write",
					label:
						entry.timesheet?.scope_label_snapshot ??
						entry.context_label_snapshot,
					labelKind: entry.context_kind,
				}).message,
			);
			if (apiError.code === "TIMESHEET_LOCKED") {
				void invalidateTime(queryClient, "entry");
			}
			setDeleting(false);
		}
	};

	return (
		<AppDialog
			open={open && Boolean(entry)}
			onClose={onClose}
			busy={deleting}
			size="sm"
			zIndex={zIndex}
			title={DELETE_ENTRY_COPY.title}
			hideCloseButton
			initialFocusRef={cancelRef}
			footer={
				<>
					<button
						ref={cancelRef}
						type="button"
						onClick={onClose}
						disabled={deleting}
						className="rounded-lg border border-input px-3.5 py-2 text-xs font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
					>
						{lockText ? DELETE_ENTRY_COPY.close : DELETE_ENTRY_COPY.cancel}
					</button>
					{lockText ? null : (
						<button
							type="button"
							onClick={() => void confirm()}
							disabled={deleting}
							className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3.5 py-2 text-xs font-semibold text-destructive-foreground transition hover:bg-destructive/90 disabled:opacity-50 dark:text-background"
						>
							{deleting ? (
								<Loader2
									className="h-3.5 w-3.5 animate-spin"
									aria-hidden="true"
								/>
							) : (
								<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
							)}
							{deleting
								? DELETE_ENTRY_COPY.deleting
								: DELETE_ENTRY_COPY.confirm}
						</button>
					)}
				</>
			}
		>
			{entry ? (
				<div className="space-y-3 text-sm">
					<p className="text-foreground">
						{nativeSafe(deleteEntryQuestion(entry), { native })}
					</p>
					<p className="text-xs tabular-nums text-muted-foreground">
						{entrySpanLine(entry, tz)}
					</p>
					{lockText ? (
						<TimeReasonCard variant="inline" tone="warning" title={lockText} />
					) : (
						<p className="text-xs text-muted-foreground">
							{running
								? `${DELETE_ENTRY_COPY.runningNote} ${DELETE_ENTRY_COPY.irreversible}`
								: DELETE_ENTRY_COPY.irreversible}
						</p>
					)}
					{error ? (
						<TimeReasonCard
							variant="inline"
							tone="danger"
							role="alert"
							title={error}
						/>
					) : null}
				</div>
			) : null}
		</AppDialog>
	);
}
