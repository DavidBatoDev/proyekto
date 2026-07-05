import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	Briefcase,
	CheckCircle2,
	Ellipsis,
	Inbox,
	Loader,
	ArrowRight,
	Plus,
	Trash2,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { deleteRoadmap, getRoadmapsPreview } from "@/api";
import type { RoadmapPreview } from "@/api/endpoints/roadmap";

const ROADMAP_TAG_CLASS: Record<string, string> = {
	Active: "bg-emerald-100 text-emerald-700",
	Completed: "bg-sky-100 text-sky-700",
	Draft: "bg-amber-100 text-amber-700",
};

const EpicOverview = ({ preview }: { preview: RoadmapPreview }) => {
	const MAX_EPICS = 5;

	const allEpics = [...(preview.epics || [])].sort(
		(a, b) => a.position - b.position,
	);

	const displayedEpics = allEpics.slice(0, MAX_EPICS);
	const remainingCount = allEpics.length - MAX_EPICS;

	if (allEpics.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center h-full py-8 px-4">
				<div className="mb-3 rounded-full bg-slate-100 p-3">
					<Inbox className="h-6 w-6 text-slate-500" />
				</div>
				<p className="mb-1 text-sm font-medium text-slate-600">No epics yet</p>
				<p className="text-center text-xs text-slate-500">
					This roadmap is empty
				</p>
			</div>
		);
	}

	return (
		<div className="h-full flex flex-col">
			<div className="flex-1 py-2">
				{displayedEpics.map((epic, index) => {
					const featureCount = epic.features?.length || 0;
					const isLast = index === displayedEpics.length - 1;
					return (
						<div
							key={epic.id}
							className="flex items-start gap-3 px-3 hover:bg-[#f6f7f8] transition-colors"
						>
							<div className="flex flex-col items-center shrink-0 pt-1">
								<div className="h-2 w-2 rounded-full bg-slate-800" />
								{!isLast && <div className="mt-1 h-5 w-0.5 bg-slate-200" />}
							</div>
							<div className="flex items-start justify-between flex-1 min-w-0 pb-1">
								<span className="truncate pt-0.5 text-[13px] font-medium text-slate-900 sm:text-[14px]">
									{epic.title}
								</span>
								<span className="ml-2 whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
									{featureCount} {featureCount === 1 ? "feature" : "features"}
								</span>
							</div>
						</div>
					);
				})}
			</div>
			{remainingCount > 0 && (
				<div className="border-t border-slate-200 px-3 py-2 text-center">
					<span className="text-xs text-slate-500">
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

	useEffect(() => {
		const handleOutsideClick = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			if (target.closest("[data-roadmap-menu]")) return;
			setOpenMenuRoadmapId(null);
		};

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setOpenMenuRoadmapId(null);
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
					<button
						type="button"
						className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-slate-700 hover:text-slate-900"
					>
						View All
						<ArrowRight className="h-3.5 w-3.5" />
					</button>
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
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 items-stretch">
					{templates.map((template) => (
						<div
							key={template.id}
							className="group relative flex h-auto flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-lg sm:h-[420px]"
						>
							<div className="absolute top-3 right-3 z-20" data-roadmap-menu>
								<button
									type="button"
									onClick={() =>
										setOpenMenuRoadmapId((current) =>
											current === template.id ? null : template.id,
										)
									}
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
												onClick={() => setOpenMenuRoadmapId(null)}
											>
												<Briefcase className="h-4 w-4" />
												Project settings
											</Link>
										) : (
											<button
												type="button"
												onClick={() =>
													handleDeleteRoadmap(
														template.id,
														template.title,
														template.preview.project_id,
													)
												}
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

							<Link
								to="/project/$projectId/roadmap/$roadmapId"
								params={{
									projectId: template.preview.project_id || "n",
									roadmapId: template.id,
								}}
								className="flex h-full flex-col"
							>
								<div className="h-[200px] overflow-hidden bg-slate-50 p-4">
									{template.preview.preview_url ? (
										<img
											src={template.preview.preview_url}
											alt={template.title}
											className="w-full h-full object-cover rounded-lg"
										/>
									) : (
										<EpicOverview preview={template.preview} />
									)}
								</div>
								<div className="flex-1 flex flex-col p-5">
									<div className="flex justify-between items-start gap-3 pr-10">
										<h3 className="text-[16px] font-semibold tracking-tight text-slate-900 leading-tight">
											{template.title}
										</h3>
										<span
											className={`shrink-0 px-2 py-0.5 text-xs font-semibold rounded-full ${ROADMAP_TAG_CLASS[template.tag] ?? "bg-slate-100 text-slate-700"}`}
										>
											{template.tag}
										</span>
									</div>
									<p className="mt-2 line-clamp-2 text-[13px] text-slate-600 sm:text-[14px]">
										{template.category}
									</p>
									{template.preview.project_id && (
										<div className="mt-3 mb-2 flex w-fit items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600">
											<Briefcase className="w-3 h-3" />
											<span>Linked to Project</span>
										</div>
									)}
									<div className="mt-auto border-t border-slate-100 pt-4 flex justify-end">
										<span className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-semibold uppercase text-slate-700 transition-colors group-hover:text-slate-900 sm:text-[14px]">
											<CheckCircle2 className="h-3 w-3 shrink-0" />
											TRACK PROGRESS
											<ArrowRight className="h-3.5 w-3.5 shrink-0" />
										</span>
									</div>
								</div>
							</Link>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
