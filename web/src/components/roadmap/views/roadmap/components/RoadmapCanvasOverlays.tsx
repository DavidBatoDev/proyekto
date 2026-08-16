import type { Dispatch, SetStateAction } from "react";
import { useRoadmapStore } from "@/stores/roadmapStore";
import type { EpicPriority, RoadmapEpic, RoadmapTask } from "@/types/roadmap";
import { EpicModal } from "../../../modals/EpicModal";
import { FeatureModal } from "../../../modals/FeatureModal";
import { SidePanel } from "../../../panels/SidePanel";

interface DeleteConfirm {
	type: "epic" | "feature";
	id: string;
	label: string;
}

interface RoadmapCanvasOverlaysProps {
	projectId?: string;
	epics: RoadmapEpic[];
	selectedTask: RoadmapTask | null;
	sidePanelOpen: boolean;
	selectedTaskId: string | null;
	targetFeatureForTask: string | null;
	taskPanelInitialTab?: "details" | "comments";
	taskPanelOpenRequestToken?: number;
	closeAddTaskPanel: () => void;
	setSidePanelOpen: Dispatch<SetStateAction<boolean>>;
	setSelectedTaskId: Dispatch<SetStateAction<string | null>>;
	setTargetFeatureForTask: Dispatch<SetStateAction<string | null>>;
	setIsAddFeatureModalOpen: Dispatch<SetStateAction<boolean>>;
	setTargetEpicForFeature: Dispatch<SetStateAction<string | null>>;
	setIsEditFeatureModalOpen: Dispatch<SetStateAction<boolean>>;
	setEditingFeatureId: Dispatch<SetStateAction<string | null>>;
	setEditingFeatureEpicId: Dispatch<SetStateAction<string | null>>;
	isTaskLoading: boolean;
	isEpicLoading: boolean;
	isFeatureLoading: boolean;
	isEditingEpicPending: boolean;
	isEditingFeaturePending: boolean;
	isSelectedTaskPending: boolean;
	isAddEpicModalOpen: boolean;
	isEditEpicModalOpen: boolean;
	isAddFeatureModalOpen: boolean;
	isEditFeatureModalOpen: boolean;
	editingEpicId: string | null;
	editingFeatureId: string | null;
	editingFeatureEpicId: string | null;
	targetEpicForFeature: string | null;
	deleteConfirm: DeleteConfirm | null;
	setDeleteConfirm: Dispatch<SetStateAction<DeleteConfirm | null>>;
	duplicateConfirm: DeleteConfirm | null;
	setDuplicateConfirm: Dispatch<SetStateAction<DeleteConfirm | null>>;
	setIsAddEpicModalOpen: Dispatch<SetStateAction<boolean>>;
	setIsEditEpicModalOpen: Dispatch<SetStateAction<boolean>>;
	setEditingEpicId: Dispatch<SetStateAction<string | null>>;
	handleTaskUpdate: (task: RoadmapTask) => Promise<void>;
	handleTaskDelete: (taskId: string) => Promise<void>;
	handleTaskDuplicate?: (taskId: string) => Promise<void>;
	handleTaskCreate: (taskData: Partial<RoadmapTask>) => Promise<void>;
	handleSelectTask?: (
		task: { id: string },
		initialTab?: "details" | "comments",
	) => void;
	handleCreateTaskFromFeature?: (featureId: string) => void;
	handleCreateEpic: (data: {
		title: string;
		description: string;
		priority: EpicPriority;
		tags: string[];
		start_date?: string;
		end_date?: string;
	}) => Promise<void>;
	handleUpdateEpicFromModal: (data: {
		title: string;
		description: string;
		priority: EpicPriority;
		tags: string[];
		start_date?: string;
		end_date?: string;
	}) => Promise<void>;
	handleCreateFeature: (data: {
		title: string;
		description: string;
		is_deliverable: boolean;
		start_date?: string;
		end_date?: string;
		assignee_ids?: string[];
	}) => Promise<void>;
	handleUpdateFeatureFromModal: (data: {
		title: string;
		description: string;
		is_deliverable: boolean;
		start_date?: string;
		end_date?: string;
		assignee_ids?: string[];
	}) => Promise<void>;
	handleOpenEditFeatureModal: (epicId: string, featureId: string) => void;
	handleConfirmDelete: () => void;
	handleConfirmDuplicate: () => void;
}

