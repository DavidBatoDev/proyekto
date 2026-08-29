import { Trash2, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { ModalPortal } from "@/components/common/ModalPortal";
import type { RoadmapMilestone } from "@/types/roadmap";
import type { MilestoneModalMode } from "../hooks/useMilestoneEditor";

interface MilestoneEditorModalProps {
	isOpen: boolean;
	mode: MilestoneModalMode;
	isSaving: boolean;
	isDeleting: boolean;
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
	onDelete?: () => Promise<void> | void;
}

export const MilestoneEditorModal = ({
	isOpen,
	mode,
	isSaving,
	isDeleting,
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
	onDelete,
}: MilestoneEditorModalProps) => {
	const inputIdPrefix = useId();
	const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
	useEffect(() => {
		if (!isOpen) setIsConfirmingDelete(false);
	}, [isOpen]);
	if (!isOpen) return null;
	const titleId = `${inputIdPrefix}-title`;
	const dateId = `${inputIdPrefix}-date`;
	const statusId = `${inputIdPrefix}-status`;
	const colorId = `${inputIdPrefix}-color`;

	return (
		<ModalPortal>
			<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]">
				<div className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl">
					<div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-3">
						<h3 className="text-base font-semibold text-foreground">
							{mode === "edit" ? "Edit Milestone" : "Add Milestone"}
						</h3>
						<button
							type="button"
							onClick={onCancel}
							className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							aria-label="Close milestone modal"
						>
							<X size={16} />
						</button>
					</div>
					<div className="space-y-3 px-4 py-3.5">
						<div className="rounded-lg border border-primary/20 bg-primary/10 px-2.5 py-2">
							<div className="flex items-center gap-2">
								<span
									className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-card"
									style={{ backgroundColor: draftColor }}
								/>
								<p className="truncate text-[13px] font-medium text-foreground">
									{draftTitle.trim() || "Milestone preview"}
								</p>
							</div>
						</div>
						<div className="space-y-1">
							<label
								htmlFor={titleId}
								className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
							>
								Title
							</label>
							<input
								id={titleId}
								type="text"
								value={draftTitle}
								onChange={(event) => onDraftTitleChange(event.target.value)}
								placeholder="Milestone title"
								className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
							/>
						</div>
						<div className="grid grid-cols-[1.2fr_1fr_auto] gap-2">
							<div className="space-y-1">
								<label
									htmlFor={dateId}
									className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
								>
									Target date
								</label>
								<input
									id={dateId}
									type="date"
									value={draftDate}
									onChange={(event) => onDraftDateChange(event.target.value)}
									className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
								/>
							</div>
							<div className="space-y-1">
								<label
									htmlFor={statusId}
									className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
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
									className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
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
									className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
								>
									Color
								</label>
								<input
									id={colorId}
									type="color"
									value={draftColor}
									onChange={(event) => onDraftColorChange(event.target.value)}
									className="h-9 w-11 rounded-lg border border-border bg-background p-1"
								/>
							</div>
						</div>
					</div>
					<div className="flex items-center gap-2 border-t border-border px-4 py-3">
						{mode === "edit" &&
							onDelete &&
							(isConfirmingDelete ? (
								<div className="mr-auto flex items-center gap-2">
									<span className="text-xs font-medium text-destructive">
										Delete this milestone?
									</span>
									<button
										type="button"
										disabled={isDeleting}
										onClick={() => void onDelete()}
										className="rounded-lg bg-destructive px-2.5 py-1.5 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
									>
										{isDeleting ? "Deleting…" : "Confirm"}
									</button>
									<button
										type="button"
										disabled={isDeleting}
										onClick={() => setIsConfirmingDelete(false)}
										className="rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
									>
										Keep
									</button>
								</div>
							) : (
								<button
									type="button"
									disabled={isSaving || isDeleting}
									onClick={() => setIsConfirmingDelete(true)}
									className="mr-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
								>
									<Trash2 size={15} />
									Delete
								</button>
							))}
						{!isConfirmingDelete && (
							<>
								<button
									type="button"
									onClick={onCancel}
									disabled={isSaving || isDeleting}
									className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
								>
									Cancel
								</button>
								<button
									type="button"
									disabled={
										isSaving || isDeleting || !draftTitle.trim() || !draftDate
									}
									onClick={() => void onSubmit()}
									className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
								>
									{mode === "edit" ? "Save Changes" : "Create Milestone"}
								</button>
							</>
						)}
					</div>
				</div>
			</div>
		</ModalPortal>
	);
};
