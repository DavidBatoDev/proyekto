import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ArrowRight,
	Briefcase,
	CheckCircle2,
	ChevronDown,
	Ellipsis,
	Loader,
	Plus,
	Trash2,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { deleteRoadmap, getRoadmapsPreview } from "@/api";
import type { RoadmapPreview } from "@/api/endpoints/roadmap";
import { ProjectStatusBadge } from "@/components/common/SemanticBadge";
import { RoadmapPreviewCard } from "@/components/home/RoadmapPreviewCard";

// Dashboard shows this many roadmap cards before the "View more" toggle reveals
// the rest with a staggered slide-up.
const INITIAL_VISIBLE_ROADMAPS = 6;

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
				<div className="mb-1 flex items-center justify-between gap-3">
					<div className="flex items-center gap-2">
						<div className="h-3 w-3 rounded-full bg-primary sm:h-[18px] sm:w-[18px]" />
						<h2 className="text-base font-semibold tracking-tight text-slate-900 sm:text-[20px]">
							MY ROADMAPS
						</h2>
					</div>
					<Link
						to="/project/$projectId/roadmap/create"
						params={{ projectId: "n" }}
						className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-primary/90 sm:px-3 sm:text-sm"
					>
						<Plus className="h-3.5 w-3.5" />
						New roadmap
					</Link>
				</div>
				<p className="mt-1 text-xs text-slate-600">
					Each matched project unlocks a consultant-led roadmap for structured
					execution
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
						After consultant matching starts, your roadmap appears here with
						milestones and execution phases.
					</p>
				</div>
			) : templates.length === 0 ? (
				<div className="rounded-2xl border border-dashed border-slate-300 bg-white py-12 text-center shadow-sm">
					<p className="mb-2 font-semibold text-slate-900">
						Your first roadmap is taking shape
					</p>
					<p className="text-sm text-slate-600">
						Post your project vision to trigger consultant matching and
						automatically generate your roadmap.
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
							const selectCard = () => setSelectedRoadmapId(template.id);
							return (
								<RoadmapPreviewCard
									key={template.id}
									variant="roadmap"
									title={template.title}
									description={template.category}
									epics={template.preview.epics}
									selected={isSelected}
									onSelect={selectCard}
									className={
										index >= INITIAL_VISIBLE_ROADMAPS ? "app-slide-up" : ""
									}
									style={
										index >= INITIAL_VISIBLE_ROADMAPS
											? {
													animationDelay: `${
														(index - INITIAL_VISIBLE_ROADMAPS) * 60
													}ms`,
												}
											: undefined
									}
									menu={
										<div
											className="absolute top-3 right-3 z-20"
											data-roadmap-menu
										>
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
															to={getProjectSettingsPath(
																template.preview.project_id,
															)}
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
									}
									status={
										<ProjectStatusBadge
											status={template.tag}
											className="shrink-0"
										/>
									}
									footerLeading={
										template.preview.project_id ? (
											<span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
												<Briefcase className="h-3 w-3 shrink-0" />
												Linked
											</span>
										) : undefined
									}
									footerAction={
										isSelected ? (
											<Link
												to="/project/$projectId/roadmap/$roadmapId"
												params={{
													projectId: template.preview.project_id || "n",
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
										)
									}
								/>
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
