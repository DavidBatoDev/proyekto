import { ArrowDownUp } from "lucide-react";
import { useId } from "react";
import {
	DontAskAgainToggle,
	RoadmapConfirmShell,
} from "@/components/roadmap/shared/RoadmapConfirmShell";

interface FeatureReorderConfirmModalProps {
	isOpen: boolean;
	isSaving: boolean;
	featureTitle: string | null;
	dontAskAgain: boolean;
	onDontAskAgainChange: (value: boolean) => void;
	onCancel: () => void;
	onConfirm: () => Promise<void> | void;
}

export const FeatureReorderConfirmModal = ({
	isOpen,
	isSaving,
	featureTitle,
	dontAskAgain,
	onDontAskAgainChange,
	onCancel,
	onConfirm,
}: FeatureReorderConfirmModalProps) => {
	const checkboxId = useId();

	if (!featureTitle) return null;

	return (
		<RoadmapConfirmShell
			isOpen={isOpen}
			icon={ArrowDownUp}
			title="Confirm Feature Reorder"
			subtitle="Please confirm this change."
			closeLabel="Close reorder confirmation modal"
			isSaving={isSaving}
			onCancel={onCancel}
			onConfirm={onConfirm}
		>
			<p className="text-[17px] leading-relaxed text-foreground">
				Are you sure you want to reorder{" "}
				<span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-sm font-semibold text-foreground">
					{featureTitle}
				</span>
				?
			</p>
			<div className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
				This will update the feature order in this epic.
			</div>
			<DontAskAgainToggle
				id={checkboxId}
				checked={dontAskAgain}
				onChange={onDontAskAgainChange}
			/>
		</RoadmapConfirmShell>
	);
};
