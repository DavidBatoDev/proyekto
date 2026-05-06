// @ts-nocheck
//
// REFERENCE: kept as a visual / structural reference for the future
// team-level time pages. Project-level Time page removed in May 2026;
// references removed types (`access="time"`, `permissions.time.*`).
// Restore or rewrite against `team_members.hourly_rate` when re-enabling.

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  projectTimeService,
  type TaskTimeLog,
} from "@/services/project-time.service";
import { TeamMemberLogsGrid } from "@/components/project/time/TeamMemberLogsGrid";
import { EditLogModal } from "@/components/project/time/TimeModals";
import { TimeRouteFrame } from "@/components/project/time/TimeRouteFrame";
import {
  fromLocalDateTimeInput,
  liveDurationSecondsFromLog,
  toLocalDateTimeInput,
} from "@/components/project/time/time-utils";
import {
  getErrorMessage,
  isForbiddenError,
  projectTimeKeys,
} from "@/queries/project-time";
import {
  MY_LOGS_LIMIT,
  MY_LOGS_PAGE,
  useTimeRouteData,
} from "@/components/project/time/useTimeRouteData";
import { useToast } from "@/hooks/useToast";
import { useRoadmapStore } from "@/stores/roadmapStore";
import {
  clearLogRollbackKey,
  clearRecordKey,
  enqueueReviewIntent,
  findLogById,
  patchLogById,
  patchLogsByIds,
} from "@/components/project/time/timeOptimistic";

export const Route = createFileRoute(
  "/project/$projectId/time/team-logs/$projectMemberId",
)({
  component: TimeTeamMemberLogsPage,
});

