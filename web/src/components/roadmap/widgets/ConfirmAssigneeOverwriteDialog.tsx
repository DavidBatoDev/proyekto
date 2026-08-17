import { UserRound } from "lucide-react";
import { RoadmapConfirmShell } from "@/components/roadmap/shared/RoadmapConfirmShell";

interface ConfirmAssigneeOverwriteDialogProps {
	isOpen: boolean;
	isSaving: boolean;
	currentAssigneeName: string | null;
	newAssigneeName: string | null;
	onCancel: () => void;
	onConfirm: () => Promise<void> | void;
}

export function ConfirmAssigneeOverwriteDialog({
	isOpen,
	isSaving,
	currentAssigneeName,
	newAssigneeName,
	onCancel,
	onConfirm,
}: ConfirmAssigneeOverwriteDialogProps) {
	if (!currentAssigneeName || !newAssigneeName) return null;

	return (
		<RoadmapConfirmShell
			isOpen={isOpen}
			icon={UserRound}
			title="Replace assignee?"
			subtitle="This task already has someone assigned."
			closeLabel="Close assignee confirmation dialog"
			isSaving={isSaving}
			confirmLabel="Replace assignee"
			onCancel={onCancel}
			onConfirm={onConfirm}
		>
			<p className="text-[15px] leading-relaxed text-foreground">
				Replace{" "}
				<span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-sm font-semibold text-foreground">
					{currentAssigneeName}
				</span>{" "}
				with{" "}
				<span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-sm font-semibold text-primary">
					{newAssigneeName}
				</span>
				?
			</p>
		</RoadmapConfirmShell>
	);
}
