import { X } from "lucide-react";
import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { useRoadmapStore } from "@/stores/roadmapStore";

interface PillOption {
	id: string;
	label: string;
}

function pillClass(isActive: boolean) {
	return `shrink-0 px-2.5 py-1 rounded-full text-xs font-medium border transition-all duration-150 ${
		isActive
			? "bg-slate-900 text-white border-slate-900 shadow-sm"
			: "bg-white text-slate-600 border-slate-200 hover:border-slate-400 hover:text-slate-900 hover:bg-slate-50"
	}`;
}

function ScrollRow({ children }: { children: ReactNode }) {
	const ref = useRef<HTMLDivElement>(null);
	const [atLeft, setAtLeft] = useState(true);
	const [atRight, setAtRight] = useState(true);

	const measure = () => {
		const el = ref.current;
		if (!el) return;
		const { scrollLeft, scrollWidth, clientWidth } = el;
		setAtLeft(scrollLeft <= 0);
		setAtRight(scrollLeft + clientWidth >= scrollWidth - 1);
	};

	useLayoutEffect(measure);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const onScroll = () => measure();
		el.addEventListener("scroll", onScroll, { passive: true });
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => {
			el.removeEventListener("scroll", onScroll);
			observer.disconnect();
		};
	}, []);

	const maskClass =
		atLeft && atRight
			? ""
			: atLeft
				? "mask-[linear-gradient(to_right,black,black_calc(100%-20px),transparent)]"
				: atRight
					? "mask-[linear-gradient(to_right,transparent,black_20px,black)]"
					: "mask-[linear-gradient(to_right,transparent,black_20px,black_calc(100%-20px),transparent)]";

	return (
		<div
			ref={ref}
			className={`flex items-center gap-2 overflow-x-auto no-scrollbar min-w-0 ${maskClass}`}
		>
			{children}
		</div>
	);
}

function GroupLabel({ children }: { children: React.ReactNode }) {
	return (
		<span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 shrink-0 min-w-16">
			{children}
		</span>
	);
}

function SingleSelectGroup({
	title,
	options,
	selectedId,
	onSelect,
}: {
	title: string;
	options: PillOption[];
	selectedId: string | null;
	onSelect: (id: string | null) => void;
}) {
	return (
		<div className="flex items-center gap-2 min-w-0">
			<GroupLabel>{title}</GroupLabel>
			<ScrollRow>
				<button
					type="button"
					onClick={() => onSelect(null)}
					className={pillClass(selectedId === null)}
				>
					All
				</button>
				{options.map((option) => (
					<button
						key={option.id}
						type="button"
						onClick={() => onSelect(option.id)}
						className={pillClass(selectedId === option.id)}
					>
						{option.label}
					</button>
				))}
			</ScrollRow>
		</div>
	);
}

function MultiSelectGroup({
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
		<div className="flex items-center gap-2 min-w-0">
			<GroupLabel>{title}</GroupLabel>
			<ScrollRow>
				{options.map((option) => (
					<button
						key={option.id}
						type="button"
						onClick={() => onToggle(option.id)}
						className={pillClass(selected.includes(option.id))}
					>
						{option.label}
					</button>
				))}
			</ScrollRow>
		</div>
	);
}

export function KanbanFilters() {
	const { epics, boardFilters, setBoardFilters, resetBoardFilters } =
		useRoadmapStore(
			useShallow((s) => ({
				epics: s.epics,
				boardFilters: s.boardFilters,
				setBoardFilters: s.setBoardFilters,
				resetBoardFilters: s.resetBoardFilters,
			})),
		);

	const epicOptions = useMemo<PillOption[]>(
		() => epics.map((e) => ({ id: e.id, label: e.title })),
		[epics],
	);

	const selectedEpicId =
		boardFilters.epicIds.length === 1 ? boardFilters.epicIds[0] : null;
	const selectedFeatureId =
		boardFilters.featureIds.length === 1 ? boardFilters.featureIds[0] : null;

	const selectedEpic = useMemo(
		() => (selectedEpicId ? epics.find((e) => e.id === selectedEpicId) ?? null : null),
		[epics, selectedEpicId],
	);

	const featureOptions = useMemo<PillOption[]>(
		() =>
			(selectedEpic?.features ?? []).map((f) => ({
				id: f.id,
				label: f.title,
			})),
		[selectedEpic],
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

	const selectEpic = (id: string | null) =>
		setBoardFilters((prev) => ({
			...prev,
			epicIds: id ? [id] : [],
			featureIds: [],
		}));

	const selectFeature = (id: string | null) =>
		setBoardFilters((prev) => ({
			...prev,
			featureIds: id ? [id] : [],
		}));

	const toggleAssignee = (id: string) =>
		setBoardFilters((prev) => ({
			...prev,
			assigneeIds: prev.assigneeIds.includes(id)
				? prev.assigneeIds.filter((v) => v !== id)
				: [...prev.assigneeIds, id],
		}));

	const hasAny =
		boardFilters.epicIds.length +
			boardFilters.featureIds.length +
			boardFilters.assigneeIds.length >
		0;

	return (
		<div className="grid grid-cols-10 gap-6 px-4 py-3 border-b border-slate-200 bg-linear-to-b from-slate-50 to-white min-h-24">
			<div className="col-span-7 flex flex-col gap-2.5 pr-6 border-r border-slate-200">
				<SingleSelectGroup
					title="Epics"
					options={epicOptions}
					selectedId={selectedEpicId}
					onSelect={selectEpic}
				/>
				{selectedEpic && (
					<SingleSelectGroup
						title="Features"
						options={featureOptions}
						selectedId={selectedFeatureId}
						onSelect={selectFeature}
					/>
				)}
			</div>
			<div className="col-span-3 flex flex-col justify-between gap-2.5">
				<MultiSelectGroup
					title="Assignees"
					options={assigneeOptions}
					selected={boardFilters.assigneeIds}
					onToggle={toggleAssignee}
				/>
				<div className="flex justify-end">
					{hasAny ? (
						<button
							type="button"
							onClick={resetBoardFilters}
							className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-100 hover:text-slate-900"
						>
							<X className="w-3 h-3" />
							Clear filters
						</button>
					) : null}
				</div>
			</div>
		</div>
	);
}
