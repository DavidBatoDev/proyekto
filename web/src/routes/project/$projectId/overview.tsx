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
  type ProjectBrief,
  type BriefStorageMode,
  toRichHtml,
  toItems,
  deriveTimelineItems,
} from "@/components/project/overview";
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

  const [projectBrief, setProjectBrief] = useState<ProjectBrief | null>(null);
  const [savingSection, setSavingSection] = useState<
    "summary" | "scope" | "constraints" | "requirements" | "notes" | null
  >(null);
  const [briefStorageMode, setBriefStorageMode] =
    useState<BriefStorageMode>("visibility_mask");

  const [editingSummary, setEditingSummary] = useState(false);
  const [editingScope, setEditingScope] = useState(false);
  const [editingConstraints, setEditingConstraints] = useState(false);
  const [editingRequirements, setEditingRequirements] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);

  const [bannerModalOpen, setBannerModalOpen] = useState(false);
  const [isUploadingBanner, setIsUploadingBanner] = useState(false);
  const [projectBannerUrl, setProjectBannerUrl] = useState<string | null>(null);

  const briefSelectBase =
    "mission_vision, scope_statement, requirements, constraints, risk_register";

  const isMissingColumnError = (error: unknown, column: string) => {
    if (!error || typeof error !== "object") return false;
    const err = error as { message?: string; details?: string; hint?: string };
    const text =
      `${err.message ?? ""} ${err.details ?? ""} ${err.hint ?? ""}`.toLowerCase();
    return text.includes(column.toLowerCase());
  };

  useEffect(() => {
    const data = briefQuery.data;
    if (!data) return;
    setProjectBrief(data.brief);
    setBriefStorageMode(data.mode);
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

  const risks = useMemo(
    () => toItems(projectBrief?.risk_register),
    [projectBrief?.risk_register],
  );

  const timelineItems = useMemo(
    () =>
      roadmapFullQuery.data ? deriveTimelineItems(roadmapFullQuery.data) : [],
    [roadmapFullQuery.data],
  );

  const memberRole =
    members.find((member) => member.user_id === user?.id)?.role?.toLowerCase() ?? "";
  const canEditOverview =
    memberRole.includes("client") || memberRole.includes("consultant");

  const summaryHtml = toRichHtml(
    projectBrief?.mission_vision ?? project?.description ?? "",
  );
  const scopeHtml = toRichHtml(projectBrief?.scope_statement ?? "");
  const constraintsHtml = toRichHtml(projectBrief?.constraints ?? "");
  const requirementsHtml = toRichHtml(projectBrief?.requirements);
  const notesHtml = toRichHtml(
    projectBrief?.visibility_mask?.project_notes ?? projectBrief?.notes ?? "",
  );

  const saveBriefPatch = async (
    section: "summary" | "scope" | "constraints" | "requirements" | "notes",
    patch: Partial<ProjectBrief>,
  ) => {
    if (!canEditOverview) return;

    try {
      setSavingSection(section);

      const nextVisibilityMask = {
        ...(projectBrief?.visibility_mask ?? {}),
        ...(patch.visibility_mask ?? {}),
      };

      const payloadBase = {
        project_id: projectId,
        version: 1,
        updated_by: user?.id ?? null,
        ...patch,
      };

      const runUpsert = async (mode: BriefStorageMode) => {
        if (mode === "visibility_mask") {
          return supabase
            .from("project_briefs")
            .upsert(
              {
                ...payloadBase,
                visibility_mask: nextVisibilityMask,
              },
              { onConflict: "project_id,version" },
            )
            .select(`${briefSelectBase}, visibility_mask`)
            .single();
        }

        if (mode === "notes") {
          return supabase
            .from("project_briefs")
            .upsert(payloadBase, { onConflict: "project_id,version" })
            .select(`${briefSelectBase}, notes`)
            .single();
        }

        return supabase
          .from("project_briefs")
          .upsert(payloadBase, { onConflict: "project_id,version" })
          .select(briefSelectBase)
          .single();
      };

      let result = await runUpsert(briefStorageMode);

      if (result.error && briefStorageMode === "visibility_mask") {
        if (isMissingColumnError(result.error, "visibility_mask")) {
          if (patch.visibility_mask?.project_notes !== undefined) {
            patch.notes = String(patch.visibility_mask.project_notes ?? "");
            delete patch.visibility_mask;
          }
          result = await runUpsert("notes");
          if (result.error && isMissingColumnError(result.error, "notes")) {
            result = await runUpsert("none");
            if (!result.error) setBriefStorageMode("none");
          } else if (!result.error) {
            setBriefStorageMode("notes");
          }
        }
      }

      if (result.error && briefStorageMode === "notes") {
        if (isMissingColumnError(result.error, "notes")) {
          result = await runUpsert("none");
          if (!result.error) setBriefStorageMode("none");
        }
      }

      const { data, error: updateError } = result;

      if (updateError) {
        throw updateError;
      }

      setProjectBrief((data as ProjectBrief | null) ?? null);
      await invalidateBrief();
    } catch {
      alert("Failed to save changes. Please try again.");
    } finally {
      setSavingSection(null);
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
                scopeHtml={scopeHtml}
                constraintsHtml={constraintsHtml}
                requirementsHtml={requirementsHtml}
                notesHtml={notesHtml}
                risks={risks}
                canEdit={canEditOverview}
                savingSection={savingSection}
                editingSummary={editingSummary}
                editingScope={editingScope}
                editingConstraints={editingConstraints}
                editingRequirements={editingRequirements}
                editingNotes={editingNotes}
                setEditingSummary={setEditingSummary}
                setEditingScope={setEditingScope}
                setEditingConstraints={setEditingConstraints}
                setEditingRequirements={setEditingRequirements}
                setEditingNotes={setEditingNotes}
                onSaveSummary={(value) =>
                  saveBriefPatch("summary", { mission_vision: value })
                }
                onSaveScope={(value) =>
                  saveBriefPatch("scope", { scope_statement: value })
                }
                onSaveConstraints={(value) =>
                  saveBriefPatch("constraints", { constraints: value })
                }
                onSaveRequirements={(value) =>
                  saveBriefPatch("requirements", { requirements: { html: value } })
                }
                onSaveNotes={(value) =>
                  saveBriefPatch(
                    "notes",
                    briefStorageMode === "visibility_mask"
                      ? {
                          visibility_mask: {
                            ...(projectBrief?.visibility_mask ?? {}),
                            project_notes: value,
                          },
                        }
                      : { notes: value },
                  )
                }
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

