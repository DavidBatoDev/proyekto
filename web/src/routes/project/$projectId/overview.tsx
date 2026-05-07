import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { uploadService } from "@/services/upload.service";
import { useUser } from "@/stores/authStore";
import { supabase } from "@/lib/supabase";
import {
  OverviewLoadingSkeleton,
  OverviewBanner,
  OverviewContent,
  OverviewSidebar,
  type ProjectBriefField,
  toRichHtml,
  deriveTimelineItems,
} from "@/components/project/overview";
import { BringInAConsultantCard } from "@/components/project/BringInAConsultantCard";
import {
  useInvalidateProjectQueries,
  useLinkedRoadmapQuery,
  useProjectBriefQuery,
  useProjectDetailQuery,
  useProjectMembersQuery,
  useRoadmapFullQuery,
} from "@/hooks/useProjectQueries";

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
  const roadmapFullQuery = useRoadmapFullQuery(linkedRoadmapQuery.data?.id ?? "");
  const { invalidateProject, invalidateBrief } = useInvalidateProjectQueries(projectId);

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
    setProjectSummary(result.brief?.project_summary ?? null);
    setCustomFields(result.brief?.custom_fields ?? []);
  }, [briefQuery.data]);

  useEffect(() => {
    if (project) {
      setProjectBannerUrl(project.banner_url ?? null);
    }
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

  const upsertBrief = async (
    patch: { project_summary?: string | null; custom_fields?: ProjectBriefField[] },
  ) => {
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
      if (typeof row?.project_summary === "string" || row?.project_summary === null) {
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
      <div className="px-5 py-6 md:px-8 md:py-8">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-7">
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

            <div className="app-surface-card app-slide-up p-5 md:p-7">
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
