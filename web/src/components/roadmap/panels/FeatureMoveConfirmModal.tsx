import { ArrowRightLeft } from "lucide-react";
import { useId } from "react";
import {
	DontAskAgainToggle,
	RoadmapConfirmShell,
} from "@/components/roadmap/shared/RoadmapConfirmShell";

interface FeatureMoveConfirmModalProps {
	isOpen: boolean;
	isSaving: boolean;
	featureTitle: string | null;
	targetEpicTitle: string | null;
	dontAskAgain: boolean;
	onDontAskAgainChange: (value: boolean) => void;
	onCancel: () => void;
	onConfirm: () => Promise<void> | void;
}

export const FeatureMoveConfirmModal = ({
	isOpen,
	isSaving,
	featureTitle,
	targetEpicTitle,
	dontAskAgain,
	onDontAskAgainChange,
	onCancel,
	onConfirm,
}: FeatureMoveConfirmModalProps) => {
	const checkboxId = useId();

	if (!featureTitle) return null;

	return (
		<RoadmapConfirmShell
			isOpen={isOpen}
			icon={ArrowRightLeft}
			title="Move Feature to Epic"
			subtitle="Please confirm this change."
			closeLabel="Close move confirmation modal"
			isSaving={isSaving}
			onCancel={onCancel}
			onConfirm={onConfirm}
		>
			<p className="text-[17px] leading-relaxed text-foreground">
				Move{" "}
				<span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-sm font-semibold text-foreground">
					{featureTitle}
				</span>
				{targetEpicTitle && (
					<>
						{" "}
						to epic{" "}
						<span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-sm font-semibold text-foreground">
							{targetEpicTitle}
						</span>
					</>
				)}
				?
			</p>
			<div className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
				This will reassign the feature to the target epic.
			</div>
			<DontAskAgainToggle
				id={checkboxId}
				checked={dontAskAgain}
				onChange={onDontAskAgainChange}
			/>
		</RoadmapConfirmShell>
	);
};
