import {
  Outlet,
  createFileRoute,
  useChildMatches,
  useNavigate,
} from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ProjectMember } from "@/services/project.service";
import {
  projectTimeService,
  type ProjectMemberTimeRate,
} from "@/services/project-time.service";
import { TeamRatesSection } from "@/components/project/time/TeamRatesSection";
import {
  AddRateModal,
  DeleteRateModal,
  EditRateModal,
} from "@/components/project/time/TimeModals";
import { TimeRouteFrame } from "@/components/project/time/TimeRouteFrame";
import {
  getErrorMessage,
  projectTimeKeys,
} from "@/queries/project-time";
import {
  MY_LOGS_LIMIT,
  MY_LOGS_PAGE,
  useTimeRouteData,
} from "@/components/project/time/useTimeRouteData";
import { useToast } from "@/hooks/useToast";
import {
  clearRecordKey,
  createTempId,
  findRateById,
  patchRateById,
  prependRate,
  removeRateById,
  replaceRateByTempId,
  restoreRateAtIndex,
} from "@/components/project/time/timeOptimistic";

import { RequireProjectAccess } from "@/components/common/RequireProjectAccess";

export const Route = createFileRoute("/project/$projectId/time/team-logs")({
  component: TimeTeamLogsRoute,
});

function TimeTeamLogsRoute() {
  const { projectId } = Route.useParams();
  return (
    <RequireProjectAccess projectId={projectId} access="time">
      <TimeTeamLogsPage />
    </RequireProjectAccess>
  );
}

function TimeTeamLogsPage() {
  const childMatches = useChildMatches();
  if (childMatches.length > 0) {
    return <Outlet />;
  }

  return <TimeTeamLogsIndexPage />;
}

function TimeTeamLogsIndexPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const {
    actorKey,
    actorUserId,
    canManageRates,
    canViewTeamLogs,
    canShowMyLogsTab,
    loadingPermissions,
    loadingRates,
    loadingMembers,
    rates,
    teamMembers,
    queryErrorMessage,
    showMyLogsTabSkeleton,
    shouldShowAccessDenied,
  } = useTimeRouteData(projectId, {
    includeOwnRate: false,
    includeRates: true,
    includeTeamMembers: true,
  });

  const [error, setError] = useState<string | null>(null);

  const [isAddRateModalOpen, setIsAddRateModalOpen] = useState(false);
  const [newRateMemberId, setNewRateMemberId] = useState("");
  const [newRateCustomId, setNewRateCustomId] = useState("");
  const [newRateValue, setNewRateValue] = useState("");
  const [newRateCurrency, setNewRateCurrency] = useState("USD");
  const [newRateStartDate, setNewRateStartDate] = useState("");
  const [newRateEndDate, setNewRateEndDate] = useState("");

  const [isEditRateModalOpen, setIsEditRateModalOpen] = useState(false);
  const [isDeleteRateModalOpen, setIsDeleteRateModalOpen] = useState(false);
  const [deleteRateVerificationText, setDeleteRateVerificationText] = useState("");
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [editingRateCustomId, setEditingRateCustomId] = useState("");
  const [editingRateValue, setEditingRateValue] = useState("");
  const [editingRateCurrency, setEditingRateCurrency] = useState("USD");
  const [editingRateStartDate, setEditingRateStartDate] = useState("");
  const [editingRateEndDate, setEditingRateEndDate] = useState("");
  const [pendingRateById, setPendingRateById] = useState<Record<string, boolean>>(
    {},
  );
  const pendingRateByIdRef = useRef(pendingRateById);

  const ratesQueryKey = projectTimeKeys.rates(projectId, actorKey);

  const invalidateMyLogs = () =>
    queryClient.invalidateQueries({
      queryKey: projectTimeKeys.myLogs(
        projectId,
        actorKey,
        MY_LOGS_PAGE,
        MY_LOGS_LIMIT,
      ),
    });

  const invalidateRates = () =>
    queryClient.invalidateQueries({
      queryKey: projectTimeKeys.rates(projectId, actorKey),
    });

  const invalidateOwnRate = () =>
    queryClient.invalidateQueries({
      queryKey: projectTimeKeys.myRate(projectId, actorKey),
    });

  const invalidateTeamMembers = () =>
    queryClient.invalidateQueries({
      queryKey: projectTimeKeys.teamMembers(projectId, actorKey),
    });

  const getCachedRates = useCallback(
    () => queryClient.getQueryData<ProjectMemberTimeRate[]>(ratesQueryKey) ?? [],
    [queryClient, ratesQueryKey],
  );

  const setCachedRates = useCallback(
    (updater: (ratesList: ProjectMemberTimeRate[]) => ProjectMemberTimeRate[]) => {
      queryClient.setQueryData<ProjectMemberTimeRate[]>(ratesQueryKey, (current) => {
        const safeCurrent = current ?? [];
        return updater(safeCurrent);
      });
    },
    [queryClient, ratesQueryKey],
  );

  const setRatePending = useCallback((rateId: string, pending: boolean) => {
    setPendingRateById((prev) => {
      const next = pending ? { ...prev, [rateId]: true } : clearRecordKey(prev, rateId);
      pendingRateByIdRef.current = next;
      return next;
    });
  }, []);

  const membersWithoutRate = useMemo(() => {
    const userIdsWithRate = new Set(rates.map((rate) => rate.member_user_id));
    return teamMembers.filter(
      (member) => member.user_id && !userIdsWithRate.has(member.user_id),
    );
  }, [rates, teamMembers]);

  const editingRateTarget = useMemo(
    () => rates.find((rate) => rate.id === editingRateId) ?? null,
    [rates, editingRateId],
  );

  const formatMemberRole = (member: ProjectMember) => {
    const role = member.role ? member.role.replace(/_/g, " ") : "member";
    const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
    const position = (member.position || "").trim();
    return position ? `${roleLabel} | ${position}` : roleLabel;
  };

  const openEditRateModal = (rate: ProjectMemberTimeRate) => {
    setIsEditRateModalOpen(true);
    setEditingRateId(rate.id);
    setEditingRateCustomId(rate.custom_id || "");
    setEditingRateValue(String(rate.hourly_rate ?? ""));
    setEditingRateCurrency(rate.currency || "USD");
    setEditingRateStartDate(rate.start_date || "");
    setEditingRateEndDate(rate.end_date || "");
  };

  const closeEditRateModal = () => {
    setIsEditRateModalOpen(false);
    setIsDeleteRateModalOpen(false);
    setDeleteRateVerificationText("");
    setEditingRateId(null);
    setEditingRateCustomId("");
    setEditingRateValue("");
    setEditingRateCurrency("USD");
    setEditingRateStartDate("");
    setEditingRateEndDate("");
  };

  const createRate = async () => {
    if (!newRateMemberId) {
      setError("Select a member to add a time rate.");
      return;
    }

    const hourly = Number(newRateValue);
    if (!Number.isFinite(hourly) || hourly < 0) {
      setError("Hourly rate must be a non-negative number.");
      return;
    }
    if (!newRateStartDate) {
      setError("Start date is required.");
      return;
    }

    const member = teamMembers.find((item) => item.id === newRateMemberId);
    if (!member || !member.user_id) {
      setError("Selected member is invalid.");
      return;
    }

    const tempRateId = createTempId("tmp-rate");
    const currency = newRateCurrency.trim().toUpperCase() || "USD";
    const customId = newRateCustomId.trim();
    const endDate = newRateEndDate || undefined;
    const nowIso = new Date().toISOString();
    const tempRate: ProjectMemberTimeRate = {
      id: tempRateId,
      project_id: projectId,
      project_member_id: newRateMemberId,
      member_user_id: member.user_id,
      hourly_rate: hourly,
      currency,
      custom_id: customId || null,
      start_date: newRateStartDate,
      end_date: endDate ?? null,
      created_at: nowIso,
      updated_at: nowIso,
      member: member.user
        ? {
            id: member.user.id,
            display_name: member.user.display_name,
            email: member.user.email,
            avatar_url: member.user.avatar_url,
          }
        : undefined,
      project_member: {
        id: member.id,
        role: member.role,
        position: member.position ?? undefined,
      },
    };

    setIsAddRateModalOpen(false);
    setNewRateMemberId("");
    setNewRateCustomId("");
    setNewRateValue("");
    setNewRateCurrency("USD");
    setNewRateStartDate("");
    setNewRateEndDate("");

    try {
      setError(null);
      setRatePending(tempRateId, true);
      setCachedRates((list) => prependRate(list, tempRate));
      const created = await projectTimeService.createProjectMemberRate(projectId, {
        project_member_id: newRateMemberId,
        hourly_rate: hourly,
        currency,
        custom_id: customId,
        start_date: newRateStartDate,
        ...(endDate ? { end_date: endDate } : {}),
      });
      setCachedRates((list) => replaceRateByTempId(list, tempRateId, created));
    } catch (e) {
      setError(getErrorMessage(e, "Failed to create rate."));
      toast.error("Failed to create rate.");
      setCachedRates((list) => list.filter((rate) => rate.id !== tempRateId));
    } finally {
      setRatePending(tempRateId, false);
      await Promise.all([
        invalidateRates(),
        invalidateOwnRate(),
        invalidateMyLogs(),
        invalidateTeamMembers(),
      ]);
    }
  };

  const saveEditedRate = async (rateId: string) => {
    const hourly = Number(editingRateValue);
    if (!Number.isFinite(hourly) || hourly < 0) {
      setError("Hourly rate must be a non-negative number.");
      return;
    }
    if (!editingRateStartDate) {
      setError("Start date is required.");
      return;
    }

    if (pendingRateByIdRef.current[rateId]) return;
    const rollbackRate = findRateById(getCachedRates(), rateId);
    if (!rollbackRate) return;

    const currency = editingRateCurrency.trim().toUpperCase() || "USD";
    const customId = editingRateCustomId.trim();
    const endDate = editingRateEndDate || undefined;
    const optimisticRate: ProjectMemberTimeRate = {
      ...rollbackRate,
      hourly_rate: hourly,
      currency,
      custom_id: customId || null,
      start_date: editingRateStartDate,
      end_date: endDate ?? null,
      updated_at: new Date().toISOString(),
    };

    closeEditRateModal();

    try {
      setError(null);
      setRatePending(rateId, true);
      setCachedRates((list) => patchRateById(list, rateId, () => optimisticRate));
      const updated = await projectTimeService.updateProjectMemberRate(projectId, rateId, {
        hourly_rate: hourly,
        currency,
        custom_id: customId,
        start_date: editingRateStartDate,
        ...(endDate ? { end_date: endDate } : {}),
      });
      setCachedRates((list) => patchRateById(list, rateId, () => updated));
    } catch (e) {
      setError(getErrorMessage(e, "Failed to update rate."));
      toast.error("Failed to update rate.");
      setCachedRates((list) => patchRateById(list, rateId, () => rollbackRate));
    } finally {
      setRatePending(rateId, false);
      await Promise.all([invalidateRates(), invalidateOwnRate(), invalidateMyLogs()]);
    }
  };

  const deleteEditedRate = async (rateId: string) => {
    if (deleteRateVerificationText.trim().toUpperCase() !== "DELETE") return;
    if (pendingRateByIdRef.current[rateId]) return;

    const removal = removeRateById(getCachedRates(), rateId);
    if (!removal) return;

    closeEditRateModal();
    try {
      setError(null);
      setRatePending(rateId, true);
      setCachedRates(() => removal.rates);
      await projectTimeService.deleteProjectMemberRate(projectId, rateId);
    } catch (e) {
      setError(getErrorMessage(e, "Failed to delete rate."));
      toast.error("Failed to delete rate.");
      setCachedRates((list) =>
        restoreRateAtIndex(list, removal.removedRate, removal.removedIndex),
      );
    } finally {
      setRatePending(rateId, false);
      await Promise.all([
        invalidateRates(),
        invalidateOwnRate(),
        invalidateMyLogs(),
        invalidateTeamMembers(),
      ]);
    }
  };

  const onViewLogs = (rate: ProjectMemberTimeRate) => {
    if (actorUserId && rate.member_user_id === actorUserId) {
      void navigate({
        to: "/project/$projectId/time/my-logs",
        params: { projectId },
      });
      return;
    }

    if (!rate.project_member_id) {
      setError("Project member ID is missing for this rate.");
      return;
    }

    void navigate({
      to: "/project/$projectId/time/team-logs/$projectMemberId",
      params: { projectId, projectMemberId: rate.project_member_id },
    });
  };

  const savingRate = false;
  const deletingRate = editingRateId ? Boolean(pendingRateById[editingRateId]) : false;

  return (
    <TimeRouteFrame
      projectId={projectId}
      activeTab="team_logs"
      loadingPermissions={loadingPermissions}
      showMyLogsTabSkeleton={showMyLogsTabSkeleton}
      canShowMyLogsTab={canShowMyLogsTab}
      canViewTeamLogs={canViewTeamLogs}
      errorMessage={error || queryErrorMessage}
    >
      {shouldShowAccessDenied ? (
        <div className="app-surface-card rounded-2xl border-dashed p-12 text-center">
          <p className="text-sm font-semibold text-slate-800">
            You do not have permission to access Time tracking.
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Ask a manager to enable Time View permission.
          </p>
        </div>
      ) : !canViewTeamLogs ? (
        <div className="app-surface-card rounded-2xl border-dashed p-12 text-center">
          <p className="text-sm font-semibold text-slate-800">
            You do not have permission to access team logs.
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Ask a manager for Team Logs or Approve permission.
          </p>
        </div>
      ) : (
        <>
          <TeamRatesSection
            rates={rates}
            loadingRates={loadingRates}
            canManageRates={canManageRates}
            pendingRateById={pendingRateById}
            onViewLogs={onViewLogs}
            onOpenAddRate={() => setIsAddRateModalOpen(true)}
            onOpenEditRate={openEditRateModal}
          />

          <AddRateModal
            isOpen={isAddRateModalOpen}
            canManageRates={canManageRates}
            membersWithoutRate={membersWithoutRate}
            loadingMembers={loadingMembers}
            savingRate={savingRate}
            newRateMemberId={newRateMemberId}
            newRateCustomId={newRateCustomId}
            newRateValue={newRateValue}
            newRateCurrency={newRateCurrency}
            newRateStartDate={newRateStartDate}
            newRateEndDate={newRateEndDate}
            onClose={() => setIsAddRateModalOpen(false)}
            onCreateRate={createRate}
            onChangeMemberId={setNewRateMemberId}
            onChangeCustomId={setNewRateCustomId}
            onChangeRateValue={setNewRateValue}
            onChangeRateCurrency={setNewRateCurrency}
            onChangeStartDate={setNewRateStartDate}
            onChangeEndDate={setNewRateEndDate}
            formatMemberRole={formatMemberRole}
          />

          <EditRateModal
            isOpen={isEditRateModalOpen}
            canManageRates={canManageRates}
            editingRateId={editingRateId}
            editingRateTarget={editingRateTarget}
            editingRateCustomId={editingRateCustomId}
            editingRateValue={editingRateValue}
            editingRateCurrency={editingRateCurrency}
            editingRateStartDate={editingRateStartDate}
            editingRateEndDate={editingRateEndDate}
            savingRate={savingRate}
            onClose={closeEditRateModal}
            onSave={saveEditedRate}
            onRequestDelete={() => setIsDeleteRateModalOpen(true)}
            onChangeCustomId={setEditingRateCustomId}
            onChangeRateValue={setEditingRateValue}
            onChangeRateCurrency={setEditingRateCurrency}
            onChangeStartDate={setEditingRateStartDate}
            onChangeEndDate={setEditingRateEndDate}
          />

          <DeleteRateModal
            isOpen={isDeleteRateModalOpen && Boolean(editingRateId)}
            targetLabel={
              editingRateTarget?.member?.display_name ||
              editingRateTarget?.member?.email ||
              editingRateTarget?.custom_id ||
              editingRateTarget?.member_user_id
            }
            verificationText={deleteRateVerificationText}
            deletingRate={deletingRate}
            onClose={() => {
              setIsDeleteRateModalOpen(false);
              setDeleteRateVerificationText("");
            }}
            onChangeVerificationText={setDeleteRateVerificationText}
            onConfirmDelete={() =>
              editingRateId ? deleteEditedRate(editingRateId) : undefined
            }
          />
        </>
      )}
    </TimeRouteFrame>
  );
}

