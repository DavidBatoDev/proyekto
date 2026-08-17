import { CalendarRange } from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
	DontAskAgainToggle,
	RoadmapConfirmShell,
} from "@/components/roadmap/shared/RoadmapConfirmShell";

interface FeatureDateChangeConfirmModalProps {
	isOpen: boolean;
	isSaving: boolean;
	change: DateChangeConfirmPayload | null;
	dontAskAgain: boolean;
	onDontAskAgainChange: (value: boolean) => void;
	onCancel: () => void;
	onConfirm: () => Promise<void> | void;
}

export type DateChangeConfirmPayload = {
	entityLabel: string;
	oldStartDate: string;
	oldEndDate: string;
	newStartDate: string;
	newEndDate: string;
};

export const FeatureDateChangeConfirmModal = ({
	isOpen,
	isSaving,
	change,
	dontAskAgain,
	onDontAskAgainChange,
	onCancel,
	onConfirm,
}: FeatureDateChangeConfirmModalProps) => {
	const inputId = useId();
	// Hold the last payload so the body doesn't blank out mid-exit-transition.
	const [displayChange, setDisplayChange] =
		useState<DateChangeConfirmPayload | null>(change);

	useEffect(() => {
		if (isOpen && change) setDisplayChange(change);
	}, [isOpen, change]);

	if (!displayChange) return null;

	return (
		<RoadmapConfirmShell
			isOpen={isOpen}
			icon={CalendarRange}
			title="Confirm Date Update"
			subtitle="This change will update the roadmap schedule."
			closeLabel="Close date update modal"
			isSaving={isSaving}
			onCancel={onCancel}
			onConfirm={onConfirm}
		>
			<p>
				You are about to update date range for
				<span className="ml-1 inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground">
					{displayChange.entityLabel}
				</span>
			</p>
			<div className="rounded-xl border border-border bg-muted/50 px-4 py-3">
				<div className="grid grid-cols-[62px_1fr] items-center gap-2">
					<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						From
					</span>
					<span className="font-medium text-foreground">
						{displayChange.oldStartDate} - {displayChange.oldEndDate}
					</span>
				</div>
				<div className="my-2 h-px bg-border" />
				<div className="grid grid-cols-[62px_1fr] items-center gap-2">
					<span className="text-xs font-semibold uppercase tracking-wide text-primary">
						To
					</span>
					<span className="font-semibold text-primary">
						{displayChange.newStartDate} - {displayChange.newEndDate}
					</span>
				</div>
			</div>
			<DontAskAgainToggle
				id={inputId}
				checked={dontAskAgain}
				onChange={onDontAskAgainChange}
			/>
		</RoadmapConfirmShell>
	);
};
