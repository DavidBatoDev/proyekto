/**
 * "End assignment" on the engagement page (ux.md › Engagement page, L37).
 *
 * The end defaults to now; it may be backdated, but never into the future,
 * before the start, or before time already logged under it (the server says
 * which). Ending stops the worker's running timer at the end time, and the
 * dialog says so before anything happens. An assignment that already ended
 * elsewhere closes the dialog and refreshes the list instead of failing.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { FieldLabel } from "@/components/common/FormFields";
import { useToast } from "@/hooks/useToast";
import {
	ASSIGNMENT_END_REASON_MAX,
	type EngagementAssignment,
	engagementAssignmentsService,
} from "@/services/engagementAssignments.service";
import {
	ASSIGNMENT_COPY,
	assignmentErrorCopy,
	endDialogDescription,
	endedToast,
	endWarningCopy,
	isAlreadyEndedError,
	localInputToIso,
	nowLocalInput,
} from "./assignmentCopy";
import { invalidateAfterAssignmentChange } from "./useEngagementAssignments";

const INPUT_CLASS =
	"w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70";

export interface EndAssignmentDialogProps {
	engagementId: string;
	assignment: EngagementAssignment;
	/** The worker's name; null when it is the viewer's own assignment. */
	workerName: string | null;
	onClose: () => void;
	/** After the end (or after finding it already ended); the list is refreshing. */
	onEnded: () => void;
}

export function EndAssignmentDialog({
	engagementId,
	assignment,
	workerName,
	onClose,
	onEnded,
}: EndAssignmentDialogProps) {
	const queryClient = useQueryClient();
	const toast = useToast();
	const endId = useId();
	const reasonId = useId();
	const [end, setEnd] = useState("");
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);

	const refresh = () =>
		invalidateAfterAssignmentChange(
			queryClient,
			engagementId,
			assignment.project_id,
		);

	const mutation = useMutation({
		mutationFn: () =>
			engagementAssignmentsService.end(engagementId, assignment.id, {
				ended_at: localInputToIso(end),
				reason,
			}),
		onSuccess: async () => {
			toast.success(endedToast(assignment.project_title_snapshot));
			await refresh();
			onEnded();
		},
		onError: async (err) => {
			if (isAlreadyEndedError(err)) {
				toast.info(ASSIGNMENT_COPY.alreadyEnded);
				await refresh();
				onEnded();
				return;
			}
			setError(assignmentErrorCopy(err, { workerName, operation: "end" }));
		},
	});

	const submit = () => {
		if (mutation.isPending) return;
		setError(null);
		mutation.mutate();
	};

	return (
		<AppDialog
			open
			onClose={onClose}
			busy={mutation.isPending}
			title={ASSIGNMENT_COPY.endTitle}
			description={endDialogDescription(
				workerName,
				assignment.project_title_snapshot,
			)}
			footer={
				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						disabled={mutation.isPending}
						className="rounded-lg border border-border px-3.5 py-2 text-sm font-semibold text-foreground hover:bg-muted"
					>
						{ASSIGNMENT_COPY.cancel}
					</button>
					<button
						type="button"
						onClick={submit}
						disabled={mutation.isPending}
						className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3.5 py-2 text-sm font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
					>
						{mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
						{mutation.isPending
							? ASSIGNMENT_COPY.ending
							: ASSIGNMENT_COPY.endConfirm}
					</button>
				</div>
			}
		>
			<div className="space-y-4">
				<p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-foreground">
					<TriangleAlert
						aria-hidden
						className="mt-0.5 h-4 w-4 shrink-0 text-warning"
					/>
					<span>{endWarningCopy(workerName)}</span>
				</p>

				<FieldLabel label={ASSIGNMENT_COPY.endLabel} optional>
					<input
						id={endId}
						aria-label={ASSIGNMENT_COPY.endLabel}
						type="datetime-local"
						value={end}
						max={nowLocalInput()}
						onChange={(e) => setEnd(e.target.value)}
						className={INPUT_CLASS}
					/>
					<p className="mt-1.5 text-xs text-muted-foreground">
						{ASSIGNMENT_COPY.endHint}
					</p>
				</FieldLabel>

				<FieldLabel label={ASSIGNMENT_COPY.reasonLabel} optional>
					<textarea
						id={reasonId}
						aria-label={ASSIGNMENT_COPY.reasonLabel}
						value={reason}
						rows={2}
						maxLength={ASSIGNMENT_END_REASON_MAX}
						placeholder={ASSIGNMENT_COPY.reasonPlaceholder}
						onChange={(e) => setReason(e.target.value)}
						className={`${INPUT_CLASS} resize-none`}
					/>
				</FieldLabel>

				{error && (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				)}
			</div>
		</AppDialog>
	);
}
