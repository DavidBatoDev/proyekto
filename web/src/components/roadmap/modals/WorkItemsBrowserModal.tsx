import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X, ChevronRight, ListChecks } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useRoadmapStore } from "@/stores/roadmapStore";
import { EpicModal } from "./EpicModal";
import { FeatureModal } from "./FeatureModal";
import { SidePanel } from "../panels/SidePanel";
import type { RoadmapTask } from "@/types/roadmap";

interface WorkItemsBrowserModalProps {
	projectId: string;
	roadmapId: string;
	isOpen: boolean;
	onClose: () => void;
}

const SCROLLBAR =
	"[scrollbar-width:thin] [scrollbar-color:var(--color-slate-300)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full";

function ColumnHeader({
	title,
	count,
}: {
	title: string;
	count: number;
}) {
	return (
		<div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-200 bg-slate-50">
			<div className="flex items-center gap-2 min-w-0">
				<span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
					{title}
				</span>
				<span className="text-[10px] font-semibold text-slate-400">
					{count}
				</span>
			</div>
		</div>
	);
}

function ColumnAddRow({
	label,
	onAdd,
	disabled,
	disabledHint,
}: {
	label: string;
	onAdd: () => void;
	disabled?: boolean;
	disabledHint?: string;
}) {
	return (
		<button
			type="button"
			onClick={onAdd}
			disabled={disabled}
			title={disabled ? disabledHint : label}
			className={`flex w-full items-center justify-center gap-1.5 px-3 py-2.5 border-t border-slate-200 text-xs font-medium transition-colors ${
				disabled
					? "bg-slate-50 text-slate-300 cursor-not-allowed"
					: "bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900"
			}`}
		>
			<Plus className="w-3.5 h-3.5" />
			{label}
		</button>
	);
}

function ColumnRow({
	label,
	subLabel,
	isActive,
	onClick,
}: {
	label: string;
	subLabel?: string;
	isActive: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`group flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
				isActive
					? "bg-slate-900 text-white"
					: "text-slate-700 hover:bg-slate-50"
			}`}
		>
			<div className="min-w-0">
				<div className="truncate font-medium">{label}</div>
				{subLabel ? (
					<div
						className={`truncate text-[11px] ${isActive ? "text-slate-300" : "text-slate-400"}`}
					>
						{subLabel}
					</div>
				) : null}
			</div>
			<ChevronRight
				className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-slate-300" : "text-slate-300 group-hover:text-slate-500"}`}
			/>
		</button>
	);
}

function EmptyState({ message }: { message: string }) {
	return (
		<div className="flex-1 flex items-center justify-center px-4 text-center text-xs text-slate-400">
			{message}
		</div>
	);
}

