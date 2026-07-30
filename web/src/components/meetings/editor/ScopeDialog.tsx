/**
 * The meetings flavour of the shared recurring-scope prompt: which occurrences
 * an edit or cancel applies to. The dialog itself lives in
 * `components/common/ScopeDialog.tsx`; this only supplies the meeting copy.
 */
import {
	ScopeDialog as BaseScopeDialog,
	type ScopeOption,
} from "@/components/common/ScopeDialog";
import type { MeetingEditScope } from "@/services/meetings.service";

const OPTIONS: readonly ScopeOption<MeetingEditScope>[] = [
	{ scope: "this", label: "This event" },
	{ scope: "following", label: "This and following events" },
	{ scope: "all", label: "All events" },
];

interface ScopeDialogProps {
	open: boolean;
	action: "edit" | "cancel";
	onClose: () => void;
	onPick: (scope: MeetingEditScope) => void;
}

export function ScopeDialog({
	open,
	action,
	onClose,
	onPick,
}: ScopeDialogProps) {
	return (
		<BaseScopeDialog
			open={open}
			title={
				action === "edit" ? "Edit recurring event" : "Delete recurring event"
			}
			options={OPTIONS}
			onClose={onClose}
			onPick={onPick}
		/>
	);
}
