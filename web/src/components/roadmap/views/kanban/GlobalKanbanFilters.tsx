import { Check, ChevronDown, Search, X } from "lucide-react";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { FullRoadmapWithProject } from "@/services/roadmap.service";
import type { GlobalBoardFilters } from "./GlobalKanbanView";

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
				.map((p) => p[0] ?? "")
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
			? "bg-primary text-white border-primary shadow-sm"
			: "bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 border-slate-200 hover:border-slate-400"
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

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally stable — same pattern as KanbanFilters.tsx
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

function FilterRow({
	tagLabel,
	options,
	selectedId,
	onSelect,
}: {
	tagLabel: string;
	options: PillOption[];
	selectedId: string | null;
	onSelect: (id: string | null) => void;
}) {
	const [query, setQuery] = useState("");
	const q = query.trim().toLowerCase();
	// Keep the currently-selected option visible even if it doesn't match the
	// query, so an active selection never disappears while searching.
	const visibleOptions = q
		? options.filter(
				(o) => o.label.toLowerCase().includes(q) || o.id === selectedId,
			)
		: options;

	return (
		<div className="flex items-center gap-2.5 min-w-0 flex-1 relative z-1">
			<span className="shrink-0 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md border bg-white text-black border-black">
				{tagLabel}
			</span>
			{options.length > 1 && (
				<div className="relative shrink-0 w-36">
					<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder={`Search ${tagLabel.toLowerCase()}`}
						className="w-full pl-8 pr-7 py-1 text-xs border border-input bg-background text-foreground placeholder:text-muted-foreground rounded-full focus:outline-none focus:ring-2 focus:ring-ring"
					/>
					{query && (
						<button
							type="button"
							onClick={() => setQuery("")}
							className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
							aria-label="Clear search"
						>
							<X className="w-3.5 h-3.5" />
						</button>
					)}
				</div>
			)}
			<ScrollRow>
				<button
					type="button"
					onClick={() => onSelect(null)}
					className={pillClass(selectedId === null)}
				>
					All
				</button>
				{visibleOptions.map((option) => (
					<button
						key={option.id}
						type="button"
						onClick={() => onSelect(option.id)}
						className={pillClass(selectedId === option.id)}
					>
						{option.label}
					</button>
				))}
				{q && visibleOptions.length === 0 && (
					<span className="shrink-0 text-xs text-slate-400 italic px-1">
						No matches
					</span>
				)}
			</ScrollRow>
		</div>
	);
}

