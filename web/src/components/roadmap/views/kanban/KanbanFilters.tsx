import { Check, ChevronDown, X } from "lucide-react";
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

interface AssigneeOption {
	id: string;
	label: string;
	avatarUrl?: string | null;
}

function Avatar({
	name,
	avatarUrl,
}: {
	name: string;
	avatarUrl?: string | null;
}) {
	const initials = name
		? name
				.split(/\s+/)
				.map((part) => part[0] ?? "")
				.join("")
				.slice(0, 2)
				.toUpperCase()
		: "?";
	if (avatarUrl) {
		return (
			<img
				src={avatarUrl}
				alt={name}
				className="w-6 h-6 rounded-full object-cover ring-1 ring-white"
			/>
		);
	}
	return (
		<div className="w-6 h-6 rounded-full bg-linear-to-br from-slate-700 to-slate-900 flex items-center justify-center text-white text-[9px] font-bold ring-1 ring-white shrink-0">
			{initials}
		</div>
	);
}

function AllAssigneesAvatar({ options }: { options: AssigneeOption[] }) {
	const visible = options.slice(0, 2);
	return (
		<span className="flex items-center">
			<span className="flex items-center">
				{visible.map((option, idx) => (
					<span key={option.id} className={idx > 0 ? "-ml-2" : ""}>
						<Avatar name={option.label} avatarUrl={option.avatarUrl} />
					</span>
				))}
			</span>
			{options.length > 0 && (
				<span className="-ml-2 w-6 h-6 rounded-full border border-white bg-slate-300 text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
					{options.length}
				</span>
			)}
		</span>
	);
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
			className={`flex items-center gap-2 overflow-x-auto min-w-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden ${maskClass}`}
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

function AssigneesDropdown({
	title,
	options,
	selected,
	onToggle,
	onClear,
}: {
	title: string;
	options: AssigneeOption[];
	selected: string[];
	onToggle: (id: string) => void;
	onClear: () => void;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onDown = (event: MouseEvent) => {
			if (!ref.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const selectedCount = selected.length;
	const selectedOption =
		selectedCount === 1
			? options.find((o) => o.id === selected[0]) ?? null
			: null;
	const triggerLabel = !selectedCount
		? "All assignees"
		: selectedOption
			? selectedOption.label
			: `${selectedCount} selected`;

	if (!options.length) return null;

	return (
		<div className="flex items-center gap-2 min-w-0">
			<GroupLabel>{title}</GroupLabel>
			<div ref={ref} className="relative min-w-0 flex-1">
				<button
					type="button"
					onClick={() => setOpen((prev) => !prev)}
					className="min-w-[180px] w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 cursor-pointer flex items-center justify-between gap-3 hover:bg-slate-100 transition-colors"
				>
					<span className="flex items-center gap-2 min-w-0">
						{selectedCount === 0 ? (
							<AllAssigneesAvatar options={options} />
						) : selectedOption ? (
							<Avatar
								name={selectedOption.label}
								avatarUrl={selectedOption.avatarUrl}
							/>
						) : (
							<AllAssigneesAvatar
								options={options.filter((o) => selected.includes(o.id))}
							/>
						)}
						<span className="truncate">{triggerLabel}</span>
					</span>
					<ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
				</button>

				{open && (
					<div className="absolute right-0 mt-1 w-64 rounded-lg border border-slate-200 bg-white shadow-lg z-40 py-1">
						<button
							type="button"
							onClick={() => {
								onClear();
								setOpen(false);
							}}
							className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${
								selectedCount === 0 ? "bg-slate-50 font-medium" : ""
							}`}
						>
							<span className="flex items-center gap-2">
								<AllAssigneesAvatar options={options} />
								All assignees
							</span>
						</button>

						{options.length > 0 && (
							<div className="mt-1 pt-1 border-t border-slate-100 max-h-64 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:var(--color-slate-300)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full">
								{options.map((option) => {
									const isSelected = selected.includes(option.id);
									return (
										<button
											key={option.id}
											type="button"
											onClick={() => onToggle(option.id)}
											className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${
												isSelected ? "bg-slate-50 font-medium" : ""
											}`}
										>
											<span className="flex items-center gap-2">
												<Avatar
													name={option.label}
													avatarUrl={option.avatarUrl}
												/>
												<span className="truncate">{option.label}</span>
												{isSelected ? (
													<Check className="ml-auto w-3.5 h-3.5 text-slate-900 shrink-0" />
												) : null}
											</span>
										</button>
									);
								})}
							</div>
						)}
					</div>
				)}
			</div>
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

	const featureOptions = useMemo<PillOption[]>(() => {
		if (selectedEpic) {
			return (selectedEpic.features ?? []).map((f) => ({
				id: f.id,
				label: f.title,
			}));
		}
		// "All" epics: aggregate every feature across all epics.
		return epics.flatMap((epic) =>
			(epic.features ?? []).map((f) => ({ id: f.id, label: f.title })),
		);
	}, [epics, selectedEpic]);

	const assigneeOptions = useMemo<AssigneeOption[]>(() => {
		const seen = new Map<string, AssigneeOption>();
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
					seen.set(task.assignee_id, {
						id: task.assignee_id,
						label,
						avatarUrl: a.avatar_url ?? null,
					});
				}
			}
		}
		return Array.from(seen.values());
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
				<SingleSelectGroup
					title="Features"
					options={featureOptions}
					selectedId={selectedFeatureId}
					onSelect={selectFeature}
				/>
			</div>
			<div className="col-span-3 flex flex-col justify-between gap-2.5">
				<AssigneesDropdown
					title="Assignees"
					options={assigneeOptions}
					selected={boardFilters.assigneeIds}
					onToggle={toggleAssignee}
					onClear={() =>
						setBoardFilters((prev) => ({ ...prev, assigneeIds: [] }))
					}
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