function TimeTeamMemberLogsPage() {
  const { projectId, projectMemberId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const {
    actorKey,
    actorUserId,
    canManageRates,
    canApproveLogs,
    canEditTeamLogs,
    canShowMyLogsTab,
    canViewTeamLogs,
    loadingPermissions,
    loadingMembers,
    rates,
    projectTasks,
    teamMembers,
    queryErrorMessage,
    showMyLogsTabSkeleton,
    shouldShowAccessDenied,
  } = useTimeRouteData(projectId, {
    includeOwnRate: false,
    includeTasks: true,
    includeRates: true,
    includeTeamMembers: true,
  });

  const [error, setError] = useState<string | null>(null);
  const [timerNowMs, setTimerNowMs] = useState(Date.now());
  const [pendingLogById, setPendingLogById] = useState<Record<string, boolean>>(
    {},
  );
  const [queuedReviewIntentByLogId, setQueuedReviewIntentByLogId] = useState<
    Record<string, "approved" | "rejected" | "pending">
  >({});
  const [activeReviewSyncByLogId, setActiveReviewSyncByLogId] = useState<
    Record<string, boolean>
  >({});
  const [reviewRollbackByLogId, setReviewRollbackByLogId] = useState<
    Partial<Record<string, TaskTimeLog>>
  >({});
  const [isBulkReviewing, setIsBulkReviewing] = useState(false);
  const [selectedLogIds, setSelectedLogIds] = useState<Set<string>>(new Set());
  const [bulkDecision, setBulkDecision] = useState<
    "approved" | "rejected" | "pending"
  >("approved");

  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editStartedAt, setEditStartedAt] = useState("");
  const [editEndedAt, setEditEndedAt] = useState("");

  const pendingLogByIdRef = useRef(pendingLogById);
  const queuedReviewIntentByLogIdRef = useRef(queuedReviewIntentByLogId);
  const activeReviewSyncByLogIdRef = useRef(activeReviewSyncByLogId);
  const reviewRollbackByLogIdRef = useRef(reviewRollbackByLogId);

  const targetMember = useMemo(
    () => teamMembers.find((member) => member.id === projectMemberId) ?? null,
    [teamMembers, projectMemberId],
  );

  const targetMemberUserId = targetMember?.user_id ?? null;

  useEffect(() => {
    if (!targetMemberUserId || !actorUserId) return;
    if (targetMemberUserId !== actorUserId) return;

    void navigate({
      to: "/project/$projectId/time/my-logs",
      params: { projectId },
      replace: true,
    });
  }, [actorUserId, navigate, projectId, targetMemberUserId]);

  const targetRate = useMemo(() => {
    const directMatch = rates.find((rate) => rate.project_member_id === projectMemberId);
    if (directMatch) return directMatch;
    if (!targetMemberUserId) return null;
    return rates.find((rate) => rate.member_user_id === targetMemberUserId) ?? null;
  }, [rates, projectMemberId, targetMemberUserId]);

  const taskRoadmapById = useMemo(() => {
    const map = new Map<string, { roadmapId: string; featureId: string }>();
    for (const task of projectTasks) {
      map.set(task.id, {
        roadmapId: task.roadmap_id,
        featureId: task.feature_id,
      });
    }
    return map;
  }, [projectTasks]);

  const targetDisplayName =
    targetRate?.member?.display_name ||
    targetRate?.member?.email ||
    targetMember?.user?.display_name ||
    targetMember?.user?.email ||
    targetMemberUserId ||
    "Project Member";

  const logsScope: "team" | "approvals" =
    canApproveLogs ? "approvals" : canEditTeamLogs || canManageRates ? "team" : "approvals";

  const teamLogsQueryKey = projectTimeKeys.teamLogs(
    projectId,
    actorKey,
    targetMemberUserId ?? "unknown-member",
    MY_LOGS_PAGE,
    MY_LOGS_LIMIT,
    logsScope,
  );

  const teamLogsQuery = useQuery({
    queryKey: teamLogsQueryKey,
    queryFn: async () => {
      const endpointOrder: Array<"approvals" | "team"> = [];
      if (canApproveLogs) endpointOrder.push("approvals");
      if (canEditTeamLogs || canManageRates) endpointOrder.push("team");
      if (endpointOrder.length === 0) endpointOrder.push(logsScope);

      let lastError: unknown;
      for (const endpoint of endpointOrder) {
        try {
          const listLogs =
            endpoint === "team"
              ? projectTimeService.listTeamLogs
              : projectTimeService.listApprovals;
          const result = await listLogs(projectId, {
            page: MY_LOGS_PAGE,
            limit: MY_LOGS_LIMIT,
            member_user_id: targetMemberUserId ?? undefined,
          });
          return result.items;
        } catch (error) {
          if (!isForbiddenError(error)) throw error;
          lastError = error;
        }
      }

      throw lastError ?? new Error("Failed to load team member logs.");
    },
    enabled:
      canViewTeamLogs &&
      Boolean(targetMemberUserId) &&
      (logsScope === "team" || canApproveLogs),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const logs = teamLogsQuery.data ?? [];
  const loadingLogs = teamLogsQuery.isPending;

  const canOpenTaskInRoadmap = useCallback(
    (taskId: string) => {
      const entry = taskRoadmapById.get(taskId);
      return Boolean(entry?.featureId && entry?.roadmapId);
    },
    [taskRoadmapById],
  );

  const openTaskInRoadmap = useCallback(
    (log: TaskTimeLog) => {
      const entry = taskRoadmapById.get(log.task_id);
      if (!entry?.featureId || !entry?.roadmapId) {
        setError("This task is not linked to an accessible roadmap.");
        toast.error("This task is not linked to an accessible roadmap.");
        return;
      }

      const roadmapStore = useRoadmapStore.getState();
      roadmapStore.setCanvasViewMode("roadmap");
      roadmapStore.navigateToNode(entry.featureId, { taskId: log.task_id });
      setError(null);
      void navigate({
        to: "/project/$projectId/roadmap/$roadmapId",
        params: {
          projectId,
          roadmapId: entry.roadmapId,
        },
      });
    },
    [navigate, projectId, taskRoadmapById, toast],
  );

  const invalidateTeamLogs = () => {
    if (!targetMemberUserId) return Promise.resolve();
    return queryClient.invalidateQueries({
      queryKey: teamLogsQueryKey,
    });
  };

  const getCachedLogs = useCallback(
    () => queryClient.getQueryData<TaskTimeLog[]>(teamLogsQueryKey) ?? [],
    [queryClient, teamLogsQueryKey],
  );

  const setCachedLogs = useCallback(
    (updater: (logsList: TaskTimeLog[]) => TaskTimeLog[]) => {
      queryClient.setQueryData<TaskTimeLog[]>(teamLogsQueryKey, (current) => {
        const safeCurrent = current ?? [];
        return updater(safeCurrent);
      });
    },
    [queryClient, teamLogsQueryKey],
  );

  const setLogPending = useCallback((logId: string, pending: boolean) => {
    setPendingLogById((prev) => {
      const next = pending ? { ...prev, [logId]: true } : clearRecordKey(prev, logId);
      pendingLogByIdRef.current = next;
      return next;
    });
  }, []);

  const hasActiveLog = useMemo(() => logs.some((log) => !log.ended_at), [logs]);

  useEffect(() => {
    if (!hasActiveLog) return;
    const interval = window.setInterval(() => setTimerNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [hasActiveLog]);

  useEffect(() => {
    setSelectedLogIds((previous) => {
      if (previous.size === 0) return previous;
      const eligibleSet = new Set(
        logs.filter((log) => !!log.ended_at).map((log) => log.id),
      );
      const next = new Set<string>();
      for (const id of previous) {
        if (eligibleSet.has(id)) next.add(id);
      }
      return next;
    });
  }, [logs]);

  useEffect(() => {
    pendingLogByIdRef.current = pendingLogById;
  }, [pendingLogById]);

  useEffect(() => {
    queuedReviewIntentByLogIdRef.current = queuedReviewIntentByLogId;
  }, [queuedReviewIntentByLogId]);

  useEffect(() => {
    activeReviewSyncByLogIdRef.current = activeReviewSyncByLogId;
  }, [activeReviewSyncByLogId]);

  useEffect(() => {
    reviewRollbackByLogIdRef.current = reviewRollbackByLogId;
  }, [reviewRollbackByLogId]);

  const totalHoursWorked = useMemo(() => {
    return logs.reduce((sum, log) => {
      const seconds = liveDurationSecondsFromLog(log, timerNowMs);
      return sum + seconds / 3600;
    }, 0);
  }, [logs, timerNowMs]);

  const totalWorkAmount = useMemo(() => {
    if (!targetRate) return 0;
    const hourlyRate = Number(targetRate.hourly_rate);
    if (!Number.isFinite(hourlyRate)) return 0;
    return totalHoursWorked * hourlyRate;
  }, [targetRate, totalHoursWorked]);

  const formattedTotalWork = useMemo(() => {
    const currency = targetRate?.currency || "USD";
    return `${totalWorkAmount.toFixed(2)} ${currency}`;
  }, [targetRate?.currency, totalWorkAmount]);

  const approvedAmount = useMemo(() => {
    if (!targetRate) return 0;
    const hourlyRate = Number(targetRate.hourly_rate);
    if (!Number.isFinite(hourlyRate)) return 0;

    return logs.reduce((sum, log) => {
      if (log.status !== "approved") return sum;
      const seconds = liveDurationSecondsFromLog(log, timerNowMs);
      const hours = seconds / 3600;
      return sum + hours * hourlyRate;
    }, 0);
  }, [logs, targetRate, timerNowMs]);

  const rejectedAmount = useMemo(() => {
    if (!targetRate) return 0;
    const hourlyRate = Number(targetRate.hourly_rate);
    if (!Number.isFinite(hourlyRate)) return 0;

    return logs.reduce((sum, log) => {
      if (log.status !== "rejected") return sum;
      const seconds = liveDurationSecondsFromLog(log, timerNowMs);
      const hours = seconds / 3600;
      return sum + hours * hourlyRate;
    }, 0);
  }, [logs, targetRate, timerNowMs]);

  const formattedApprovedAmount = useMemo(() => {
    const currency = targetRate?.currency || "USD";
    return `${approvedAmount.toFixed(2)} ${currency}`;
  }, [approvedAmount, targetRate?.currency]);

  const formattedRejectedAmount = useMemo(() => {
    const currency = targetRate?.currency || "USD";
    return `${rejectedAmount.toFixed(2)} ${currency}`;
  }, [rejectedAmount, targetRate?.currency]);

  const formatRateDate = (value?: string | null) => {
    if (!value) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "-";
    return parsed.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };

  const beginEditLog = (log: TaskTimeLog) => {
    setEditingLogId(log.id);
    setEditStartedAt(toLocalDateTimeInput(log.started_at));
    setEditEndedAt(toLocalDateTimeInput(log.ended_at));
  };

  const closeEditLogModal = () => {
    setEditingLogId(null);
    setEditStartedAt("");
    setEditEndedAt("");
  };

  const enqueueReviewChange = useCallback(
    (logId: string, decision: "approved" | "rejected" | "pending") => {
      const runtime = {
        getLog: (id: string) => findLogById(getCachedLogs(), id),
        isActive: (id: string) => Boolean(activeReviewSyncByLogIdRef.current[id]),
        setActive: (id: string, value: boolean) => {
          setActiveReviewSyncByLogId((prev) => {
            const next = value
              ? { ...prev, [id]: true }
              : clearRecordKey(prev, id);
            activeReviewSyncByLogIdRef.current = next;
            return next;
          });
        },
        getQueuedIntent: (id: string) => queuedReviewIntentByLogIdRef.current[id],
        setQueuedIntent: (
          id: string,
          nextDecision: "approved" | "rejected" | "pending",
        ) => {
          setQueuedReviewIntentByLogId((prev) => {
            const next = { ...prev, [id]: nextDecision };
            queuedReviewIntentByLogIdRef.current = next;
            return next;
          });
        },
        clearQueuedIntent: (id: string) => {
          setQueuedReviewIntentByLogId((prev) => {
            const next = clearRecordKey(prev, id);
            queuedReviewIntentByLogIdRef.current = next;
            return next;
          });
        },
        getRollbackLog: (id: string) => reviewRollbackByLogIdRef.current[id],
        setRollbackLog: (id: string, log: TaskTimeLog) => {
          setReviewRollbackByLogId((prev) => {
            const next = { ...prev, [id]: log };
            reviewRollbackByLogIdRef.current = next;
            return next;
          });
        },
        clearRollbackLog: (id: string) => {
          setReviewRollbackByLogId((prev) => {
            const next = clearLogRollbackKey(prev, id);
            reviewRollbackByLogIdRef.current = next;
            return next;
          });
        },
        applyOptimisticReview: (
          id: string,
          nextDecision: "approved" | "rejected" | "pending",
        ) => {
          setCachedLogs((list) =>
            patchLogById(list, id, (log) => ({
              ...log,
              status: nextDecision,
              updated_at: new Date().toISOString(),
            })),
          );
        },
        applyServerLog: (
          id: string,
          serverLog: TaskTimeLog,
          options: { preserveOptimisticStatus: boolean },
        ) => {
          setCachedLogs((list) =>
            patchLogById(list, id, (log) => {
              const merged = { ...log, ...serverLog };
              if (!options.preserveOptimisticStatus) return merged;
              return {
                ...merged,
                status: log.status,
              };
            }),
          );
        },
        rollbackLog: (id: string, rollbackLog: TaskTimeLog) => {
          setCachedLogs((list) => patchLogById(list, id, () => rollbackLog));
        },
        sendReviewUpdate: async (
          id: string,
          nextDecision: "approved" | "rejected" | "pending",
        ) => projectTimeService.review(id, nextDecision),
      };

      void enqueueReviewIntent(runtime, logId, decision)
        .catch((e) => {
          setError(getErrorMessage(e, "Failed to review time log."));
          toast.error("Failed to review time log.");
        })
        .finally(() => {
          void invalidateTeamLogs();
        });
    },
    [getCachedLogs, invalidateTeamLogs, setCachedLogs, toast],
  );

  const saveEditedLog = async () => {
    if (!editingLogId) return;
    const logId = editingLogId;
    const started_at = fromLocalDateTimeInput(editStartedAt);
    const ended_at = fromLocalDateTimeInput(editEndedAt);
    if (!started_at) {
      setError("Time-in is required.");
      return;
    }

    const rollbackLog = findLogById(getCachedLogs(), logId);
    if (!rollbackLog) return;

    closeEditLogModal();

    try {
      setError(null);
      setLogPending(logId, true);
      setCachedLogs((list) =>
        patchLogById(list, logId, (log) => ({
          ...log,
          started_at,
          ended_at: ended_at ?? null,
          updated_at: new Date().toISOString(),
        })),
      );
      const updated = await projectTimeService.update(logId, {
        started_at,
        ...(ended_at ? { ended_at } : {}),
      });
      setCachedLogs((list) => patchLogById(list, logId, () => updated));
    } catch (e) {
      setError(getErrorMessage(e, "Failed to update time log."));
      toast.error("Failed to update time log.");
      setCachedLogs((list) => patchLogById(list, logId, () => rollbackLog));
    } finally {
      setLogPending(logId, false);
      void invalidateTeamLogs();
    }
  };

  const reviewLog = async (
    logId: string,
    decision: "approved" | "rejected" | "pending",
  ) => {
    if (pendingLogByIdRef.current[logId]) return;
    setError(null);
    enqueueReviewChange(logId, decision);
  };

  const toggleSelectLog = (logId: string, checked: boolean) => {
    setSelectedLogIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(logId);
      else next.delete(logId);
      return next;
    });
  };

  const toggleSelectAll = (checked: boolean, eligibleLogIds: string[]) => {
    setSelectedLogIds((previous) => {
      const next = new Set(previous);
      for (const id of eligibleLogIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const applyBulkDecisionToSelected = async () => {
    const ids = Array.from(selectedLogIds);
    if (ids.length === 0) return;

    const rollbackById = new Map<string, TaskTimeLog>();
    const currentLogs = getCachedLogs();
    for (const id of ids) {
      const log = findLogById(currentLogs, id);
      if (log) rollbackById.set(id, log);
    }
    if (rollbackById.size === 0) return;

    setIsBulkReviewing(true);

    try {
      setError(null);
      setPendingLogById((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = true;
        pendingLogByIdRef.current = next;
        return next;
      });
      setCachedLogs((list) =>
        patchLogsByIds(list, ids, (log) => ({
          ...log,
          status: bulkDecision,
          updated_at: new Date().toISOString(),
        })),
      );

      const updatedLogs = await projectTimeService.reviewBulk(ids, bulkDecision);
      const updatedById = new Map(updatedLogs.map((log) => [log.id, log]));

      setCachedLogs((list) =>
        list.map((log) => {
          const updated = updatedById.get(log.id);
          return updated ? { ...log, ...updated } : log;
        }),
      );

      const failedIds = ids.filter((id) => !updatedById.has(id));
      if (failedIds.length > 0) {
        setCachedLogs((list) =>
          list.map((log) => {
            const rollback = rollbackById.get(log.id);
            return rollback ? rollback : log;
          }),
        );
        setSelectedLogIds(new Set(failedIds));
        setError("Some selected logs could not be updated.");
        toast.error("Some selected logs could not be updated.");
      } else {
        setSelectedLogIds(new Set());
      }
    } catch (e) {
      setError(getErrorMessage(e, "Failed to update selected logs."));
      toast.error("Failed to update selected logs.");
      setCachedLogs((list) =>
        list.map((log) => {
          const rollback = rollbackById.get(log.id);
          return rollback ? rollback : log;
        }),
      );
    } finally {
      setPendingLogById((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        pendingLogByIdRef.current = next;
        return next;
      });
      setIsBulkReviewing(false);
      void invalidateTeamLogs();
    }
  };

  const pageError = useMemo(() => {
    if (teamLogsQuery.error) {
      if (isForbiddenError(teamLogsQuery.error)) {
        return "You do not have permission to view this member's logs.";
      }
      return getErrorMessage(teamLogsQuery.error, "Failed to load team member logs.");
    }
    return queryErrorMessage;
  }, [queryErrorMessage, teamLogsQuery.error]);

  return (
    <TimeRouteFrame
      projectId={projectId}
      activeTab="team_logs"
      loadingPermissions={loadingPermissions}
      showMyLogsTabSkeleton={showMyLogsTabSkeleton}
      canShowMyLogsTab={canShowMyLogsTab}
      canViewTeamLogs={canViewTeamLogs}
      errorMessage={error || pageError}
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
            You do not have permission to access team member logs.
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Ask a manager for Team Logs or Approve permission.
          </p>
        </div>
      ) : loadingMembers ? (
        <div className="rounded-xl border border-slate-200 overflow-hidden bg-white animate-pulse">
          <div className="h-10 border-b border-slate-200 bg-slate-100" />
          <div className="p-3 space-y-2">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="h-8 rounded bg-slate-100" />
            ))}
          </div>
        </div>
      ) : !targetMember ? (
        <div className="app-surface-card rounded-2xl border-dashed p-12 text-center">
          <p className="text-sm font-semibold text-slate-800">Project member not found.</p>
          <p className="mt-1 text-sm text-slate-500">
            The selected member may have been removed from this project.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-10 gap-4 items-start">
          <div className="xl:col-span-7 min-w-0">
            {canApproveLogs && selectedLogIds.size > 0 && (
              <div className="mb-2 flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2">
                <p className="text-xs text-slate-600">
                  Selected logs: <span className="font-semibold">{selectedLogIds.size}</span>
                </p>
                <div className="flex items-center gap-2">
                  <select
                    value={bulkDecision}
                    onChange={(event) =>
                      setBulkDecision(
                        event.currentTarget.value as "approved" | "rejected" | "pending",
                      )
                    }
                    disabled={isBulkReviewing}
                    className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700 disabled:opacity-50"
                  >
                    <option value="approved">Set All Approved</option>
                    <option value="rejected">Set All Rejected</option>
                    <option value="pending">Set All Pending</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void applyBulkDecisionToSelected()}
                    disabled={selectedLogIds.size === 0 || isBulkReviewing}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Apply
                  </button>
                </div>
              </div>
            )}
            <TeamMemberLogsGrid
              logs={logs}
              targetRate={targetRate}
              loadingLogs={loadingLogs}
              timerNowMs={timerNowMs}
              canEditTeam={canEditTeamLogs}
              canApprove={canApproveLogs}
              selectedLogIds={selectedLogIds}
              rowPendingById={pendingLogById}
              reviewSyncById={activeReviewSyncByLogId}
              onToggleSelectLog={toggleSelectLog}
              onToggleSelectAll={toggleSelectAll}
              onEditLog={beginEditLog}
              onReviewLog={reviewLog}
              onOpenTaskInRoadmap={openTaskInRoadmap}
              canOpenTaskInRoadmap={canOpenTaskInRoadmap}
            />
            <p className="mt-2 text-[11px] text-slate-500">
              Running timers are visible for monitoring. Approve/reject is available
              after the member stops the timer.
            </p>
          </div>

          <aside className="xl:col-span-3 xl:sticky xl:top-6">
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="border-b border-slate-200 bg-slate-900 px-4 py-3">
                <h3 className="text-sm font-semibold text-white">{targetDisplayName}</h3>
              </div>

              <div className="p-4 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500">Employee ID</span>
                  <span className="font-semibold text-slate-700">
                    {targetRate?.custom_id || targetMemberUserId || "-"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500">Start Date</span>
                  <span className="text-right">{formatRateDate(targetRate?.start_date)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500">End Date</span>
                  <span className="text-right">{formatRateDate(targetRate?.end_date)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500">Hourly Rate</span>
                  <span className="font-semibold">
                    {targetRate
                      ? `${Number(targetRate.hourly_rate).toFixed(2)} ${targetRate.currency}`
                      : "-"}
                  </span>
                </div>
              </div>

              <div className="border-t border-slate-200 p-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border border-slate-200">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="px-2 py-1 text-left border-b border-slate-200">Work</th>
                        <th className="px-2 py-1 text-left border-b border-slate-200">Approved</th>
                        <th className="px-2 py-1 text-left border-b border-slate-200">Rejected</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="px-2 py-1 font-semibold">{formattedTotalWork}</td>
                        <td className="px-2 py-1">{formattedApprovedAmount}</td>
                        <td className="px-2 py-1">{formattedRejectedAmount}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-slate-500 mt-2">
                  Total Hours: {totalHoursWorked.toFixed(2)}
                </p>
              </div>
            </div>
          </aside>
        </div>
      )}

      <EditLogModal
        isOpen={editingLogId !== null && canEditTeamLogs}
        startedAt={editStartedAt}
        endedAt={editEndedAt}
        saving={editingLogId ? Boolean(pendingLogById[editingLogId]) : false}
        onClose={closeEditLogModal}
        onSave={saveEditedLog}
        onChangeStartedAt={setEditStartedAt}
        onChangeEndedAt={setEditEndedAt}
      />
    </TimeRouteFrame>
  );
}

