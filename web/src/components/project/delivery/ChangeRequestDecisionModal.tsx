import { CalendarClock, CheckCircle2, Undo2, XCircle } from "lucide-react";
import { useRef, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import type { ChangeRequest } from "@/services/delivery.service";
import { changeRequestReference, timelineImpact } from "./changeRequestModel";
import {
	FieldError,
	FieldLabel,
	inputClassFor,
	PrimaryButton,
	SecondaryButton,
} from "./DeliveryPrimitives";

/**
 * Deciding a change request.
 *
 * The consequences are restated inside the dialog on purpose: nobody should
 * approve a scope change without seeing what it does to the schedule, and
 * relying on them having read the card behind the overlay is not the same thing.
 *
 * Rejecting requires a reason, for the same reason bouncing a deliverable does —
 * a bare "no" leaves the requester with nowhere to go. Approving does not.
 */
export function ChangeRequestDecisionModal({
	isOpen,
	request,
	pending,
	onClose,
	onDecide,
}: {
	isOpen: boolean;
	request: ChangeRequest;
	pending: boolean;
	onClose: () => void;
	onDecide: (
		decision: "approved" | "rejected" | "changes_requested",
		note?: string,
	) => void;
}) {
	const [note, setNote] = useState("");
	const [error, setError] = useState<string | null>(null);
	const noteRef = useRef<HTMLTextAreaElement>(null);

	const close = () => {
		setNote("");
		setError(null);
		onClose();
	};

	/** Paths where silence would leave the requester guessing. */
	const decideWithReason = (
		decision: "rejected" | "changes_requested",
		message: string,
	) => {
		if (!note.trim()) {
			setError(message);
			noteRef.current?.focus();
			return;
		}
		onDecide(decision, note.trim());
	};

	const impact = timelineImpact(request.impact_timeline_days);

	return (
		<AppDialog
			open={isOpen}
			onClose={close}
			busy={pending}
			size="lg"
			initialFocusRef={noteRef}
			title="Your decision"
			description={`${changeRequestReference(request)} · ${request.title}`}
			footer={
				<>
					<SecondaryButton
						onClick={() =>
							decideWithReason(
								"changes_requested",
								"Say what needs to change before sending it back.",
							)
						}
						disabled={pending}
					>
						<Undo2 className="h-3.5 w-3.5" />
						Request changes
					</SecondaryButton>
					<SecondaryButton
						tone="danger"
						onClick={() =>
							decideWithReason("rejected", "Say why this is being rejected.")
						}
						disabled={pending}
					>
						<XCircle className="h-3.5 w-3.5" />
						Reject
					</SecondaryButton>
					<PrimaryButton
						onClick={() => onDecide("approved", note.trim() || undefined)}
						loading={pending}
					>
						<CheckCircle2 className="h-4 w-4" />
						Approve
					</PrimaryButton>
				</>
			}
		>
			{/* What approving actually commits to, restated where the decision is made. */}
			<div className="mb-5 rounded-xl border border-border bg-muted/40 p-4">
				<p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
					Approving this will
				</p>
				<dl className="space-y-2.5 text-sm">
					<div className="flex items-baseline justify-between gap-4">
						<dt className="text-muted-foreground">Move the schedule by</dt>
						<dd className="font-semibold text-foreground">
							{impact ?? "Not estimated"}
						</dd>
					</div>
					{request.target_date_before && request.target_date_after && (
						<div className="flex items-baseline justify-between gap-4">
							<dt className="flex items-center gap-1.5 text-muted-foreground">
								<CalendarClock className="h-3.5 w-3.5" />
								Target date
							</dt>
							<dd className="font-semibold text-foreground">
								<span className="text-muted-foreground line-through decoration-muted-foreground/50">
									{request.target_date_before}
								</span>{" "}
								→ {request.target_date_after}
							</dd>
						</div>
					)}
					{(request.links?.length ?? 0) > 0 && (
						<div className="flex items-baseline justify-between gap-4">
							<dt className="text-muted-foreground">Affect</dt>
							<dd className="font-semibold text-foreground">
								{request.links?.length}{" "}
								{request.links?.length === 1 ? "linked item" : "linked items"}
							</dd>
						</div>
					)}
				</dl>
				{request.impact_scope && (
					<p className="mt-3 whitespace-pre-wrap border-t border-border pt-3 text-sm text-muted-foreground">
						{request.impact_scope}
					</p>
				)}
			</div>

			<FieldLabel>Note</FieldLabel>
			<textarea
				ref={noteRef}
				value={note}
				onChange={(event) => {
					setNote(event.target.value);
					if (error) setError(null);
				}}
				rows={4}
				className={inputClassFor(error)}
				aria-invalid={Boolean(error)}
				placeholder="Why you're approving, or what has to change first."
			/>
			<FieldError>{error}</FieldError>
			<p className="mt-2 text-[11px] text-muted-foreground">
				Optional when approving, required when rejecting or sending it back.
			</p>

			<p className="mt-4 rounded-lg bg-muted/50 p-3 text-[11px] text-muted-foreground">
				Approving records the decision. It does not edit the roadmap — that is a
				separate, deliberate step, so the change goes through the normal
				review-and-commit path.
			</p>
		</AppDialog>
	);
}
