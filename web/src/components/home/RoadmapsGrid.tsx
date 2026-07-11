import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	Briefcase,
	CheckCircle2,
	ChevronDown,
	Ellipsis,
	Layers3,
	Loader,
	ArrowRight,
	Plus,
	Trash2,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { deleteRoadmap, getRoadmapsPreview } from "@/api";
import type { RoadmapPreview } from "@/api/endpoints/roadmap";
import { isGeneratedRoadmapThumbnailDataUri } from "@/lib/roadmapThumbnail";

const ROADMAP_TAG_CLASS: Record<string, string> = {
	Active: "bg-emerald-100 text-emerald-700",
	Completed: "bg-sky-100 text-sky-700",
	Draft: "bg-amber-100 text-amber-700",
};

// Dashboard shows this many roadmap cards before the "View more" toggle reveals
// the rest with a staggered slide-up.
const INITIAL_VISIBLE_ROADMAPS = 6;

const EpicOverview = ({
	preview,
	selected,
}: {
	preview: RoadmapPreview;
	selected: boolean;
}) => {
	const MAX_EPICS = 4;

	const allEpics = [...(preview.epics || [])].sort(
		(a, b) => a.position - b.position,
	);

	// Expand the first epic by default so the nested-feature structure is visible
	// the moment the card is selected.
	const [expandedEpicIds, setExpandedEpicIds] = useState<Set<string>>(() =>
		allEpics[0] ? new Set([allEpics[0].id]) : new Set(),
	);
	const toggleEpic = (epicId: string) =>
		setExpandedEpicIds((current) => {
			const next = new Set(current);
			if (next.has(epicId)) next.delete(epicId);
			else next.add(epicId);
			return next;
		});

	// When selected the card becomes interactive: show every epic in a scroll
	// area. When not, show a tidy capped preview that doesn't trap page scroll.
	const displayedEpics = selected ? allEpics : allEpics.slice(0, MAX_EPICS);
	const remainingCount = allEpics.length - MAX_EPICS;

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<div className="mb-2 flex items-center justify-between px-1">
				<div className="flex min-w-0 items-center gap-2">
					<div className="rounded-md bg-slate-900 p-1.5 text-white shadow-sm">
						<Layers3 className="h-3.5 w-3.5" />
					</div>
					<span className="truncate text-[11px] font-bold uppercase tracking-[0.14em] text-slate-700">
						Roadmap epics
					</span>
				</div>
				<span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
					{allEpics.length}
				</span>
			</div>

			{allEpics.length === 0 ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-lg bg-slate-50 px-4 text-center">
					<p className="text-xs font-semibold text-slate-600">No epics yet</p>
					<p className="mt-1 text-[11px] leading-4 text-slate-500">
						Your roadmap is ready for its first delivery area.
					</p>
				</div>
			) : (
				<div
					className={`flex min-h-0 flex-1 flex-col gap-1 ${
						selected
							? "overflow-y-auto [scrollbar-gutter:stable] [scrollbar-width:thin] [scrollbar-color:var(--color-slate-300)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-track]:my-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 hover:[&::-webkit-scrollbar-thumb]:bg-slate-400"
							: "overflow-y-auto [scrollbar-gutter:stable] [scrollbar-width:thin] [scrollbar-color:transparent_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-button]:hidden [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-transparent"
					}`}
				>
					{displayedEpics.map((epic, index) => {
						const features = epic.features ?? [];
						const featureCount = features.length;
						const showFeatures =
							selected && expandedEpicIds.has(epic.id) && featureCount > 0;
						return (
							<div key={epic.id} className="flex shrink-0 flex-col">
								{/* Epic node — fixed height so it stays the same size
								    whether or not the card is selected. */}
								<button
									type="button"
									tabIndex={selected ? 0 : -1}
									onClick={(event) => {
										if (!selected) return;
										event.stopPropagation();
										toggleEpic(epic.id);
									}}
									className="flex h-14 w-full shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-slate-300 hover:bg-slate-50"
								>
									<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[10px] font-bold text-slate-600">
										{String(index + 1).padStart(2, "0")}
									</span>
									<div className="min-w-0 flex-1">
										<p className="truncate text-[12px] font-semibold leading-4 text-slate-900">
											{epic.title}
										</p>
										<p className="text-[10px] leading-3 text-slate-500">
											{featureCount}{" "}
											{featureCount === 1 ? "feature" : "features"}
										</p>
									</div>
									{featureCount > 0 && (
										<ChevronDown
											className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
												showFeatures ? "" : "-rotate-90"
											}`}
										/>
									)}
								</button>

								{/* Nested feature nodes — lightweight fade/slide entry
								    (opacity + transform only; no layout animation). */}
								{showFeatures && (
									<div className="ml-3 mt-1 flex flex-col gap-1 border-l border-slate-200 pl-3 duration-200 ease-out animate-in fade-in slide-in-from-top-1 motion-reduce:animate-none">
										{features.map((feature) => {
											const taskCount = feature.tasks?.length ?? 0;
											return (
												<div
													key={feature.id}
													className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1.5"
												>
													<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
													<p className="min-w-0 flex-1 truncate text-[11px] font-medium leading-4 text-slate-700">
														{feature.title}
													</p>
													{taskCount > 0 && (
														<span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">
															{taskCount}
														</span>
													)}
												</div>
											);
										})}
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}

			{!selected && remainingCount > 0 && (
				<div className="mt-2 border-t border-slate-200/80 pt-2 text-center">
					<span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
						+{remainingCount} more {remainingCount === 1 ? "epic" : "epics"}
					</span>
				</div>
			)}
		</div>
	);
};

function getProjectSettingsPath(projectId: string): string {
	return `/project/${projectId}/settings/general`;
}

export function RoadmapsGrid() {
	const queryClient = useQueryClient();
	const roadmapsSectionId = useId();
	const [openMenuRoadmapId, setOpenMenuRoadmapId] = useState<string | null>(
		null,
	);
	const [deletingRoadmapId, setDeletingRoadmapId] = useState<string | null>(
		null,
	);
	const [selectedRoadmapId, setSelectedRoadmapId] = useState<string | null>(
		null,
	);
	const [showAllRoadmaps, setShowAllRoadmaps] = useState(false);

	useEffect(() => {
		const handleOutsideClick = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			if (!target.closest("[data-roadmap-menu]")) {
				setOpenMenuRoadmapId(null);
			}
			// Deselect when clicking outside any roadmap card.
			if (!target.closest("[data-roadmap-card]")) {
				setSelectedRoadmapId(null);
			}
		};

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setOpenMenuRoadmapId(null);
				setSelectedRoadmapId(null);
			}
		};

		document.addEventListener("mousedown", handleOutsideClick);
		document.addEventListener("keydown", handleEscape);

		return () => {
			document.removeEventListener("mousedown", handleOutsideClick);
			document.removeEventListener("keydown", handleEscape);
		};
	}, []);

	const deleteRoadmapMutation = useMutation({
		mutationFn: (roadmapId: string) => deleteRoadmap(roadmapId),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["dashboard", "roadmaps-preview"],
			});
		},
	});

	const handleDeleteRoadmap = async (
		roadmapId: string,
		roadmapName: string,
		projectId?: string | null,
	) => {
		if (projectId) {
			return;
		}

		const confirmed = window.confirm(
			`Delete roadmap "${roadmapName}"?\n\nThis action cannot be undone.`,
		);
		if (!confirmed) return;

		try {
			setDeletingRoadmapId(roadmapId);
			await deleteRoadmapMutation.mutateAsync(roadmapId);
			setOpenMenuRoadmapId(null);
		} catch (error) {
			console.error("[RoadmapsGrid] Failed to delete roadmap", error);
			window.alert("Failed to delete roadmap. Please try again.");
		} finally {
			setDeletingRoadmapId(null);
		}
	};

	const roadmapsQuery = useQuery({
		queryKey: ["dashboard", "roadmaps-preview"],
		queryFn: () => getRoadmapsPreview(),
		staleTime: 30 * 1000,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: 1,
	});
	const loading = roadmapsQuery.isPending;
	const isUnavailable = Boolean(roadmapsQuery.error);
	const templates = useMemo(
		() =>
			(roadmapsQuery.data ?? []).map(
				(roadmap: RoadmapPreview, index: number) => ({
					id: roadmap.id,
					title: roadmap.name,
					category: roadmap.description || "Project Roadmap",
					milestones: "View plan",
					budget: "Custom",
					tag:
						index === 0
							? "Active"
							: roadmap.status === "completed"
								? "Completed"
								: "Draft",
					preview: roadmap,
				}),
			),
		[roadmapsQuery.data],
	);
	const hasMoreRoadmaps = templates.length > INITIAL_VISIBLE_ROADMAPS;
	const visibleTemplates = showAllRoadmaps
		? templates
		: templates.slice(0, INITIAL_VISIBLE_ROADMAPS);

	return (
		<div
			id={roadmapsSectionId}
			data-roadmaps-section="my-roadmaps-section"
			className="app-slide-up"
		>
			<div className="mb-6">
				<div className="flex items-center justify-between mb-1">
					<div className="flex items-center gap-2">
						<div className="h-3 w-3 rounded-full bg-slate-900 sm:h-[18px] sm:w-[18px]" />
						<h2 className="text-base font-semibold tracking-tight text-slate-900 sm:text-[20px]">
							MY ROADMAPS
						</h2>
					</div>
				</div>
				<p className="mt-1 text-xs text-slate-600">
					Each matched project unlocks a consultant-led roadmap for structured execution
				</p>
			</div>

			{loading ? (
				<div className="flex justify-center items-center py-20">
					<Loader className="w-8 h-8 animate-spin text-primary" />
				</div>
			) : isUnavailable ? (
				<div className="rounded-2xl border border-dashed border-slate-300 bg-white py-12 text-center shadow-sm">
					<p className="mb-2 font-semibold text-slate-900">
						Your roadmap workspace is preparing
					</p>
					<p className="text-sm text-slate-600">
						After consultant matching starts, your roadmap appears here with milestones and execution phases.
					</p>
				</div>
			) : templates.length === 0 ? (
				<div className="rounded-2xl border border-dashed border-slate-300 bg-white py-12 text-center shadow-sm">
					<p className="mb-2 font-semibold text-slate-900">
						Your first roadmap is taking shape
					</p>
					<p className="text-sm text-slate-600">
						Post your project vision to trigger consultant matching and automatically generate your roadmap.
					</p>
					<Link
						to="/project/$projectId/roadmap/create"
						params={{ projectId: "n" }}
						className="mt-5 inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
					>
						<Plus className="h-4 w-4" />
						Create roadmap
					</Link>
				</div>
			) : (
				<>
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 items-stretch">
						{visibleTemplates.map((template, index) => {
							const isSelected = selectedRoadmapId === template.id;
							// Select-only (not toggle): clicking inside a selected card —
							// e.g. a feature node — must never deselect it. Deselect is
							// handled by outside-click / Escape / selecting another card.
							const selectCard = () =>
								setSelectedRoadmapId(template.id);
							return (
							<div
								key={template.id}
								data-roadmap-card
								role="button"
								tabIndex={0}
								aria-pressed={isSelected}
								onClick={selectCard}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										selectCard();
									}
								}}
								className={`group relative flex h-auto cursor-pointer flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg sm:h-[420px] ${
									isSelected
										? "border-slate-900 ring-2 ring-slate-900/70 shadow-lg"
										: "border-slate-200 hover:border-slate-400"
								} ${index >= INITIAL_VISIBLE_ROADMAPS ? "app-slide-up" : ""}`}
								style={
									index >= INITIAL_VISIBLE_ROADMAPS
										? {
												animationDelay: `${(index - INITIAL_VISIBLE_ROADMAPS) * 60}ms`,
											}
										: undefined
								}
							>
								<div className="absolute top-3 right-3 z-20" data-roadmap-menu>
									<button
										type="button"
										onClick={(event) => {
											event.stopPropagation();
											setOpenMenuRoadmapId((current) =>
												current === template.id ? null : template.id,
											);
										}}
										className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900"
										aria-label="Open roadmap actions"
									>
										<Ellipsis className="h-4 w-4" />
									</button>

									{openMenuRoadmapId === template.id ? (
										<div className="absolute right-0 mt-2 w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
											{template.preview.project_id ? (
												<Link
									to={getProjectSettingsPath(template.preview.project_id)}
													className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
													onClick={(event) => {
														event.stopPropagation();
														setOpenMenuRoadmapId(null);
													}}
												>
													<Briefcase className="h-4 w-4" />
													Project settings
												</Link>
											) : (
												<button
													type="button"
													onClick={(event) => {
														event.stopPropagation();
														handleDeleteRoadmap(
															template.id,
															template.title,
															template.preview.project_id,
														);
													}}
													disabled={deletingRoadmapId === template.id}
													className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
												>
													<Trash2 className="h-4 w-4" />
													{deletingRoadmapId === template.id
														? "Deleting..."
														: "Delete roadmap"}
												</button>
											)}
										</div>
									) : null}
								</div>

								<div className="flex h-full flex-col">
									<div className="h-[330px] overflow-hidden p-4">
										{template.preview.preview_url?.trim() &&
										!isGeneratedRoadmapThumbnailDataUri(
											template.preview.preview_url,
										) ? (
											<img
												src={template.preview.preview_url}
												alt={template.title}
												className="w-full h-full object-cover rounded-lg"
											/>
										) : (
											<EpicOverview
												preview={template.preview}
												selected={isSelected}
											/>
										)}
									</div>
									<div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-2.5">
										<div className="flex items-start justify-between gap-2">
											<h3 className="truncate text-[15px] font-semibold leading-tight tracking-tight text-slate-900">
												{template.title}
											</h3>
											<span
												className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${ROADMAP_TAG_CLASS[template.tag] ?? "bg-slate-100 text-slate-700"}`}
											>
												{template.tag}
											</span>
										</div>
										<p className="mt-0.5 line-clamp-1 text-[12px] text-slate-600">
											{template.category}
										</p>
										<div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
											{template.preview.project_id ? (
												<span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
													<Briefcase className="h-3 w-3 shrink-0" />
													Linked
												</span>
											) : (
												<span />
											)}
											{isSelected ? (
												<Link
													to="/project/$projectId/roadmap/$roadmapId"
													params={{
														projectId:
															template.preview.project_id || "n",
														roadmapId: template.id,
													}}
													onClick={(event) => event.stopPropagation()}
													className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-slate-900 px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm transition-colors hover:bg-slate-700"
												>
													Open roadmap
													<ArrowRight className="h-3.5 w-3.5 shrink-0" />
												</Link>
											) : (
												<span className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-semibold uppercase text-slate-500 transition-colors group-hover:text-slate-700">
													<CheckCircle2 className="h-3 w-3 shrink-0" />
													Click to open
													<ArrowRight className="h-3.5 w-3.5 shrink-0" />
												</span>
											)}
										</div>
									</div>
								</div>
							</div>
							);
						})}
					</div>
					{hasMoreRoadmaps ? (
						<div className="mt-6 flex justify-center">
							<button
								type="button"
								onClick={() => setShowAllRoadmaps((prev) => !prev)}
								aria-expanded={showAllRoadmaps}
								data-testid="roadmaps-view-more"
								className="group inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-400 hover:text-slate-900 hover:shadow-md"
							>
								<span>
									{showAllRoadmaps
										? "Show less"
										: `View more (${templates.length - INITIAL_VISIBLE_ROADMAPS})`}
								</span>
								<ChevronDown
									className={`h-4 w-4 text-slate-500 transition-transform duration-300 group-hover:text-slate-700 ${
										showAllRoadmaps ? "rotate-180" : ""
									}`}
								/>
							</button>
						</div>
					) : null}
				</>
			)}
		</div>
	);
}
