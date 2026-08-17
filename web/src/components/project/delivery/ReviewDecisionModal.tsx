import { CheckCircle2, Undo2 } from "lucide-react";
import { useRef, useState } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import {
	FieldError,
	FieldLabel,
	inputClassFor,
	PrimaryButton,
	SecondaryButton,
} from "./DeliveryPrimitives";

/**
 * Casting a review decision.
 *
 * Lives in a dialog rather than inline on the card so a card's height never
 * depends on whether the viewer happens to be a reviewer — and because a
 * decision with a written note deserves more than a two-row textarea wedged
 * between other deliverables.
 */
export function ReviewDecisionModal({
	isOpen,
	title,
	pending,
	onClose,
	onDecide,
}: {
	isOpen: boolean;
	/** The deliverable being decided, named in the dialog header. */
	title: string;
	pending: boolean;
	onClose: () => void;
	onDecide: (decision: "approved" | "changes_requested", note?: string) => void;
}) {
	const [note, setNote] = useState("");
	const [error, setError] = useState<string | null>(null);
	const noteRef = useRef<HTMLTextAreaElement>(null);

	const close = () => {
		setNote("");
		setError(null);
		onClose();
	};

	return (
		<AppDialog
			open={isOpen}
			onClose={close}
			busy={pending}
			initialFocusRef={noteRef}
			title="Your decision"
			description={title}
			footer={
				<>
					<SecondaryButton
						// Bouncing work back without saying why leaves the owner
						// guessing, so the note is required on this path only.
						onClick={() => {
							if (!note.trim()) {
								setError("Say what needs to change before requesting changes.");
								noteRef.current?.focus();
								return;
							}
							onDecide("changes_requested", note.trim());
						}}
						disabled={pending}
					>
						<Undo2 className="h-3.5 w-3.5" />
						Request changes
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
				placeholder="What needs to change, or why you're accepting it."
			/>
			<FieldError>{error}</FieldError>
			<p className="mt-2 text-[11px] text-muted-foreground">
				Optional when approving, required when requesting changes.
			</p>
		</AppDialog>
	);
}
