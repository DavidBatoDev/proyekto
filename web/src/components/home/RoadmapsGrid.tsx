import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	Briefcase,
	CheckCircle2,
	Ellipsis,
	Inbox,
	Loader,
	Trash2,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { deleteRoadmap, getRoadmapsPreview } from "@/api";
import type { RoadmapPreview } from "@/api/endpoints/roadmap";
import { useAuthStore } from "@/stores/authStore";

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
				<div className="bg-[#f6f7f8] rounded-full p-3 mb-3">
					<Inbox className="w-6 h-6 text-[#92969f]" />
				</div>
				<p className="text-sm font-medium text-[#61636c] mb-1">No epics yet</p>
				<p className="text-xs text-[#92969f] text-center">
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
								<div
									className="w-2 h-2 rounded-full"
									style={{ backgroundColor: "var(--secondary)" }}
								/>
								{!isLast && <div className="w-0.5 h-5 bg-[#e3e5e8] mt-1" />}
							</div>
							<div className="flex items-start justify-between flex-1 min-w-0 pb-1">
								<span className="text-[14px] font-medium text-[#333438] truncate pt-0.5">
									{epic.title}
								</span>
								<span className="text-xs text-[#61636c] bg-[#f6f7f8] px-2 py-0.5 rounded-full whitespace-nowrap ml-2">
									{featureCount} {featureCount === 1 ? "feature" : "features"}
								</span>
							</div>
						</div>
					);
				})}
			</div>
			{remainingCount > 0 && (
				<div className="py-2 px-3 text-center border-t border-[#e3e5e8]">
					<span className="text-xs text-[#92969f]">
						+{remainingCount} more {remainingCount === 1 ? "epic" : "epics"}
					</span>
				</div>
			)}
		</div>
	);
};

export function RoadmapsGrid() {
	const { profile } = useAuthStore();
	const queryClient = useQueryClient();
	const roadmapsSectionId = useId();
	const persona = profile?.active_persona || "client";
	const freelancerRoleLabel =
		profile?.headline?.trim() || "Freelancer Contributor";
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
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: ["dashboard", "roadmaps-preview"],
				}),
				queryClient.invalidateQueries({
					queryKey: ["dashboard", "timeline-roadmaps"],
				}),
			]);
		},
	});

	const handleDeleteRoadmap = async (
		roadmapId: string,
		roadmapName: string,
	) => {
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
		staleTime: 0,
		refetchOnMount: true,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
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
		<div id={roadmapsSectionId} data-roadmaps-section="my-roadmaps-section">
			<div className="mb-6">
				<div className="flex items-center justify-between mb-1">
					<div className="flex items-center gap-2">
						<div
							className="w-[18px] h-[18px] rounded-full"
							style={{ backgroundColor: "var(--secondary)" }}
						/>
						<h2 className="text-[20px] font-semibold text-[#333438]">
							{persona === "freelancer" ? "ACTIVE WORKSPACES" : "MY ROADMAPS"}
						</h2>
					</div>
					{persona !== "freelancer" ? (
						<button
							type="button"
							className="text-[20px] font-semibold text-[#333438] hover:text-[var(--secondary)]"
						>
							{"View All \u2192"}
						</button>
					) : null}
				</div>
				<p className="text-xs text-[#61636c] mt-1">
					{persona === "freelancer"
						? "Workspaces assigned to you for active delivery and milestone execution."
						: "Each matched project unlocks a consultant-led roadmap for structured execution"}
				</p>
			</div>

			{loading ? (
				<div className="flex justify-center items-center py-20">
					<Loader className="w-8 h-8 animate-spin text-primary" />
				</div>
			) : isUnavailable ? (
				<div className="text-center py-12">
					<p className="text-[#333438] font-semibold mb-2">
						Your roadmap workspace is preparing
					</p>
					<p className="text-[#61636c] text-sm">
						{persona === "freelancer"
							? "This is where your milestone roadmap will appear once you're matched."
							: "After consultant matching starts, your roadmap appears here with milestones and execution phases."}
					</p>
					{persona === "freelancer" ? (
						<p className="text-xs text-[#92969f] mt-2">
							Your roadmap is being prepared based on your project assignment.
						</p>
					) : null}
				</div>
			) : templates.length === 0 ? (
				<div className="text-center py-12">
					<p className="text-[#333438] font-semibold mb-2">
						Your first roadmap is taking shape
					</p>
					<p className="text-[#61636c] text-sm">
						{persona === "freelancer"
							? "This is where your milestone roadmap will appear once you're matched."
							: "Post your project vision to trigger consultant matching and automatically generate your roadmap."}
					</p>
					{persona === "freelancer" ? (
						<p className="text-xs text-[#92969f] mt-2">
							Your roadmap is being prepared based on your project assignment.
						</p>
					) : null}
				</div>
			) : (
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
					{templates.map((template) => (
						<div
							key={template.id}
							className="group relative flex h-[420px] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-all hover:border-[var(--secondary)] hover:shadow-xl"
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
										<button
											type="button"
											onClick={() =>
												handleDeleteRoadmap(template.id, template.title)
											}
											disabled={deletingRoadmapId === template.id}
											className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
										>
											<Trash2 className="h-4 w-4" />
											{deletingRoadmapId === template.id
												? "Deleting..."
												: "Delete roadmap"}
										</button>
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
										<h3 className="text-[16px] font-bold text-[#333438] leading-tight">
											{template.title}
										</h3>
										<span
											className={`shrink-0 px-2 py-0.5 text-xs font-semibold rounded-full ${ROADMAP_TAG_CLASS[template.tag] ?? "bg-slate-100 text-slate-700"}`}
										>
											{template.tag}
										</span>
									</div>
									<p className="mt-2 text-[14px] text-[#61636c] line-clamp-2">
										{template.category}
									</p>
									{persona === "freelancer" ? (
										<p className="mt-2 text-sm text-[#61636c]">
											Role: {freelancerRoleLabel}
										</p>
									) : null}
									{template.preview.project_id && (
										<div className="mt-3 mb-2 flex items-center gap-1.5 text-xs text-[#61636c] bg-[#f6f7f8] px-2 py-1 rounded-md w-fit">
											<Briefcase className="w-3 h-3" />
											<span>Linked to Project</span>
										</div>
									)}
									<div className="mt-auto border-t border-slate-100 pt-4 mt-4 flex justify-end">
										<span className="inline-flex items-center gap-1 text-[14px] font-semibold text-[#333438] uppercase transition-colors group-hover:text-[var(--secondary)] whitespace-nowrap">
											<CheckCircle2 className="w-3 h-3" />
											{persona === "client"
												? "TRACK PROGRESS \u2192"
												: persona === "freelancer"
													? "ENTER WORKSPACE \u2192"
													: "VIEW PLAN \u2192"}
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