export function RoadmapCanvasOverlays({
	projectId,
	epics,
	selectedTask,
	sidePanelOpen,
	selectedTaskId,
	targetFeatureForTask,
	taskPanelInitialTab = "details",
	taskPanelOpenRequestToken = 0,
	closeAddTaskPanel,
	setSidePanelOpen,
	setSelectedTaskId,
	setTargetFeatureForTask,
	setIsAddFeatureModalOpen,
	setTargetEpicForFeature,
	setIsEditFeatureModalOpen,
	setEditingFeatureId,
	setEditingFeatureEpicId,
	isTaskLoading,
	isEpicLoading,
	isFeatureLoading,
	isEditingEpicPending,
	isEditingFeaturePending,
	isSelectedTaskPending,
	isAddEpicModalOpen,
	isEditEpicModalOpen,
	isAddFeatureModalOpen,
	isEditFeatureModalOpen,
	editingEpicId,
	editingFeatureId,
	editingFeatureEpicId,
	targetEpicForFeature,
	deleteConfirm,
	setDeleteConfirm,
	duplicateConfirm,
	setDuplicateConfirm,
	setIsAddEpicModalOpen,
	setIsEditEpicModalOpen,
	setEditingEpicId,
	handleTaskUpdate,
	handleTaskDelete,
	handleTaskDuplicate,
	handleTaskCreate,
	handleSelectTask,
	handleCreateTaskFromFeature,
	handleCreateEpic,
	handleUpdateEpicFromModal,
	handleCreateFeature,
	handleUpdateFeatureFromModal,
	handleOpenEditFeatureModal,
	handleConfirmDelete,
	handleConfirmDuplicate,
}: RoadmapCanvasOverlaysProps) {
	const navigateToNode = useRoadmapStore((s) => s.navigateToNode);
	const selectTask =
		handleSelectTask ??
		((task: { id: string }) => {
			setSelectedTaskId(task.id);
			setTargetFeatureForTask(null);
			setSidePanelOpen(true);
		});
	const createTaskFromFeature =
		handleCreateTaskFromFeature ??
		((featureId: string) => {
			setTargetFeatureForTask(featureId);
			setSelectedTaskId(null);
			setSidePanelOpen(true);
		});

	return (
		<>
			<SidePanel
				task={selectedTask || null}
				isOpen={sidePanelOpen}
				isCreating={!selectedTaskId && targetFeatureForTask !== null}
				initialTab={taskPanelInitialTab}
				initialTabRequestToken={taskPanelOpenRequestToken}
				projectId={projectId}
				onClose={() => {
					setSidePanelOpen(false);
					setSelectedTaskId(null);
					setTargetFeatureForTask(null);
					closeAddTaskPanel();
				}}
				onSaved={(task) => {
					if (task.feature_id) {
						navigateToNode(task.feature_id, { taskId: task.id });
					}
				}}
				onUpdateTask={handleTaskUpdate}
				onDeleteTask={handleTaskDelete}
				onDuplicateTask={handleTaskDuplicate}
				onCreateTask={handleTaskCreate}
				isLoading={isTaskLoading}
				isPendingCreate={isSelectedTaskPending}
			/>

			<EpicModal
				isOpen={isAddEpicModalOpen}
				onClose={() => setIsAddEpicModalOpen(false)}
				onSubmit={handleCreateEpic}
				isLoading={isEpicLoading}
			/>

			<EpicModal
				isOpen={isEditEpicModalOpen}
				onClose={() => {
					setIsEditEpicModalOpen(false);
					setEditingEpicId(null);
				}}
				onSubmit={handleUpdateEpicFromModal}
				onAddFeature={
					editingEpicId
						? () => {
								setTargetEpicForFeature(editingEpicId);
								setIsAddFeatureModalOpen(true);
							}
						: undefined
				}
				onSelectFeature={
					editingEpicId
						? (feature) => {
								if (feature.id) {
									handleOpenEditFeatureModal(editingEpicId, feature.id);
								}
							}
						: undefined
				}
				onAddTask={editingEpicId ? createTaskFromFeature : undefined}
				onUpdateTask={handleTaskUpdate}
				onDeleteTask={handleTaskDelete}
				onSelectTask={selectTask}
				initialData={
					editingEpicId
						? (() => {
								const epic = epics.find((e) => e.id === editingEpicId);
								return epic
									? {
											id: epic.id,
											title: epic.title,
											description: epic.description,
											priority: epic.priority,
											tags: epic.tags,
											labels: epic.labels,
											features: epic.features,
											start_date: epic.start_date
												? epic.start_date.slice(0, 10)
												: undefined,
											end_date: epic.end_date
												? epic.end_date.slice(0, 10)
												: undefined,
										}
									: undefined;
							})()
						: undefined
				}
				titleText="Edit Epic"
				submitLabel="Save Changes"
				isLoading={isEpicLoading}
				isPendingCreate={isEditingEpicPending}
			/>

			<FeatureModal
				isOpen={isAddFeatureModalOpen}
				epicTitle={
					targetEpicForFeature
						? epics.find((epic) => epic.id === targetEpicForFeature)?.title
						: undefined
				}
				onClose={() => {
					setIsAddFeatureModalOpen(false);
					setTargetEpicForFeature(null);
				}}
				onSubmit={handleCreateFeature}
				isLoading={isFeatureLoading}
			/>

			<FeatureModal
				isOpen={isEditFeatureModalOpen}
				epicTitle={
					editingFeatureEpicId
						? epics.find((epic) => epic.id === editingFeatureEpicId)?.title
						: undefined
				}
				initialData={
					editingFeatureId && editingFeatureEpicId
						? epics
								.find((epic) => epic.id === editingFeatureEpicId)
								?.features?.find((feature) => feature.id === editingFeatureId)
						: undefined
				}
				titleText="Edit Feature"
				submitLabel="Save Changes"
				onClose={() => {
					setIsEditFeatureModalOpen(false);
					setEditingFeatureId(null);
					setEditingFeatureEpicId(null);
				}}
				onAddTask={editingFeatureId ? createTaskFromFeature : undefined}
				onUpdateTask={handleTaskUpdate}
				onDeleteTask={handleTaskDelete}
				onSelectTask={selectTask}
				onSubmit={handleUpdateFeatureFromModal}
				isLoading={isFeatureLoading}
				isPendingCreate={isEditingFeaturePending}
			/>

			{deleteConfirm && (
				<div className="fixed inset-0 z-50 flex items-center justify-center">
					<div
						className="absolute inset-0 bg-black/40"
						onClick={() => setDeleteConfirm(null)}
					/>
					<div className="relative z-10 w-full max-w-md mx-4 rounded-xl bg-white shadow-2xl p-6">
						<h3 className="text-lg font-semibold text-gray-900">
							Delete {deleteConfirm.type === "epic" ? "Epic" : "Feature"}?
						</h3>
						<p className="text-sm text-gray-600 mt-2">
							This will permanently remove {deleteConfirm.label} and cannot be
							undone.
						</p>
						<div className="mt-6 flex justify-end gap-3">
							<button
								type="button"
								onClick={() => setDeleteConfirm(null)}
								className="px-4 py-2 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleConfirmDelete}
								className="px-4 py-2 text-sm rounded-md bg-red-600 text-white hover:bg-red-700"
							>
								Delete
							</button>
						</div>
					</div>
				</div>
			)}

			{duplicateConfirm && (
				<div className="fixed inset-0 z-50 flex items-center justify-center">
					<div
						className="absolute inset-0 bg-black/40"
						onClick={() => setDuplicateConfirm(null)}
					/>
					<div className="relative z-10 w-full max-w-md mx-4 rounded-xl bg-white shadow-2xl p-6">
						<h3 className="text-lg font-semibold text-gray-900">
							Duplicate {duplicateConfirm.type === "epic" ? "Epic" : "Feature"}?
						</h3>
						<p className="text-sm text-gray-600 mt-2">
							This will create a copy of {duplicateConfirm.label}
							{duplicateConfirm.type === "epic"
								? ", including all its features and tasks."
								: ", including all its tasks."}
						</p>
						<div className="mt-6 flex justify-end gap-3">
							<button
								type="button"
								onClick={() => setDuplicateConfirm(null)}
								className="px-4 py-2 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleConfirmDuplicate}
								className="px-4 py-2 text-sm rounded-md bg-primary text-white hover:bg-primary/90"
							>
								Duplicate
							</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