export function WorkItemsBrowserModal({
	projectId,
	isOpen,
	onClose,
}: WorkItemsBrowserModalProps) {
	const { epics, addEpic, addFeature, addTask } = useRoadmapStore(
		useShallow((s) => ({
			epics: s.epics,
			addEpic: s.addEpic,
			addFeature: s.addFeature,
			addTask: s.addTask,
		})),
	);

	const [selectedEpicId, setSelectedEpicId] = useState<string | null>(null);
	const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(
		null,
	);

	const [isAddEpicOpen, setIsAddEpicOpen] = useState(false);
	const [isAddFeatureOpen, setIsAddFeatureOpen] = useState(false);
	const [isAddTaskOpen, setIsAddTaskOpen] = useState(false);

	useEffect(() => {
		if (!isOpen) {
			setSelectedEpicId(null);
			setSelectedFeatureId(null);
			setIsAddEpicOpen(false);
			setIsAddFeatureOpen(false);
			setIsAddTaskOpen(false);
		}
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen) return;
		const handleKey = (event: KeyboardEvent) => {
			if (
				event.key === "Escape" &&
				!isAddEpicOpen &&
				!isAddFeatureOpen &&
				!isAddTaskOpen
			) {
				onClose();
			}
		};
		document.addEventListener("keydown", handleKey);
		return () => document.removeEventListener("keydown", handleKey);
	}, [isOpen, isAddEpicOpen, isAddFeatureOpen, isAddTaskOpen, onClose]);

	const selectedEpic = useMemo(
		() =>
			selectedEpicId ? epics.find((e) => e.id === selectedEpicId) ?? null : null,
		[epics, selectedEpicId],
	);

	const selectedFeature = useMemo(() => {
		if (!selectedEpic || !selectedFeatureId) return null;
		return (
			(selectedEpic.features ?? []).find((f) => f.id === selectedFeatureId) ??
			null
		);
	}, [selectedEpic, selectedFeatureId]);

	const features = selectedEpic?.features ?? [];
	const tasks = selectedFeature?.tasks ?? [];

	const detectNewId = async <T extends { id: string }>(
		beforeIds: Set<string>,
		readItems: () => T[],
	): Promise<string | null> => {
		const after = readItems();
		for (const item of after) {
			if (!beforeIds.has(item.id)) return item.id;
		}
		return null;
	};

	const handleSubmitEpic = async (data: {
		title: string;
		description: string;
		priority: import("@/types/roadmap").EpicPriority;
		tags: string[];
		start_date?: string;
		end_date?: string;
	}) => {
		const beforeIds = new Set(
			useRoadmapStore.getState().epics.map((e) => e.id),
		);
		await addEpic(undefined, {
			title: data.title,
			description: data.description,
			priority: data.priority,
			tags: data.tags,
			start_date: data.start_date,
			end_date: data.end_date,
		});
		const newId = await detectNewId(
			beforeIds,
			() => useRoadmapStore.getState().epics,
		);
		if (newId) setSelectedEpicId(newId);
		setIsAddEpicOpen(false);
	};

	const handleSubmitFeature = async (data: {
		title: string;
		description: string;
		is_deliverable: boolean;
		start_date?: string;
		end_date?: string;
	}) => {
		if (!selectedEpicId) return;
		const epicBefore = useRoadmapStore
			.getState()
			.epics.find((e) => e.id === selectedEpicId);
		const beforeIds = new Set(
			(epicBefore?.features ?? []).map((f) => f.id),
		);
		await addFeature(selectedEpicId, {
			title: data.title,
			description: data.description,
			is_deliverable: data.is_deliverable,
			start_date: data.start_date,
			end_date: data.end_date,
		});
		const newId = await detectNewId(beforeIds, () => {
			const epic = useRoadmapStore
				.getState()
				.epics.find((e) => e.id === selectedEpicId);
			return epic?.features ?? [];
		});
		if (newId) setSelectedFeatureId(newId);
		setIsAddFeatureOpen(false);
	};

	const handleSubmitTask = async (data: Partial<RoadmapTask>) => {
		if (!selectedFeatureId) return;
		await addTask(selectedFeatureId, data);
		setIsAddTaskOpen(false);
	};

	if (!isOpen) return null;

	const content = (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60"
			onClick={onClose}
		>
			<div
				className="bg-white w-[95vw] max-w-6xl h-[80vh] rounded-xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden"
				onClick={(event) => event.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-slate-200">
					<div className="flex items-center gap-2.5">
						<div className="w-8 h-8 rounded-lg bg-[#0f172a]/10 flex items-center justify-center shrink-0">
							<ListChecks className="w-4 h-4 text-[#0f172a]" />
						</div>
						<div className="leading-tight">
							<h2 className="text-sm font-semibold text-slate-900">
								Add work items
							</h2>
							<p className="text-[11px] text-slate-400">
								Browse the roadmap and add epics, features, or tasks
							</p>
						</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
						aria-label="Close"
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				{/* Columns */}
				<div className="flex-1 min-h-0 grid grid-cols-3">
					{/* Epics */}
					<div className="flex flex-col min-h-0 border-r border-slate-200">
						<ColumnHeader title="Epics" count={epics.length} />
						<div
							className={`flex-1 overflow-y-auto divide-y divide-slate-100 ${SCROLLBAR}`}
						>
							{epics.length === 0 ? (
								<EmptyState message="No epics yet. Click Add Epic below." />
							) : (
								epics.map((epic) => (
									<ColumnRow
										key={epic.id}
										label={epic.title || "Untitled epic"}
										subLabel={`${epic.features?.length ?? 0} feature${
											(epic.features?.length ?? 0) === 1 ? "" : "s"
										}`}
										isActive={selectedEpicId === epic.id}
										onClick={() => {
											setSelectedEpicId(epic.id);
											const firstFeatureId =
												(epic.features ?? [])[0]?.id ?? null;
											setSelectedFeatureId(firstFeatureId);
										}}
									/>
								))
							)}
							<ColumnAddRow
								label="Add epic"
								onAdd={() => setIsAddEpicOpen(true)}
							/>
						</div>
					</div>

					{/* Features */}
					<div className="flex flex-col min-h-0 border-r border-slate-200">
						<ColumnHeader title="Features" count={features.length} />
						<div
							className={`flex-1 overflow-y-auto divide-y divide-slate-100 ${SCROLLBAR}`}
						>
							{!selectedEpicId ? (
								<EmptyState message="Select an epic to see its features." />
							) : features.length === 0 ? (
								<EmptyState message="No features in this epic yet." />
							) : (
								features.map((feature) => (
									<ColumnRow
										key={feature.id}
										label={feature.title || "Untitled feature"}
										subLabel={`${feature.tasks?.length ?? 0} task${
											(feature.tasks?.length ?? 0) === 1 ? "" : "s"
										}`}
										isActive={selectedFeatureId === feature.id}
										onClick={() => setSelectedFeatureId(feature.id)}
									/>
								))
							)}
							<ColumnAddRow
								label="Add feature"
								onAdd={() => setIsAddFeatureOpen(true)}
								disabled={!selectedEpicId}
								disabledHint="Select an epic first"
							/>
						</div>
					</div>

					{/* Tasks */}
					<div className="flex flex-col min-h-0">
						<ColumnHeader title="Tasks" count={tasks.length} />
						<div
							className={`flex-1 overflow-y-auto divide-y divide-slate-100 ${SCROLLBAR}`}
						>
							{!selectedFeatureId ? (
								<EmptyState message="Select a feature to see its tasks." />
							) : tasks.length === 0 ? (
								<EmptyState message="No tasks in this feature yet." />
							) : (
								tasks.map((task) => (
									<ColumnRow
										key={task.id}
										label={task.title || "Untitled task"}
										subLabel={task.status.replace(/_/g, " ")}
										isActive={false}
										onClick={() => {}}
									/>
								))
							)}
							<ColumnAddRow
								label="Add task"
								onAdd={() => setIsAddTaskOpen(true)}
								disabled={!selectedFeatureId}
								disabledHint="Select a feature first"
							/>
						</div>
					</div>
				</div>
			</div>

			{/* Child Add modals — stop click propagation handled via createPortal/z-60 */}
			<EpicModal
				isOpen={isAddEpicOpen}
				onClose={() => setIsAddEpicOpen(false)}
				onSubmit={handleSubmitEpic}
				titleText="Add Epic"
				submitLabel="Create Epic"
			/>
			{selectedEpic && (
				<FeatureModal
					isOpen={isAddFeatureOpen}
					epicTitle={selectedEpic.title}
					onClose={() => setIsAddFeatureOpen(false)}
					onSubmit={handleSubmitFeature}
					titleText="Add Feature"
					submitLabel="Create Feature"
				/>
			)}
			{selectedFeatureId && (
				<SidePanel
					task={null}
					isOpen={isAddTaskOpen}
					isCreating
					onClose={() => setIsAddTaskOpen(false)}
					onUpdateTask={() => {}}
					onDeleteTask={() => {}}
					onCreateTask={handleSubmitTask}
					projectId={projectId}
				/>
			)}
		</div>
	);

	return createPortal(content, document.body);
}
