import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Edit2,
  Loader2,
  LogOut,
  RefreshCcw,
  Save,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { ProjectSettingsLayout } from "@/components/project/ProjectSettingsLayout";
import { RichTextEditor } from "@/components/common/RichTextEditor";
import { cleanHTML } from "@/components/common/RichTextEditor/utils/formatting";
import { useToast } from "@/hooks/useToast";
import { supabase } from "@/lib/supabase";
import {
  projectService,
  type Project,
  type ProjectMember,
} from "@/services/project.service";
import { useUser } from "@/stores/authStore";

export const Route = createFileRoute("/project/$projectId/settings/general")({
  component: SettingsGeneralPage,
});

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");

const toRichHtml = (raw: string | null | undefined): string => {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";

  if (/<[a-z][\s\S]*>/i.test(trimmed)) {
    return cleanHTML(trimmed);
  }

  return `<p>${escapeHtml(trimmed).replace(/\n/g, "<br>")}</p>`;
};

const MODAL_ANIMATION_MS = 220;

const getMemberDisplayName = (member: ProjectMember): string =>
  member.user?.display_name ||
  [member.user?.first_name, member.user?.last_name].filter(Boolean).join(" ") ||
  member.user?.email ||
  "Unknown";

const getInitials = (name: string): string =>
  name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

function SettingsPageSkeleton({ projectId }: { projectId: string }) {
  return (
    <ProjectSettingsLayout projectId={projectId}>
      <div className="animate-pulse space-y-8">
        <section className="space-y-3">
          <div className="h-10 w-72 rounded-md bg-gray-200" />
          <div className="app-surface-card-strong overflow-hidden rounded-2xl">
            <div className="flex items-center justify-end border-b border-slate-200 bg-slate-50/80 px-5 py-4">
              <div className="h-10 w-32 rounded-md bg-gray-200" />
            </div>
            <div className="space-y-5 px-5 py-5">
              <div className="space-y-2">
                <div className="h-3 w-28 rounded bg-gray-200" />
                <div className="h-11 w-full rounded-lg bg-slate-100" />
              </div>
              <div className="space-y-2">
                <div className="h-3 w-36 rounded bg-gray-200" />
                <div className="h-32 w-full rounded-lg bg-slate-100" />
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="h-10 w-64 rounded-md bg-gray-200" />
          <div className="app-surface-card-strong overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-5 py-4">
              <div className="h-4 w-64 rounded bg-gray-200" />
              <div className="h-9 w-32 rounded-md bg-gray-200" />
            </div>
            <div className="divide-y divide-gray-100">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={`member-skeleton-${index}`}
                  className="flex items-center justify-between gap-3 px-5 py-4"
                >
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-4 w-48 rounded bg-gray-200" />
                    <div className="h-3 w-64 rounded bg-slate-100" />
                  </div>
                  <div className="h-7 w-24 rounded-full bg-slate-100" />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="h-10 w-64 rounded-md bg-gray-200" />
          <div className="app-surface-card-strong overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-5 py-4">
              <div className="h-4 w-64 rounded bg-gray-200" />
              <div className="h-9 w-36 rounded-md bg-gray-200" />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="h-10 w-60 rounded-md bg-gray-200" />
          <div className="rounded-xl border border-red-100 bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-red-100 bg-red-50 px-5 py-4">
              <div className="h-4 w-72 rounded bg-red-100" />
              <div className="h-9 w-32 rounded-md bg-red-100" />
            </div>
            <div className="px-5 py-4">
              <div className="h-4 w-64 rounded bg-red-50" />
            </div>
          </div>
        </section>
      </div>
    </ProjectSettingsLayout>
  );
}

function SettingsGeneralPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const user = useUser();

  const [project, setProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [titleDraft, setTitleDraft] = useState("");
  const [summaryValue, setSummaryValue] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [isSavingSummary, setIsSavingSummary] = useState(false);
  const [isTransferSelectOpen, setIsTransferSelectOpen] = useState(false);
  const [isTransferConfirmOpen, setIsTransferConfirmOpen] = useState(false);
  const [selectedOwnerId, setSelectedOwnerId] = useState("");
  const [isTransferSaving, setIsTransferSaving] = useState(false);
  const [isConsultantSelectOpen, setIsConsultantSelectOpen] = useState(false);
  const [isConsultantConfirmOpen, setIsConsultantConfirmOpen] = useState(false);
  const [selectedConsultantId, setSelectedConsultantId] = useState("");
  const [isConsultantTransferSaving, setIsConsultantTransferSaving] =
    useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [isDeleteSaving, setIsDeleteSaving] = useState(false);
  const [isLeaveOpen, setIsLeaveOpen] = useState(false);
  const [isLeaveSaving, setIsLeaveSaving] = useState(false);
  const [showTransferSelectModal, setShowTransferSelectModal] = useState(false);
  const [showConsultantSelectModal, setShowConsultantSelectModal] =
    useState(false);
  const [transferSelectEntered, setTransferSelectEntered] = useState(false);
  const [consultantSelectEntered, setConsultantSelectEntered] = useState(false);

  const isOwner = Boolean(user?.id && project?.client_id === user.id);
  const isConsultant = Boolean(user?.id && project?.consultant_id === user.id);
  const canReassignConsultant = isOwner || isConsultant;
  const currentMember = useMemo(
    () => members.find((member) => member.user_id === user?.id) ?? null,
    [members, user?.id],
  );
  const canLeaveProject = Boolean(
    user?.id &&
      project?.id &&
      currentMember &&
      currentMember.role === "member" &&
      !isOwner &&
      !isConsultant,
  );

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [projectData, memberData, briefResult] = await Promise.all([
        projectService.get(projectId),
        projectService.getMembers(projectId),
        supabase
          .from("project_briefs")
          .select("mission_vision")
          .eq("project_id", projectId)
          .maybeSingle(),
      ]);

      const summaryHtml = toRichHtml(briefResult.data?.mission_vision ?? "");

      setProject(projectData);
      setMembers(memberData);
      setTitleDraft(projectData.title || "");
      setSummaryValue(summaryHtml);
      setSummaryDraft(summaryHtml);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load settings.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [projectId]);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    if (isTransferSelectOpen) {
      setShowTransferSelectModal(true);
      const rafId = requestAnimationFrame(() => setTransferSelectEntered(true));
      return () => cancelAnimationFrame(rafId);
    }

    setTransferSelectEntered(false);
    timeoutId = setTimeout(
      () => setShowTransferSelectModal(false),
      MODAL_ANIMATION_MS,
    );

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isTransferSelectOpen]);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    if (isConsultantSelectOpen) {
      setShowConsultantSelectModal(true);
      const rafId = requestAnimationFrame(() =>
        setConsultantSelectEntered(true),
      );
      return () => cancelAnimationFrame(rafId);
    }

    setConsultantSelectEntered(false);
    timeoutId = setTimeout(
      () => setShowConsultantSelectModal(false),
      MODAL_ANIMATION_MS,
    );

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isConsultantSelectOpen]);

  const transferrableMembers = useMemo(
    () =>
      members.filter(
        (member) =>
          Boolean(member.user_id) && member.user_id !== project?.client_id,
      ),
    [members, project?.client_id],
  );

  const reassignableConsultantMembers = useMemo(
    () =>
      members.filter(
        (member) =>
          Boolean(member.user_id) &&
          member.user_id !== project?.consultant_id &&
          member.user?.is_consultant_verified === true,
      ),
    [members, project?.consultant_id],
  );

  const selectedOwnerMember = useMemo(
    () => transferrableMembers.find((member) => member.user_id === selectedOwnerId),
    [transferrableMembers, selectedOwnerId],
  );

  const selectedConsultantMember = useMemo(
    () =>
      reassignableConsultantMembers.find(
        (member) => member.user_id === selectedConsultantId,
      ),
    [reassignableConsultantMembers, selectedConsultantId],
  );

  const saveTitle = async () => {
    if (!project) return;
    const normalizedTitle = titleDraft.trim();
    if (!normalizedTitle) {
      toast.error("Project title cannot be empty.");
      return;
    }

    setIsSavingTitle(true);
    try {
      const updated = await projectService.update(project.id, {
        title: normalizedTitle,
      });
      setProject(updated);
      setTitleDraft(updated.title || "");
      setIsEditingTitle(false);
      toast.success("Project title updated.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save project title.",
      );
    } finally {
      setIsSavingTitle(false);
    }
  };

  const saveSummary = async () => {
    if (!project) return;
    setIsSavingSummary(true);
    try {
      const cleaned = cleanHTML(summaryDraft);

      const { error } = await supabase.from("project_briefs").upsert(
        {
          project_id: project.id,
          mission_vision: cleaned,
          updated_by: user?.id ?? null,
          version: 1,
        },
        { onConflict: "project_id,version" },
      );

      if (error) {
        throw error;
      }

      const nextSummary = toRichHtml(cleaned);
      setSummaryValue(nextSummary);
      setSummaryDraft(nextSummary);
      setIsEditingSummary(false);
      toast.success("Project summary updated.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save project summary.",
      );
    } finally {
      setIsSavingSummary(false);
    }
  };

  const submitTransfer = async () => {
    if (!project || !selectedOwnerId) return;
    setIsTransferSaving(true);
    try {
      const updated = await projectService.transferOwner(
        project.id,
        selectedOwnerId,
      );
      setProject(updated);
      setSelectedOwnerId("");
      setIsTransferConfirmOpen(false);
      setIsTransferSelectOpen(false);
      toast.success("Project ownership transferred.");
      await loadData();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to transfer project.",
      );
    } finally {
      setIsTransferSaving(false);
    }
  };

  const submitConsultantReassign = async () => {
    if (!project || !selectedConsultantId) return;
    setIsConsultantTransferSaving(true);
    try {
      const updated = await projectService.reassignConsultant(
        project.id,
        selectedConsultantId,
      );
      setProject(updated);
      setSelectedConsultantId("");
      setIsConsultantConfirmOpen(false);
      setIsConsultantSelectOpen(false);
      toast.success("Project consultant reassigned.");
      await loadData();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to reassign consultant.",
      );
    } finally {
      setIsConsultantTransferSaving(false);
    }
  };

  const submitDelete = async () => {
    if (!project) return;
    setIsDeleteSaving(true);
    try {
      await projectService.deleteProject(project.id);
      toast.success("Project deleted.");
      navigate({ to: "/dashboard" });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete project.",
      );
    } finally {
      setIsDeleteSaving(false);
    }
  };

  const submitLeaveProject = async () => {
    if (!project || !canLeaveProject) return;
    setIsLeaveSaving(true);
    try {
      const result = await projectService.leaveProject(project.id);
      const unassignedCount =
        typeof result === "object" &&
        result !== null &&
        "unassigned_task_count" in result
          ? Number(result.unassigned_task_count ?? 0)
          : 0;

      toast.success(
        unassignedCount > 0
          ? `You left the project. ${unassignedCount} assigned task${unassignedCount === 1 ? "" : "s"} were unassigned.`
          : "You left the project.",
      );
      navigate({ to: "/dashboard" });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to leave project.",
      );
    } finally {
      setIsLeaveSaving(false);
      setIsLeaveOpen(false);
    }
  };

  const deleteConfirmMatches = deleteText.trim() === (project?.title || "");

  if (isLoading && !project) {
    return <SettingsPageSkeleton projectId={projectId} />;
  }

  return (
    <ProjectSettingsLayout projectId={projectId}>
      <div className="space-y-10">
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-slate-700" />
            <h2 className="text-[30px] leading-none font-semibold text-slate-900">
              General settings
            </h2>
          </div>

          <div className="app-surface-card-strong overflow-hidden rounded-2xl">
            <div className="px-5 py-5 space-y-7">
              <section className="pb-6 border-b border-slate-200">
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <h3 className="text-[18px] font-semibold text-slate-900">
                    Project Title
                  </h3>
                  {!isEditingTitle && (
                    <button
                      type="button"
                      onClick={() => setIsEditingTitle(true)}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900"
                    >
                      <Edit2 className="w-4 h-4" />
                      Edit
                    </button>
                  )}
                </div>

                {isEditingTitle ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      placeholder="Write the project title..."
                      disabled={isSavingTitle}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:border-slate-500 focus:ring-slate-400/30"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void saveTitle()}
                        disabled={isSavingTitle}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white app-cta rounded-md disabled:opacity-50"
                      >
                        {isSavingTitle ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4" />
                        )}
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTitleDraft(project?.title || "");
                          setIsEditingTitle(false);
                        }}
                        disabled={isSavingTitle}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 disabled:opacity-50"
                      >
                        <X className="w-4 h-4" />
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-[14px] text-slate-700 leading-6">
                    {(project?.title || "").trim() || "No title added yet."}
                  </p>
                )}
              </section>

              <section>
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <h3 className="text-[18px] font-semibold text-slate-900">
                    Project Summary
                  </h3>
                  {!isEditingSummary && (
                    <button
                      type="button"
                      onClick={() => setIsEditingSummary(true)}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900"
                    >
                      <Edit2 className="w-4 h-4" />
                      Edit
                    </button>
                  )}
                </div>

                {isEditingSummary ? (
                  <div className="space-y-3">
                    <RichTextEditor
                      value={summaryDraft}
                      onChange={setSummaryDraft}
                      placeholder="Write the project summary..."
                      minHeight="120px"
                      maxHeight="320px"
                      tools={[
                        "textFormat",
                        "bold",
                        "italic",
                        "more",
                        "separator",
                        "bulletList",
                        "numberedList",
                        "separator",
                        "link",
                      ]}
                      disabled={isSavingSummary}
                      autoFocus
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void saveSummary()}
                        disabled={isSavingSummary}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white app-cta rounded-md disabled:opacity-50"
                      >
                        {isSavingSummary ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4" />
                        )}
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSummaryDraft(summaryValue);
                          setIsEditingSummary(false);
                        }}
                        disabled={isSavingSummary}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 disabled:opacity-50"
                      >
                        <X className="w-4 h-4" />
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="text-[13px] text-slate-600 leading-6 max-w-none wrap-break-word [&_p]:my-0 [&_p+_p]:mt-3 [&_a]:text-blue-600 [&_a]:underline [&_strong]:font-semibold [&_b]:font-semibold [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:text-base [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1"
                    dangerouslySetInnerHTML={{
                      __html:
                        summaryValue ||
                        "<p class='text-slate-500'>No summary added yet.</p>",
                    }}
                  />
                )}
              </section>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-[30px] leading-none font-semibold text-slate-900">
            Project access
          </h2>
          <div className="app-surface-card-strong overflow-hidden rounded-2xl">
            <header className="px-5 py-4 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
              <p className="text-sm text-slate-600">
                Team members with access to this project.
              </p>
              <Link
                to="/project/$projectId/settings/permissions"
                params={{ projectId }}
                className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-md hover:bg-slate-100"
              >
                Manage members
              </Link>
            </header>

            <div className="divide-y divide-gray-100">
              {isLoading ? (
                <div className="px-5 py-6 text-sm text-slate-500">
                  Loading members...
                </div>
              ) : members.length === 0 ? (
                <div className="px-5 py-6 text-sm text-slate-500">
                  No members found.
                </div>
              ) : (
                members.map((member) => {
                  const displayName =
                    member.user?.display_name ||
                    [member.user?.first_name, member.user?.last_name]
                      .filter(Boolean)
                      .join(" ") ||
                    member.user?.email ||
                    "Unknown";

                  const isCurrentOwner = member.user_id === project?.client_id;

                  return (
                    <div
                      key={member.id}
                      className="px-5 py-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {displayName}
                          {isCurrentOwner ? (
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                              Owner
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-slate-500 truncate">
                          {member.user?.email || "No email"}
                        </p>
                      </div>
                      <span className="shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                        {member.position?.trim() || "Member"}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>

        {isOwner && (
          <>
            <section className="space-y-3">
              <h2 className="text-[30px] leading-none font-semibold text-slate-900">
                Transfer project
              </h2>
              <div className="app-surface-card-strong overflow-hidden rounded-2xl">
                <header className="px-5 py-4 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
                  <p className="text-sm text-slate-600">
                    Transfer ownership to another project member.
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsTransferSelectOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-md hover:bg-slate-100"
                  >
                    <RefreshCcw className="w-3.5 h-3.5" />
                    Transfer project
                  </button>
                </header>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-[30px] leading-none font-semibold text-slate-900">
                Delete project
              </h2>
              <div className="rounded-xl border border-red-200 bg-white overflow-hidden">
                <header className="px-5 py-4 border-b border-red-100 bg-red-50 flex items-center justify-between">
                  <p className="text-sm text-red-700">
                    Permanently remove this project and associated data.
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsDeleteOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-red-300 text-red-700 rounded-md hover:bg-red-100"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete project
                  </button>
                </header>
                <div className="px-5 py-4 text-sm text-red-700 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5" />
                  Deleting this project cannot be undone.
                </div>
              </div>
            </section>
          </>
        )}

        {canReassignConsultant && (
          <section className="space-y-3">
            <h2 className="text-[30px] leading-none font-semibold text-slate-900">
              Reassign consultant
            </h2>
            <div className="app-surface-card-strong overflow-hidden rounded-2xl">
              <header className="px-5 py-4 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
                <p className="text-sm text-slate-600">
                  Reassign consultant to another verified project member.
                </p>
                <button
                  type="button"
                  onClick={() => setIsConsultantSelectOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-md hover:bg-slate-100"
                >
                  <RefreshCcw className="w-3.5 h-3.5" />
                  Reassign consultant
                </button>
              </header>
            </div>
          </section>
        )}

        {canLeaveProject && (
          <section className="space-y-3">
            <h2 className="text-[30px] leading-none font-semibold text-slate-900">
              Leave project
            </h2>
            <div className="rounded-xl border border-amber-200 bg-white overflow-hidden">
              <header className="px-5 py-4 border-b border-amber-100 bg-amber-50/50 flex items-center justify-between">
                <p className="text-sm text-amber-800">
                  Leave this project. Tasks currently assigned to you will be
                  unassigned.
                </p>
                <button
                  type="button"
                  onClick={() => setIsLeaveOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-amber-300 text-amber-800 rounded-md hover:bg-amber-100"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Leave project
                </button>
              </header>
            </div>
          </section>
        )}
      </div>

      {showTransferSelectModal && (
        <div
          className={`fixed inset-0 z-60 flex items-center justify-center px-4 transition-opacity duration-200 ${
            transferSelectEntered
              ? "bg-black/45 backdrop-blur-sm opacity-100"
              : "bg-black/0 backdrop-blur-none opacity-0 pointer-events-none"
          }`}
        >
          <div
            className={`w-full max-w-xl rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden transition-all duration-200 ${
              transferSelectEntered
                ? "translate-y-0 scale-100 opacity-100"
                : "translate-y-3 scale-[0.98] opacity-0"
            }`}
          >
            <div className="px-6 py-4 border-b border-slate-200 bg-linear-to-r from-[#fff7ed] to-[#fffaf6] flex items-center justify-between">
              <h3 className="text-[16px] font-semibold text-slate-900">
                Select new project owner
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsTransferSelectOpen(false);
                  setSelectedOwnerId("");
                }}
                className="p-1.5 rounded-md hover:bg-[#fff0df] text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 py-4 space-y-3 max-h-[380px] overflow-y-auto bg-slate-50">
              {transferrableMembers.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No eligible members available for transfer.
                </p>
              ) : (
                transferrableMembers.map((member) => {
                  const memberName = getMemberDisplayName(member);
                  const memberInitials = getInitials(memberName);
                  const selected = selectedOwnerId === member.user_id;

                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => setSelectedOwnerId(member.user_id || "")}
                      className={`w-full text-left px-3.5 py-3 rounded-xl border transition-all ${
                        selected
                          ? "border-slate-500 bg-slate-100 shadow-[0_4px_14px_rgba(15,23,42,0.12)]"
                          : "border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full overflow-hidden border border-slate-200 bg-slate-200 shrink-0 flex items-center justify-center">
                            {member.user?.avatar_url ? (
                              <img
                                src={member.user.avatar_url}
                                alt={memberName}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <span className="text-[11px] font-bold text-slate-700">
                                {memberInitials || "?"}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">
                              {memberName}
                            </p>
                            <div className="text-xs text-slate-500 truncate">
                              {member.user?.email || "No email"}
                            </div>
                          </div>
                        </div>
                        {selected ? (
                          <Check className="w-4 h-4 text-slate-700" />
                        ) : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50">
              <button
                type="button"
                onClick={() => {
                  setIsTransferSelectOpen(false);
                  setSelectedOwnerId("");
                }}
                className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md"
                disabled={isTransferSaving || isConsultantTransferSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsTransferSelectOpen(false);
                  setIsTransferConfirmOpen(true);
                }}
                disabled={!selectedOwnerId || isTransferSaving || isConsultantTransferSaving}
                className="px-3 py-2 text-sm font-semibold text-white app-cta rounded-md disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {isTransferConfirmOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-[16px] font-semibold text-slate-900">
                Confirm ownership transfer
              </h3>
              <button
                type="button"
                onClick={() => setIsTransferConfirmOpen(false)}
                className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 py-4 space-y-2">
              <p className="text-sm text-slate-700">
                You are about to transfer project ownership to:
              </p>
              <p className="text-sm font-semibold text-slate-900">
                {selectedOwnerMember?.user?.display_name ||
                  [selectedOwnerMember?.user?.first_name, selectedOwnerMember?.user?.last_name]
                    .filter(Boolean)
                    .join(" ") ||
                  selectedOwnerMember?.user?.email ||
                  "Selected member"}
              </p>
              <p className="text-xs text-slate-500">
                {selectedOwnerMember?.user?.email || "No email"}
              </p>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 bg-gray-50">
              <button
                type="button"
                onClick={() => setIsTransferConfirmOpen(false)}
                className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md"
                disabled={isTransferSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitTransfer()}
                disabled={!selectedOwnerId || isTransferSaving}
                className="px-3 py-2 text-sm font-semibold text-white app-cta rounded-md disabled:opacity-50"
              >
                {isTransferSaving ? "Transferring..." : "Confirm transfer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showConsultantSelectModal && (
        <div
          className={`fixed inset-0 z-60 flex items-center justify-center px-4 transition-opacity duration-200 ${
            consultantSelectEntered
              ? "bg-black/45 backdrop-blur-sm opacity-100"
              : "bg-black/0 backdrop-blur-none opacity-0 pointer-events-none"
          }`}
        >
          <div
            className={`w-full max-w-xl rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden transition-all duration-200 ${
              consultantSelectEntered
                ? "translate-y-0 scale-100 opacity-100"
                : "translate-y-3 scale-[0.98] opacity-0"
            }`}
          >
            <div className="px-6 py-4 border-b border-slate-200 bg-linear-to-r from-[#fff7ed] to-[#fffaf6] flex items-center justify-between">
              <h3 className="text-[16px] font-semibold text-slate-900">
                Select new consultant
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsConsultantSelectOpen(false);
                  setSelectedConsultantId("");
                }}
                className="p-1.5 rounded-md hover:bg-[#fff0df] text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 py-4 space-y-3 max-h-[380px] overflow-y-auto bg-slate-50">
              {reassignableConsultantMembers.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No verified project members available for consultant reassignment.
                </p>
              ) : (
                reassignableConsultantMembers.map((member) => {
                  const memberName = getMemberDisplayName(member);
                  const memberInitials = getInitials(memberName);
                  const selected = selectedConsultantId === member.user_id;

                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => setSelectedConsultantId(member.user_id || "")}
                      className={`w-full text-left px-3.5 py-3 rounded-xl border transition-all ${
                        selected
                          ? "border-slate-500 bg-slate-100 shadow-[0_4px_14px_rgba(15,23,42,0.12)]"
                          : "border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full overflow-hidden border border-slate-200 bg-slate-200 shrink-0 flex items-center justify-center">
                            {member.user?.avatar_url ? (
                              <img
                                src={member.user.avatar_url}
                                alt={memberName}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <span className="text-[11px] font-bold text-slate-700">
                                {memberInitials || "?"}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">
                              {memberName}
                            </p>
                            <div className="text-xs text-slate-500 truncate">
                              {member.user?.email || "No email"}
                            </div>
                          </div>
                        </div>
                        {selected ? (
                          <Check className="w-4 h-4 text-slate-700" />
                        ) : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50">
              <button
                type="button"
                onClick={() => {
                  setIsConsultantSelectOpen(false);
                  setSelectedConsultantId("");
                }}
                className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md"
                disabled={isConsultantTransferSaving || isTransferSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsConsultantSelectOpen(false);
                  setIsConsultantConfirmOpen(true);
                }}
                disabled={
                  !selectedConsultantId ||
                  isConsultantTransferSaving ||
                  isTransferSaving
                }
                className="px-3 py-2 text-sm font-semibold text-white app-cta rounded-md disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {isConsultantConfirmOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-[16px] font-semibold text-slate-900">
                Confirm consultant reassignment
              </h3>
              <button
                type="button"
                onClick={() => setIsConsultantConfirmOpen(false)}
                className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 py-4 space-y-2">
              <p className="text-sm text-slate-700">
                You are about to reassign consultant to:
              </p>
              <p className="text-sm font-semibold text-slate-900">
                {selectedConsultantMember?.user?.display_name ||
                  [
                    selectedConsultantMember?.user?.first_name,
                    selectedConsultantMember?.user?.last_name,
                  ]
                    .filter(Boolean)
                    .join(" ") ||
                  selectedConsultantMember?.user?.email ||
                  "Selected member"}
              </p>
              <p className="text-xs text-slate-500">
                {selectedConsultantMember?.user?.email || "No email"}
              </p>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 bg-gray-50">
              <button
                type="button"
                onClick={() => setIsConsultantConfirmOpen(false)}
                className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md"
                disabled={isConsultantTransferSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitConsultantReassign()}
                disabled={!selectedConsultantId || isConsultantTransferSaving}
                className="px-3 py-2 text-sm font-semibold text-white app-cta rounded-md disabled:opacity-50"
              >
                {isConsultantTransferSaving
                  ? "Reassigning..."
                  : "Confirm reassignment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isDeleteOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white border border-red-200 shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-red-100 bg-red-50">
              <h3 className="text-[16px] font-semibold text-red-700">
                Delete project
              </h3>
              <p className="mt-1 text-sm text-red-700">
                Type <span className="font-semibold">{project?.title}</span> to
                confirm deletion.
              </p>
            </div>

            <div className="px-6 py-4">
              <input
                type="text"
                value={deleteText}
                onChange={(e) => setDeleteText(e.target.value)}
                className="w-full rounded-lg border border-red-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
                placeholder="Enter project name to confirm"
              />
            </div>

            <div className="px-6 py-4 border-t border-red-100 bg-red-50/40 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsDeleteOpen(false);
                  setDeleteText("");
                }}
                className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md"
                disabled={isDeleteSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitDelete()}
                disabled={!deleteConfirmMatches || isDeleteSaving}
                className="px-3 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50"
              >
                {isDeleteSaving ? "Deleting..." : "Delete project"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isLeaveOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white border border-amber-200 shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-amber-100 bg-amber-50/70">
              <h3 className="text-[16px] font-semibold text-amber-900">
                Leave project
              </h3>
              <p className="mt-1 text-sm text-amber-800">
                This will remove your project membership and unassign tasks
                currently assigned to you across this project&apos;s roadmaps.
              </p>
            </div>

            <div className="px-6 py-4 border-t border-amber-100 bg-amber-50/30 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsLeaveOpen(false)}
                className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md"
                disabled={isLeaveSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitLeaveProject()}
                disabled={isLeaveSaving}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-md disabled:opacity-50"
              >
                {isLeaveSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LogOut className="w-4 h-4" />
                )}
                {isLeaveSaving ? "Leaving..." : "Leave project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ProjectSettingsLayout>
  );
}


