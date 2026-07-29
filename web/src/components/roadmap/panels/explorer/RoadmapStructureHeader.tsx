import {
	ChevronRight,
	FileText,
	Folder,
	FolderOpen,
	Layers,
	Search,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RoadmapEpic } from "@/types/roadmap";

export type ExplorerMode = "roadmap" | "timeline";

export interface RoadmapStructureExplorerConfig {
	mode: ExplorerMode;
	allowFeatureCollapse: boolean;
	showTaskRows: boolean;
}

export const ROADMAP_STRUCTURE_EXPLORER_CONFIG: Record<
	ExplorerMode,
	RoadmapStructureExplorerConfig
> = {
	roadmap: {
		mode: "roadmap",
		allowFeatureCollapse: true,
		showTaskRows: true,
	},
	timeline: {
		mode: "timeline",
		allowFeatureCollapse: false,
		showTaskRows: false,
	},
};

export interface ExplorerSearchResult {
	type: "epic" | "feature" | "task";
	id: string;
	title: string;
	epicId?: string;
	featureId?: string;
	epicTitle?: string;
	featureTitle?: string;
}

export function getSortedEpics(epics: RoadmapEpic[]): RoadmapEpic[] {
	return [...epics].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export function getRoadmapStructureStats(epics: RoadmapEpic[]) {
	const totalFeatures = epics.reduce(
		(sum, epic) => sum + (epic.features?.length ?? 0),
		0,
	);
	const totalTasks = epics.reduce(
		(sum, epic) =>
			sum +
			(epic.features?.reduce(
				(featureSum, feature) => featureSum + (feature.tasks?.length ?? 0),
				0,
			) ?? 0),
		0,
	);

	return {
		totalEpics: epics.length,
		totalFeatures,
		totalTasks,
	};
}

export function buildExplorerSearchResults(
	epics: RoadmapEpic[],
	query: string,
): ExplorerSearchResult[] {
	if (!query.trim()) return [];

	const normalized = query.toLowerCase();
	const sortedEpics = getSortedEpics(epics);
	const results: ExplorerSearchResult[] = [];

	for (const epic of sortedEpics) {
		if (epic.title.toLowerCase().includes(normalized)) {
			results.push({
				type: "epic",
				id: epic.id,
				title: epic.title,
			});
		}

		for (const feature of epic.features ?? []) {
			if (feature.title.toLowerCase().includes(normalized)) {
				results.push({
					type: "feature",
					id: feature.id,
					title: feature.title,
					epicId: epic.id,
					epicTitle: epic.title,
				});
			}

			for (const task of feature.tasks ?? []) {
				if (task.title.toLowerCase().includes(normalized)) {
					results.push({
						type: "task",
						id: task.id,
						title: task.title,
						epicId: epic.id,
						featureId: feature.id,
						epicTitle: epic.title,
						featureTitle: feature.title,
					});
				}
			}
		}
	}

	return results;
}

interface RoadmapStructureHeaderProps {
	epics: RoadmapEpic[];
	onSearchResultSelect: (result: ExplorerSearchResult) => void;
	hasAnyExpanded: boolean;
	onToggleCollapseAll: () => void;
	showCollapseToggle?: boolean;
	searchPlaceholder?: string;
	className?: string;
	footerContent?: ReactNode;
}

export function RoadmapStructureHeader({
	epics,
	onSearchResultSelect,
	hasAnyExpanded,
	onToggleCollapseAll,
	showCollapseToggle = true,
	searchPlaceholder = "Search epics, features, tasks...",
	className = "min-w-0 border-b border-border bg-card px-4 py-4",
	footerContent,
}: RoadmapStructureHeaderProps) {
	const [searchQuery, setSearchQuery] = useState("");
	const [showSearchPopup, setShowSearchPopup] = useState(false);
	const searchRef = useRef<HTMLDivElement>(null);

	const sortedEpics = useMemo(() => getSortedEpics(epics), [epics]);
	const searchResults = useMemo(
		() => buildExplorerSearchResults(sortedEpics, searchQuery),
		[sortedEpics, searchQuery],
	);
	const { totalEpics, totalFeatures, totalTasks } = useMemo(
		() => getRoadmapStructureStats(sortedEpics),
		[sortedEpics],
	);

	useEffect(() => {
		if (!searchQuery.trim()) {
			setShowSearchPopup(false);
			return;
		}
		setShowSearchPopup(searchResults.length > 0);
	}, [searchQuery, searchResults.length]);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				searchRef.current &&
				!searchRef.current.contains(event.target as Node)
			) {
				setShowSearchPopup(false);
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, []);

	return (
		<div className={className}>
			<div className="flex items-center justify-between mb-2">
				<h2 className="text-base font-semibold text-foreground">
					Roadmap Structure
				</h2>
				{totalEpics > 0 && (
					<span className="text-xs font-medium text-muted-foreground">
						{totalEpics} {totalEpics === 1 ? "epic" : "epics"}
					</span>
				)}
			</div>

			<div className="relative mb-3" ref={searchRef}>
				<div className="relative">
					<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<input
						type="text"
						placeholder={searchPlaceholder}
						value={searchQuery}
						onChange={(event) => setSearchQuery(event.target.value)}
						onFocus={() => {
							if (searchResults.length > 0) {
								setShowSearchPopup(true);
							}
						}}
						className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-transparent focus:ring-2 focus:ring-primary"
					/>
					{searchQuery && (
						<button
							type="button"
							onClick={() => {
								setSearchQuery("");
								setShowSearchPopup(false);
							}}
							className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
						>
							<X className="w-4 h-4" />
						</button>
					)}
				</div>

				{showSearchPopup && searchResults.length > 0 && (
					<div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
						<div className="py-1">
							<div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
								{searchResults.length}{" "}
								{searchResults.length === 1 ? "result" : "results"}
							</div>
							<div className="space-y-0">
								{searchResults.map((result, index) => (
									<button
										type="button"
										key={`${result.type}-${result.id}-${index}`}
										onClick={() => {
											setShowSearchPopup(false);
											setSearchQuery("");
											onSearchResultSelect(result);
										}}
										className="group w-full border-b border-border px-3 py-1.5 text-left transition-colors last:border-b-0 hover:bg-muted"
									>
										<div className="flex items-center gap-2">
											{result.type === "epic" && (
												<FolderOpen className="w-3.5 h-3.5 text-purple-500 shrink-0" />
											)}
											{result.type === "feature" && (
												<Layers className="w-3.5 h-3.5 text-blue-500 shrink-0" />
											)}
											{result.type === "task" && (
												<FileText className="w-3.5 h-3.5 text-green-500 shrink-0" />
											)}

											<div className="flex-1 min-w-0">
												<div className="truncate text-sm font-medium text-foreground group-hover:text-primary">
													{result.title}
												</div>
												{(result.epicTitle || result.featureTitle) && (
													<div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
														{result.type === "feature" && result.epicTitle && (
															<div className="flex items-center gap-1">
																<ChevronRight className="w-2.5 h-2.5" />
																<span className="truncate">
																	{result.epicTitle}
																</span>
															</div>
														)}
														{result.type === "task" && (
															<>
																{result.epicTitle && (
																	<>
																		<ChevronRight className="w-2.5 h-2.5" />
																		<span className="truncate max-w-[100px]">
																			{result.epicTitle}
																		</span>
																	</>
																)}
																{result.featureTitle && (
																	<>
																		<ChevronRight className="w-2.5 h-2.5" />
																		<span className="truncate max-w-[100px]">
																			{result.featureTitle}
																		</span>
																	</>
																)}
															</>
														)}
													</div>
												)}
											</div>
										</div>
									</button>
								))}
							</div>
						</div>
					</div>
				)}
			</div>

			{totalEpics > 0 && (
				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-3 text-xs text-gray-600">
						<div className="flex items-center gap-1.5">
							<Layers className="w-3.5 h-3.5" />
							<span>
								{totalFeatures} {totalFeatures === 1 ? "feature" : "features"}
							</span>
						</div>
						<div className="flex items-center gap-1.5">
							<FileText className="w-3.5 h-3.5" />
							<span>
								{totalTasks} {totalTasks === 1 ? "task" : "tasks"}
							</span>
						</div>
					</div>
					<div className="flex items-center gap-1">
						{footerContent}
						{showCollapseToggle && (
							<button
								type="button"
								onClick={onToggleCollapseAll}
								className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
								title={hasAnyExpanded ? "Collapse all" : "Uncollapse all"}
								aria-label={hasAnyExpanded ? "Collapse all" : "Uncollapse all"}
							>
								{hasAnyExpanded ? (
									<Folder className="w-3.5 h-3.5" />
								) : (
									<FolderOpen className="w-3.5 h-3.5" />
								)}
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
