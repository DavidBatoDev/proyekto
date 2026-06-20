import { X } from "lucide-react";
import { useId } from "react";
import { ModalPortal } from "@/components/common/ModalPortal";
import type { RoadmapMilestone } from "@/types/roadmap";
import type { MilestoneModalMode } from "../hooks/useMilestoneEditor";

interface MilestoneEditorModalProps {
	isOpen: boolean;
	mode: MilestoneModalMode;
	isSaving: boolean;
	draftTitle: string;
	draftDate: string;
	draftStatus: RoadmapMilestone["status"];
	draftColor: string;
	onDraftTitleChange: (value: string) => void;
	onDraftDateChange: (value: string) => void;
	onDraftStatusChange: (value: RoadmapMilestone["status"]) => void;
	onDraftColorChange: (value: string) => void;
	onCancel: () => void;
	onSubmit: () => Promise<void> | void;
}

export const MilestoneEditorModal = ({
	isOpen,
	mode,
	isSaving,
	draftTitle,
	draftDate,
	draftStatus,
	draftColor,
	onDraftTitleChange,
	onDraftDateChange,
	onDraftStatusChange,
	onDraftColorChange,
	onCancel,
	onSubmit,
}: MilestoneEditorModalProps) => {
	const inputIdPrefix = useId();
	if (!isOpen) return null;
	const titleId = `${inputIdPrefix}-title`;
	const dateId = `${inputIdPrefix}-date`;
	const statusId = `${inputIdPrefix}-status`;
	const colorId = `${inputIdPrefix}-color`;

	return (
		<ModalPortal>
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]">
			<div className="w-full max-w-sm overflow-hidden rounded-2xl border border-orange-100 bg-white shadow-2xl">
				<div className="flex items-center justify-between border-b border-orange-100 bg-linear-to-r from-orange-50 to-amber-50 px-4 py-3">
					<h3 className="text-base font-semibold text-gray-900">
						{mode === "edit" ? "Edit Milestone" : "Add Milestone"}
					</h3>
					<button
						type="button"
						onClick={onCancel}
						className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
						aria-label="Close milestone modal"
					>
						<X size={16} />
					</button>
				</div>
				<div className="space-y-3 px-4 py-3.5">
					<div className="rounded-lg border border-orange-100 bg-orange-50/60 px-2.5 py-2">
						<div className="flex items-center gap-2">
							<span
								className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white"
								style={{ backgroundColor: draftColor }}
							/>
							<p className="truncate text-[13px] font-medium text-gray-700">
								{draftTitle.trim() || "Milestone preview"}
							</p>
						</div>
					</div>
					<div className="space-y-1">
						<label
							htmlFor={titleId}
							className="text-xs font-medium uppercase tracking-wide text-gray-500"
						>
							Title
						</label>
						<input
							id={titleId}
							type="text"
							value={draftTitle}
							onChange={(event) => onDraftTitleChange(event.target.value)}
							placeholder="Milestone title"
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 outline-none transition-colors focus:border-orange-400"
						/>
					</div>
					<div className="grid grid-cols-[1.2fr_1fr_auto] gap-2">
						<div className="space-y-1">
							<label
								htmlFor={dateId}
								className="text-xs font-medium uppercase tracking-wide text-gray-500"
							>
								Target date
							</label>
							<input
								id={dateId}
								type="date"
								value={draftDate}
								onChange={(event) => onDraftDateChange(event.target.value)}
								className="w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm text-gray-700 outline-none transition-colors focus:border-orange-400"
							/>
						</div>
						<div className="space-y-1">
							<label
								htmlFor={statusId}
								className="text-xs font-medium uppercase tracking-wide text-gray-500"
							>
								Status
							</label>
							<select
								id={statusId}
								value={draftStatus}
								onChange={(event) =>
									onDraftStatusChange(
										event.target.value as RoadmapMilestone["status"],
									)
								}
								className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm text-gray-700 outline-none transition-colors focus:border-orange-400"
							>
								<option value="not_started">Not Started</option>
								<option value="in_progress">In Progress</option>
								<option value="at_risk">At Risk</option>
								<option value="completed">Completed</option>
								<option value="missed">Missed</option>
							</select>
						</div>
						<div className="space-y-1">
							<label
								htmlFor={colorId}
								className="text-xs font-medium uppercase tracking-wide text-gray-500"
							>
								Color
							</label>
							<input
								id={colorId}
								type="color"
								value={draftColor}
								onChange={(event) => onDraftColorChange(event.target.value)}
								className="h-9 w-11 rounded-lg border border-gray-300 bg-white p-1"
							/>
						</div>
					</div>
				</div>
				<div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3">
					<button
						type="button"
						onClick={onCancel}
						disabled={isSaving}
						className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100"
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={isSaving || !draftTitle.trim() || !draftDate}
						onClick={() => void onSubmit()}
						className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
					>
						{mode === "edit" ? "Save Changes" : "Create Milestone"}
					</button>
				</div>
			</div>
		</div>
		</ModalPortal>
	);
};
