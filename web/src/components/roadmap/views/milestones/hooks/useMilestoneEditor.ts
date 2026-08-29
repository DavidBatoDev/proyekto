import { useState } from "react";
import type { RoadmapMilestone } from "@/types/roadmap";

type MilestoneModalMode = "create" | "edit" | null;

interface UseMilestoneEditorParams {
	sortedMilestones: RoadmapMilestone[];
	onAddMilestone: (data: {
		title: string;
		target_date: string;
		description?: string;
		status?: RoadmapMilestone["status"];
		color?: string;
	}) => Promise<void> | void;
	onUpdateMilestone: (milestone: RoadmapMilestone) => Promise<void> | void;
	onDeleteMilestone: (id: string) => Promise<void> | void;
}

export function useMilestoneEditor({
	sortedMilestones,
	onAddMilestone,
	onUpdateMilestone,
	onDeleteMilestone,
}: UseMilestoneEditorParams) {
	const [milestoneModalMode, setMilestoneModalMode] =
		useState<MilestoneModalMode>(null);
	const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(
		null,
	);
	const [isSavingMilestone, setIsSavingMilestone] = useState(false);
	const [isDeletingMilestone, setIsDeletingMilestone] = useState(false);
	const [draftTitle, setDraftTitle] = useState("");
	const [draftDate, setDraftDate] = useState(
		new Date().toISOString().slice(0, 10),
	);
	const [draftStatus, setDraftStatus] =
		useState<RoadmapMilestone["status"]>("not_started");
	const [draftColor, setDraftColor] = useState("#f97316");

	const resetMilestoneDraft = () => {
		setDraftTitle("");
		setDraftDate(new Date().toISOString().slice(0, 10));
		setDraftStatus("not_started");
		setDraftColor("#f97316");
	};

	const startCreateMilestone = () => {
		resetMilestoneDraft();
		setEditingMilestoneId(null);
		setMilestoneModalMode("create");
	};

	const startEditMilestone = (milestone: RoadmapMilestone) => {
		setDraftTitle(milestone.title);
		setDraftDate(new Date(milestone.target_date).toISOString().slice(0, 10));
		setDraftStatus(milestone.status);
		setDraftColor(milestone.color ?? "#f97316");
		setMilestoneModalMode("edit");
		setEditingMilestoneId(milestone.id);
	};

	const cancelMilestoneEditor = () => {
		setMilestoneModalMode(null);
		setEditingMilestoneId(null);
		resetMilestoneDraft();
	};

	const saveNewMilestone = async () => {
		if (!draftTitle.trim() || !draftDate) return;
		setIsSavingMilestone(true);
		try {
			await onAddMilestone({
				title: draftTitle.trim(),
				target_date: new Date(`${draftDate}T00:00:00.000Z`).toISOString(),
				status: draftStatus,
				color: draftColor,
			});
			cancelMilestoneEditor();
		} finally {
			setIsSavingMilestone(false);
		}
	};

	const saveEditedMilestone = async (milestone: RoadmapMilestone) => {
		if (!draftTitle.trim() || !draftDate) return;
		setIsSavingMilestone(true);
		try {
			await onUpdateMilestone({
				...milestone,
				title: draftTitle.trim(),
				target_date: new Date(`${draftDate}T00:00:00.000Z`).toISOString(),
				status: draftStatus,
				color: draftColor,
				updated_at: new Date().toISOString(),
			});
			cancelMilestoneEditor();
		} finally {
			setIsSavingMilestone(false);
		}
	};

	const submitMilestone = async () => {
		if (milestoneModalMode === "edit" && editingMilestoneId) {
			const milestone = sortedMilestones.find(
				(item) => item.id === editingMilestoneId,
			);
			if (milestone) {
				await saveEditedMilestone(milestone);
			}
			return;
		}
		await saveNewMilestone();
	};

	const deleteEditingMilestone = async () => {
		if (milestoneModalMode !== "edit" || !editingMilestoneId) return;
		setIsDeletingMilestone(true);
		try {
			await onDeleteMilestone(editingMilestoneId);
			cancelMilestoneEditor();
		} finally {
			setIsDeletingMilestone(false);
		}
	};

	return {
		milestoneModalMode,
		editingMilestoneId,
		isMilestoneModalOpen: milestoneModalMode !== null,
		isSavingMilestone,
		isDeletingMilestone,
		draftTitle,
		draftDate,
		draftStatus,
		draftColor,
		setDraftTitle,
		setDraftDate,
		setDraftStatus,
		setDraftColor,
		startCreateMilestone,
		startEditMilestone,
		cancelMilestoneEditor,
		submitMilestone,
		deleteEditingMilestone,
	};
}

export type { MilestoneModalMode };
