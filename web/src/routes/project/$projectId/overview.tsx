import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { uploadService } from "@/services/upload.service";
import { useUser } from "@/stores/authStore";
import { supabase } from "@/lib/supabase";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { projectService } from "@/services/project.service";
import { PROJECT_STATUS_CONFIG } from "@/components/home/ProjectsGrid";
import { ProjectStatusBadge } from "@/components/common/SemanticBadge";
import {
	OverviewLoadingSkeleton,
	OverviewBanner,
	OverviewContent,
	OverviewSidebar,
	type ProjectBriefField,
	toRichHtml,
	deriveTimelineItems,
} from "@/components/project/overview";
import {
	areProjectBriefFieldsEqual,
	getOverviewBriefState,
} from "@/components/project/overview/stateSync";
import { BringInAConsultantCard } from "@/components/project/BringInAConsultantCard";
import {
	useInvalidateProjectQueries,
	useLinkedRoadmapQuery,
	useProjectBriefQuery,
	useProjectDetailQuery,
	useProjectMembersQuery,
	useRoadmapFullQuery,
} from "@/hooks/useProjectQueries";

function StatusBadgeSelector({
	projectId,
	currentStatus,
	canEdit,
}: {
	projectId: string;
	currentStatus: string | null;
	canEdit: boolean;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node))
				setOpen(false);
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);

	const mutation = useMutation({
		mutationFn: (status: string) =>
			projectService.update(projectId, {
				status: status as
					| "draft"
					| "active"
					| "bidding"
					| "paused"
					| "completed"
					| "archived",
			}),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ["project", "detail", projectId],
			});
			setOpen(false);
		},
	});

	const statusKey = (currentStatus ?? "draft").toLowerCase();
	const cfg = PROJECT_STATUS_CONFIG[statusKey] ?? PROJECT_STATUS_CONFIG.draft;

	return (
		<div ref={ref} className="relative inline-flex">
			<button
				type="button"
				disabled={!canEdit || mutation.isPending}
				onClick={() => canEdit && setOpen((v) => !v)}
				className={`inline-flex items-center gap-1 rounded-full transition-colors ${canEdit ? "cursor-pointer hover:bg-accent" : "cursor-default"}`}
			>
				{mutation.isPending ? (
					<span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground">
						<Loader2 className="h-3 w-3 animate-spin" />
						{cfg.label}
					</span>
				) : (
					<ProjectStatusBadge status={statusKey} label={cfg.label} />
				)}
				{canEdit && <ChevronDown className="h-3 w-3 opacity-60" />}
			</button>

			{open && (
				<div className="absolute left-0 top-full z-50 mt-1.5 w-48 rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-xl">
					{Object.entries(PROJECT_STATUS_CONFIG).map(([key, c]) => (
						<button
							key={key}
							type="button"
							disabled={mutation.isPending}
							onClick={() => mutation.mutate(key)}
							className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
						>
							<ProjectStatusBadge status={key} label={c.label} className="border-0 bg-transparent px-0" />
							<span className="flex-1" />
							{statusKey === key && (
								<Check className="h-3.5 w-3.5 text-slate-500" />
							)}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

export const Route = createFileRoute("/project/$projectId/overview")({
	component: OverviewPage,
});

function OverviewPage() {
	const { projectId } = Route.useParams();
	const user = useUser();
	const projectQuery = useProjectDetailQuery(projectId);
	const membersQuery = useProjectMembersQuery(projectId);
	const briefQuery = useProjectBriefQuery(projectId);
	const linkedRoadmapQuery = useLinkedRoadmapQuery(projectId);
	const roadmapFullQuery = useRoadmapFullQuery(
		linkedRoadmapQuery.data?.id ?? "",
	);
	const { invalidateProject, invalidateBrief } =
		useInvalidateProjectQueries(projectId);

	const project = projectQuery.data ?? null;
	const members = membersQuery.data ?? [];

	const [projectSummary, setProjectSummary] = useState<string | null>(null);
	const [customFields, setCustomFields] = useState<ProjectBriefField[]>([]);
	const [isSavingSummary, setIsSavingSummary] = useState(false);
	const [isSavingFields, setIsSavingFields] = useState(false);

	const [editingSummary, setEditingSummary] = useState(false);

	const [bannerModalOpen, setBannerModalOpen] = useState(false);
	const [isUploadingBanner, setIsUploadingBanner] = useState(false);
	const [projectBannerUrl, setProjectBannerUrl] = useState<string | null>(null);

	useEffect(() => {
		const result = briefQuery.data;
		if (!result) return;
		const { projectSummary: nextSummary, customFields: nextCustomFields } =
			getOverviewBriefState(result.brief);

		setProjectSummary((current) =>
			current === nextSummary ? current : nextSummary,
		);
		setCustomFields((current) =>
			areProjectBriefFieldsEqual(current, nextCustomFields)
				? current
				: nextCustomFields,
		);
	}, [briefQuery.data]);

	useEffect(() => {
		if (!project) return;
		const nextBannerUrl = project.banner_url ?? null;
		setProjectBannerUrl((current) =>
			current === nextBannerUrl ? current : nextBannerUrl,
		);
	}, [project]);

	const handleProjectBannerUpload = async (files: File[]) => {
		if (!files[0]) return;
		setIsUploadingBanner(true);
		try {
			const url = await uploadService.uploadProjectBanner(projectId, files[0]);
			setProjectBannerUrl(url);
			setBannerModalOpen(false);
			await invalidateProject();
		} catch (e) {
			console.error("Project banner upload failed", e);
			alert("Failed to upload banner. Please try again.");
		} finally {
			setIsUploadingBanner(false);
		}
	};

	const timelineItems = useMemo(
		() =>
			roadmapFullQuery.data ? deriveTimelineItems(roadmapFullQuery.data) : [],
		[roadmapFullQuery.data],
	);

	// Edit gate: anyone who is the project's client/consultant of record, or
	// who holds an editor-or-higher role on project_shares, may edit the
	// brief sections. Earlier this only matched literal "client"/"consultant"
	// role strings, which excluded owners/admins/editors with full
	// permissions.
	const currentMember = members.find((member) => member.user_id === user?.id);
	const memberRole = (currentMember?.role ?? "").toLowerCase();
	const isOwnerOnProject =
		user?.id !== undefined &&
		(project?.client_id === user.id || project?.consultant_id === user.id);
	const canEditOverview =
		isOwnerOnProject ||
		["owner", "admin", "editor", "client", "consultant"].includes(memberRole);

	const summaryHtml = toRichHtml(projectSummary ?? project?.description ?? "");

	const upsertBrief = async (patch: {
		project_summary?: string | null;
		custom_fields?: ProjectBriefField[];
	}) => {
		return supabase
			.from("project_briefs")
			.upsert(
				{
					project_id: projectId,
					version: 1,
					updated_by: user?.id ?? null,
					...patch,
				},
				{ onConflict: "project_id,version" },
			)
			.select("project_summary, custom_fields")
			.single();
	};

	const handleSaveSummary = async (value: string) => {
		if (!canEditOverview) return;
		setIsSavingSummary(true);
		try {
			const { data, error } = await upsertBrief({ project_summary: value });
			if (error) throw error;
			const row = data as {
				project_summary?: string | null;
				custom_fields?: ProjectBriefField[];
			} | null;
			setProjectSummary(row?.project_summary ?? value);
			if (Array.isArray(row?.custom_fields)) {
				setCustomFields(row.custom_fields);
			}
			await invalidateBrief();
		} catch (err) {
			console.error("Failed to save summary", err);
			alert("Failed to save changes. Please try again.");
		} finally {
			setIsSavingSummary(false);
		}
	};

	const handleSaveCustomFields = async (next: ProjectBriefField[]) => {
		if (!canEditOverview) return;
		setIsSavingFields(true);
		try {
			const { data, error } = await upsertBrief({ custom_fields: next });
			if (error) throw error;
			const row = data as {
				project_summary?: string | null;
				custom_fields?: ProjectBriefField[];
			} | null;
			setCustomFields(
				Array.isArray(row?.custom_fields) ? row.custom_fields : next,
			);
			if (
				typeof row?.project_summary === "string" ||
				row?.project_summary === null
			) {
				setProjectSummary(row.project_summary);
			}
			await invalidateBrief();
		} catch (err) {
			console.error("Failed to save custom fields", err);
			alert("Failed to save changes. Please try again.");
		} finally {
			setIsSavingFields(false);
		}
	};

	const isLoading = projectQuery.isPending || membersQuery.isPending;
	const error =
		projectQuery.error instanceof Error
			? projectQuery.error.message
			: membersQuery.error instanceof Error
				? membersQuery.error.message
				: null;

	if (isLoading) {
		return <OverviewLoadingSkeleton />;
	}

	if (error || !project) {
		return (
			<div className="p-6 md:p-8">
				<div className="rounded-xl border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-700">
					{error ?? "Project not found."}
				</div>
			</div>
		);
	}

	return (
		<div className="h-full w-full overflow-y-auto app-shell-bg">
			<div className="px-3 py-4 sm:px-5 sm:py-6 md:px-8 md:py-8">
				<div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-7">
					<div className="flex flex-col">
						<BringInAConsultantCard
							isPersonalWorkspace={Boolean(
								(project as unknown as { is_personal_workspace?: boolean })
									.is_personal_workspace,
							)}
							hasConsultant={Boolean(project.consultant_id)}
						/>
						<div className="app-slide-up">
							<OverviewBanner
								bannerUrl={projectBannerUrl}
								canEdit={canEditOverview}
								isUploading={isUploadingBanner}
								isOpen={bannerModalOpen}
								onOpenModal={() => setBannerModalOpen(true)}
								onCloseModal={() => setBannerModalOpen(false)}
								onUpload={(files) => void handleProjectBannerUpload(files)}
							/>
						</div>

						<div className="app-surface-card app-slide-up p-4 md:p-7">
							<div className="mb-3 flex items-center gap-2 md:mb-4">
								<span className="text-xs font-medium text-slate-500">
									Status
								</span>
								<StatusBadgeSelector
									projectId={projectId}
									currentStatus={project.status}
									canEdit={isOwnerOnProject}
								/>
							</div>
							<OverviewContent
								projectTitle={project.title}
								clientName={project.client?.display_name}
								consultantName={project.consultant?.display_name}
								summaryHtml={summaryHtml}
								customFields={customFields}
								canEdit={canEditOverview}
								isSavingSummary={isSavingSummary}
								isSavingFields={isSavingFields}
								editingSummary={editingSummary}
								setEditingSummary={setEditingSummary}
								onSaveSummary={handleSaveSummary}
								onSaveCustomFields={handleSaveCustomFields}
							/>
						</div>
					</div>

					<div className="app-slide-up">
						<OverviewSidebar timelineItems={timelineItems} members={members} />
					</div>
				</div>
			</div>
		</div>
	);
}