function AssigneesDropdown({
	options,
	selected,
	onToggle,
	onClear,
}: {
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
			? (options.find((o) => o.id === selected[0]) ?? null)
			: null;
	const triggerLabel = !selectedCount
		? "All assignees"
		: selectedOption
			? selectedOption.label
			: `${selectedCount} selected`;

	return (
		<div className="flex items-center gap-2 min-w-0">
			<span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 shrink-0 min-w-16">
				Assignees
			</span>
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
							className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${selectedCount === 0 ? "bg-slate-50 font-medium" : ""}`}
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
											className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${isSelected ? "bg-slate-50 font-medium" : ""}`}
										>
											<span className="flex items-center gap-2">
												<Avatar
													name={option.label}
													avatarUrl={option.avatarUrl}
												/>
												<span className="truncate">{option.label}</span>
												{isSelected && (
													<Check className="ml-auto w-3.5 h-3.5 text-slate-900 shrink-0" />
												)}
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

interface GlobalKanbanFiltersProps {
	roadmaps: FullRoadmapWithProject[];
	filters: GlobalBoardFilters;
	onChange: (filters: GlobalBoardFilters) => void;
	searchQuery: string;
	onSearchChange: (value: string) => void;
}

export function GlobalKanbanFilters({
	roadmaps,
	filters,
	onChange,
	searchQuery,
	onSearchChange,
}: GlobalKanbanFiltersProps) {
	const projectOptions = useMemo<PillOption[]>(() => {
		const seen = new Set<string>();
		const opts: PillOption[] = [];
		for (const r of roadmaps) {
			if (!r.project?.id || seen.has(r.project.id)) continue;
			seen.add(r.project.id);
			opts.push({ id: r.project.id, label: r.project.title });
		}
		return opts;
	}, [roadmaps]);

	const selectedProjectRoadmaps = useMemo(() => {
		if (!filters.projectId) return roadmaps;
		return roadmaps.filter((r) => r.project?.id === filters.projectId);
	}, [roadmaps, filters.projectId]);

	const epicOptions = useMemo<PillOption[]>(
		() =>
			selectedProjectRoadmaps.flatMap((r) =>
				(r.epics ?? []).map((e) => ({ id: e.id, label: e.title })),
			),
		[selectedProjectRoadmaps],
	);

	const selectedEpic = useMemo(() => {
		if (!filters.epicId) return null;
		for (const r of selectedProjectRoadmaps) {
			const found = (r.epics ?? []).find((e) => e.id === filters.epicId);
			if (found) return found;
		}
		return null;
	}, [selectedProjectRoadmaps, filters.epicId]);

	const featureOptions = useMemo<PillOption[]>(() => {
		if (selectedEpic) {
			return (selectedEpic.features ?? []).map((f) => ({
				id: f.id,
				label: f.title,
			}));
		}
		return selectedProjectRoadmaps.flatMap((r) =>
			(r.epics ?? []).flatMap((e) =>
				(e.features ?? []).map((f) => ({ id: f.id, label: f.title })),
			),
		);
	}, [selectedProjectRoadmaps, selectedEpic]);

	const assigneeOptions = useMemo<AssigneeOption[]>(() => {
		const seen = new Map<string, AssigneeOption>();
		for (const r of selectedProjectRoadmaps) {
			for (const epic of r.epics ?? []) {
				for (const feature of epic.features ?? []) {
					for (const task of feature.tasks ?? []) {
						if (
							!task.assignee_id ||
							!task.assignee ||
							seen.has(task.assignee_id)
						)
							continue;
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
		}
		return Array.from(seen.values());
	}, [selectedProjectRoadmaps]);

	const selectProject = (id: string | null) =>
		onChange({
			projectId: id,
			epicId: null,
			featureId: null,
			assigneeIds: filters.assigneeIds,
		});

	const selectEpic = (id: string | null) =>
		onChange({ ...filters, epicId: id, featureId: null });

	const selectFeature = (id: string | null) =>
		onChange({ ...filters, featureId: id });

	const toggleAssignee = (id: string) =>
		onChange({
			...filters,
			assigneeIds: filters.assigneeIds.includes(id)
				? filters.assigneeIds.filter((v) => v !== id)
				: [...filters.assigneeIds, id],
		});

	const hasAny =
		!!filters.projectId ||
		!!filters.epicId ||
		!!filters.featureId ||
		filters.assigneeIds.length > 0 ||
		searchQuery.trim().length > 0;

	return (
		<div className="grid grid-cols-10 gap-6 px-4 py-3 border-b border-border bg-card text-card-foreground">
			<div className="col-span-7 flex flex-col gap-2.5 pr-6 border-r border-border relative">
				<div className="flex items-center min-w-0">
					<FilterRow
						tagLabel="Projects"
						options={projectOptions}
						selectedId={filters.projectId}
						onSelect={selectProject}
					/>
				</div>
				<div className="relative pl-8 flex items-center min-w-0">
					<div className="absolute left-4 top-[-23px] w-4 h-[36px] border-l-2 border-b-2 border-slate-300 rounded-bl-xl pointer-events-none" />
					<FilterRow
						tagLabel="Epics"
						options={epicOptions}
						selectedId={filters.epicId}
						onSelect={selectEpic}
					/>
				</div>
				<div className="relative pl-16 flex items-center min-w-0">
					<div className="absolute left-12 top-[-23px] w-4 h-[36px] border-l-2 border-b-2 border-slate-300 rounded-bl-xl pointer-events-none" />
					<FilterRow
						tagLabel="Features"
						options={featureOptions}
						selectedId={filters.featureId}
						onSelect={selectFeature}
					/>
				</div>
			</div>
			<div className="col-span-3 flex flex-col gap-2.5">
				<AssigneesDropdown
					options={assigneeOptions}
					selected={filters.assigneeIds}
					onToggle={toggleAssignee}
					onClear={() => onChange({ ...filters, assigneeIds: [] })}
				/>
				<div className="flex items-center gap-2">
					<div className="relative flex-1 min-w-0">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
						<input
							value={searchQuery}
							onChange={(e) => onSearchChange(e.target.value)}
							placeholder="Search features & tasks…"
							className="w-full pl-9 pr-8 py-2 text-sm border border-input bg-background text-foreground placeholder:text-muted-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
						/>
						{searchQuery && (
							<button
								type="button"
								onClick={() => onSearchChange("")}
								className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
								aria-label="Clear search"
							>
								<X className="w-4 h-4" />
							</button>
						)}
					</div>
					<button
						type="button"
						onClick={() => {
							onSearchChange("");
							onChange({
								projectId: null,
								epicId: null,
								featureId: null,
								assigneeIds: [],
							});
						}}
						className={`shrink-0 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-100 hover:text-slate-900 ${
							hasAny ? "" : "invisible"
						}`}
						title="Clear filters"
					>
						<X className="w-3 h-3" />
						Clear
					</button>
				</div>
			</div>
		</div>
	);
}
