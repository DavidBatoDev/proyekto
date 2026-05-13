import { X } from "lucide-react";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useRoadmapStore } from "@/stores/roadmapStore";

type FilterKey = "epicIds" | "milestoneIds" | "assigneeIds";

interface PillOption {
	id: string;
	label: string;
}

function FilterGroup({
	title,
	options,
	selected,
	onToggle,
}: {
	title: string;
	options: PillOption[];
	selected: string[];
	onToggle: (id: string) => void;
}) {
	if (!options.length) return null;
	return (
		<div className="flex items-center gap-1.5 flex-wrap">
			<span className="text-xs font-medium text-gray-500">{title}:</span>
			{options.map((option) => {
				const isActive = selected.includes(option.id);
				return (
					<button
						key={option.id}
						type="button"
						onClick={() => onToggle(option.id)}
						className={`px-2 py-0.5 rounded-full text-xs border transition ${
							isActive
								? "bg-orange-100 text-orange-700 border-orange-300"
								: "bg-white text-gray-700 border-gray-200 hover:border-gray-300"
						}`}
					>
						{option.label}
					</button>
				);
			})}
		</div>
	);
}

export function KanbanFilters() {
	const { epics, milestones, boardFilters, setBoardFilters, resetBoardFilters } =
		useRoadmapStore(
			useShallow((s) => ({
				epics: s.epics,
				milestones: s.milestones,
				boardFilters: s.boardFilters,
				setBoardFilters: s.setBoardFilters,
				resetBoardFilters: s.resetBoardFilters,
			})),
		);

	const epicOptions = useMemo<PillOption[]>(
		() => epics.map((e) => ({ id: e.id, label: e.title })),
		[epics],
	);

	const milestoneOptions = useMemo<PillOption[]>(
		() => milestones.map((m) => ({ id: m.id, label: m.title })),
		[milestones],
	);

	const assigneeOptions = useMemo<PillOption[]>(() => {
		const seen = new Map<string, string>();
		for (const epic of epics) {
			for (const feature of epic.features ?? []) {
				for (const task of feature.tasks ?? []) {
					if (!task.assignee_id || !task.assignee) continue;
					if (seen.has(task.assignee_id)) continue;
					const a = task.assignee;
					const label =
						a.display_name ||
						[a.first_name, a.last_name].filter(Boolean).join(" ") ||
						a.email ||
						"Unknown";
					seen.set(task.assignee_id, label);
				}
			}
		}
		return Array.from(seen.entries()).map(([id, label]) => ({ id, label }));
	}, [epics]);

	const toggle = (key: FilterKey, id: string) => {
		setBoardFilters((prev) => {
			const current = prev[key];
			return {
				...prev,
				[key]: current.includes(id)
					? current.filter((value) => value !== id)
					: [...current, id],
			};
		});
	};

	const hasAny =
		boardFilters.epicIds.length +
			boardFilters.milestoneIds.length +
			boardFilters.assigneeIds.length >
		0;

	return (
		<div className="flex flex-col gap-2 p-3 border-b border-gray-200 bg-white">
			<FilterGroup
				title="Epics"
				options={epicOptions}
				selected={boardFilters.epicIds}
				onToggle={(id) => toggle("epicIds", id)}
			/>
			<FilterGroup
				title="Milestones"
				options={milestoneOptions}
				selected={boardFilters.milestoneIds}
				onToggle={(id) => toggle("milestoneIds", id)}
			/>
			<FilterGroup
				title="Assignees"
				options={assigneeOptions}
				selected={boardFilters.assigneeIds}
				onToggle={(id) => toggle("assigneeIds", id)}
			/>
			{hasAny && (
				<button
					type="button"
					onClick={resetBoardFilters}
					className="self-start inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
				>
					<X className="w-3 h-3" />
					Clear filters
				</button>
			)}
		</div>
	);
}
