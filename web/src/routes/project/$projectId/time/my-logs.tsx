// @ts-nocheck
//
// REFERENCE: kept as a visual / structural reference for the future
// team-level time pages. Project-level Time page removed in May 2026;
// references removed types (`access="time"`, `permissions.time.*`).
// Restore or rewrite against `team_members.hourly_rate` when re-enabling.

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  projectTimeService,
  type TaskTimeLog,
} from "@/services/project-time.service";
import { MyLogsGrid } from "@/components/project/time/MyLogsGrid";
import {
  AddLogModal,
  DeleteTimeLogModal,
  EditLogModal,
} from "@/components/project/time/TimeModals";
import { TimeRouteFrame } from "@/components/project/time/TimeRouteFrame";
import {
  fromLocalDateTimeInput,
  toLocalDateTimeInput,
} from "@/components/project/time/time-utils";
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
import { useRoadmapStore } from "@/stores/roadmapStore";
import {
  clearLogRollbackKey,
  clearRecordKey,
  createTempId,
  enqueueLogTaskIntent,
  findLogById,
  patchLogById,
  prependLog,
  removeLogById,
  replaceLogByTempId,
  restoreLogAtIndex,
} from "@/components/project/time/timeOptimistic";

import { RequireProjectAccess } from "@/components/common/RequireProjectAccess";

export const Route = createFileRoute("/project/$projectId/time/my-logs")({
  component: TimeMyLogsRoute,
});

function TimeMyLogsRoute() {
  const { projectId } = Route.useParams();
  return (
    <RequireProjectAccess projectId={projectId} access="time">
      <TimeMyLogsPage />
    </RequireProjectAccess>
  );
}

function TimeMyLogsPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const {
    actorKey,
    canShowMyLogsTab,
    canViewTeamLogs,
    loadingPermissions,
    loadingMyLogs,
    loadingProjectTasks,
    ownRate,
    myLogs,
    projectTasks,
    queryErrorMessage,
    showMyLogsTabSkeleton,
    shouldBlockPage,
    shouldShowAccessDenied,
  } = useTimeRouteData(projectId, {
    includeOwnRate: true,
    includeMyLogs: true,
    includeTasks: true,
  });

  const [error, setError] = useState<string | null>(null);
  const [pendingLogById, setPendingLogById] = useState<Record<string, boolean>>(
    {},
  );
  const [queuedLogTaskIntentById, setQueuedLogTaskIntentById] = useState<
    Record<string, string>
  >({});
  const [activeLogTaskSyncById, setActiveLogTaskSyncById] = useState<
    Record<string, boolean>
  >({});
  const [logTaskRollbackById, setLogTaskRollbackById] = useState<
    Partial<Record<string, TaskTimeLog>>
  >({});

  const [isAddLogModalOpen, setIsAddLogModalOpen] = useState(false);
  const [newLogTaskId, setNewLogTaskId] = useState("");
  const [isTaskPickerModalOpen, setIsTaskPickerModalOpen] = useState(false);
  const [taskPickerLogId, setTaskPickerLogId] = useState<string | null>(null);
  const [taskPickerTaskId, setTaskPickerTaskId] = useState("");
  const [deleteLogId, setDeleteLogId] = useState<string | null>(null);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editStartedAt, setEditStartedAt] = useState("");
  const [editEndedAt, setEditEndedAt] = useState("");

  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const pendingLogByIdRef = useRef(pendingLogById);
  const queuedLogTaskIntentByIdRef = useRef(queuedLogTaskIntentById);
  const activeLogTaskSyncByIdRef = useRef(activeLogTaskSyncById);
  const logTaskRollbackByIdRef = useRef(logTaskRollbackById);

  const taskTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of projectTasks) map.set(task.id, task.title);
    return map;
  }, [projectTasks]);

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

  const myLogsQueryKey = projectTimeKeys.myLogs(
    projectId,
    actorKey,
    MY_LOGS_PAGE,
    MY_LOGS_LIMIT,
  );

  const invalidateMyLogs = () =>
    queryClient.invalidateQueries({
      queryKey: projectTimeKeys.myLogs(
        projectId,
        actorKey,
        MY_LOGS_PAGE,
        MY_LOGS_LIMIT,
      ),
    });

  const invalidateOwnRate = () =>
    queryClient.invalidateQueries({
      queryKey: projectTimeKeys.myRate(projectId, actorKey),
    });

  const invalidateTasks = () =>
    queryClient.invalidateQueries({
      queryKey: projectTimeKeys.tasks(projectId, actorKey),
    });

  const getCachedLogs = useCallback(
    () => queryClient.getQueryData<TaskTimeLog[]>(myLogsQueryKey) ?? [],
    [myLogsQueryKey, queryClient],
  );

  const setCachedLogs = useCallback(
    (updater: (logs: TaskTimeLog[]) => TaskTimeLog[]) => {
      queryClient.setQueryData<TaskTimeLog[]>(myLogsQueryKey, (current) => {
        const safeCurrent = current ?? [];
        return updater(safeCurrent);
      });
    },
    [myLogsQueryKey, queryClient],
  );

  const setLogPending = useCallback((logId: string, pending: boolean) => {
    setPendingLogById((prev) => {
      const next = pending ? { ...prev, [logId]: true } : clearRecordKey(prev, logId);
      pendingLogByIdRef.current = next;
      return next;
    });
  }, []);

  const totalHoursWorked = useMemo(() => {
    return myLogs.reduce((sum, log) => {
      const seconds = log.duration_seconds ?? 0;
      return sum + seconds / 3600;
    }, 0);
  }, [myLogs]);

  const totalWorkAmount = useMemo(() => {
    if (!ownRate) return 0;
    const hourlyRate = Number(ownRate.hourly_rate);
    if (!Number.isFinite(hourlyRate)) return 0;
    return totalHoursWorked * hourlyRate;
  }, [ownRate, totalHoursWorked]);

  const formattedTotalWork = useMemo(() => {
    const currency = ownRate?.currency || "USD";
    return `${totalWorkAmount.toFixed(2)} ${currency}`;
  }, [ownRate?.currency, totalWorkAmount]);

  const approvedAmount = useMemo(() => {
    if (!ownRate) return 0;
    const hourlyRate = Number(ownRate.hourly_rate);
    if (!Number.isFinite(hourlyRate)) return 0;

    return myLogs.reduce((sum, log) => {
      if (log.status !== "approved") return sum;
      const seconds = log.duration_seconds ?? 0;
      const hours = seconds / 3600;
      return sum + hours * hourlyRate;
    }, 0);
  }, [myLogs, ownRate]);

  const rejectedAmount = useMemo(() => {
    if (!ownRate) return 0;
    const hourlyRate = Number(ownRate.hourly_rate);
    if (!Number.isFinite(hourlyRate)) return 0;

    return myLogs.reduce((sum, log) => {
      if (log.status !== "rejected") return sum;
      const seconds = log.duration_seconds ?? 0;
      const hours = seconds / 3600;
      return sum + hours * hourlyRate;
    }, 0);
  }, [myLogs, ownRate]);

  const formattedApprovedAmount = useMemo(() => {
    const currency = ownRate?.currency || "USD";
    return `${approvedAmount.toFixed(2)} ${currency}`;
  }, [approvedAmount, ownRate?.currency]);

  const formattedRejectedAmount = useMemo(() => {
    const currency = ownRate?.currency || "USD";
    return `${rejectedAmount.toFixed(2)} ${currency}`;
  }, [rejectedAmount, ownRate?.currency]);

  const hasRunningLog = useMemo(
    () => myLogs.some((log) => !log.ended_at),
    [myLogs],
  );

  const isMemberLockedLog = useCallback(
    (log: TaskTimeLog | null | undefined) =>
      Boolean(log && (log.status === "approved" || log.status === "rejected")),
    [],
  );

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

  useEffect(() => {
    pendingLogByIdRef.current = pendingLogById;
  }, [pendingLogById]);

  useEffect(() => {
    queuedLogTaskIntentByIdRef.current = queuedLogTaskIntentById;
  }, [queuedLogTaskIntentById]);

  useEffect(() => {
    activeLogTaskSyncByIdRef.current = activeLogTaskSyncById;
  }, [activeLogTaskSyncById]);

  useEffect(() => {
    logTaskRollbackByIdRef.current = logTaskRollbackById;
  }, [logTaskRollbackById]);

  const updateScrollButtons = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) {
      setCanScrollUp(false);
      setCanScrollDown(false);
      return;
    }

    const threshold = 2;
    const isAtTop = el.scrollTop <= threshold;
    const isAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;

    setCanScrollUp(!isAtTop);
    setCanScrollDown(!isAtBottom);
  }, []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const handleScroll = () => updateScrollButtons();
    updateScrollButtons();
    el.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);

    return () => {
      el.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [updateScrollButtons, myLogs.length, showMyLogsTabSkeleton]);

  const scrollToTop = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  const beginEditLog = (log: TaskTimeLog) => {
    if (hasRunningLog) {
      setError("Stop the running timer before editing logs.");
      return;
    }
    if (isMemberLockedLog(log)) {
      setError("Approved and rejected logs are read-only.");
      return;
    }
    setEditingLogId(log.id);
    setEditStartedAt(toLocalDateTimeInput(log.started_at));
    setEditEndedAt(toLocalDateTimeInput(log.ended_at));
  };

  const closeEditLogModal = () => {
    setEditingLogId(null);
    setEditStartedAt("");
    setEditEndedAt("");
  };

  const enqueueTaskChange = useCallback(
    (logId: string, nextTaskId: string) => {
      const currentLog = findLogById(getCachedLogs(), logId);
      if (!currentLog) return;
      if (isMemberLockedLog(currentLog)) {
        setError("Approved and rejected logs are read-only.");
        toast.error("Approved and rejected logs are read-only.");
        return;
      }

      const runtime = {
        getLog: (id: string) => findLogById(getCachedLogs(), id),
        isActive: (id: string) => Boolean(activeLogTaskSyncByIdRef.current[id]),
        setActive: (id: string, value: boolean) => {
          setActiveLogTaskSyncById((prev) => {
            const next = value
              ? { ...prev, [id]: true }
              : clearRecordKey(prev, id);
            activeLogTaskSyncByIdRef.current = next;
            return next;
          });
        },
        getQueuedIntent: (id: string) => queuedLogTaskIntentByIdRef.current[id],
        setQueuedIntent: (id: string, taskId: string) => {
          setQueuedLogTaskIntentById((prev) => {
            const next = { ...prev, [id]: taskId };
            queuedLogTaskIntentByIdRef.current = next;
            return next;
          });
        },
        clearQueuedIntent: (id: string) => {
          setQueuedLogTaskIntentById((prev) => {
            const next = clearRecordKey(prev, id);
            queuedLogTaskIntentByIdRef.current = next;
            return next;
          });
        },
        getRollbackLog: (id: string) => logTaskRollbackByIdRef.current[id],
        setRollbackLog: (id: string, log: TaskTimeLog) => {
          setLogTaskRollbackById((prev) => {
            const next = { ...prev, [id]: log };
            logTaskRollbackByIdRef.current = next;
            return next;
          });
        },
        clearRollbackLog: (id: string) => {
          setLogTaskRollbackById((prev) => {
            const next = clearLogRollbackKey(prev, id);
            logTaskRollbackByIdRef.current = next;
            return next;
          });
        },
        applyOptimisticTask: (id: string, taskId: string) => {
          setCachedLogs((logs) =>
            patchLogById(logs, id, (log) => ({
              ...log,
              task_id: taskId,
              task: {
                id: taskId,
                title: taskTitleById.get(taskId) ?? log.task?.title ?? "Task",
              },
              updated_at: new Date().toISOString(),
            })),
          );
        },
        applyServerLog: (
          id: string,
          serverLog: TaskTimeLog,
          options: { preserveOptimisticTask: boolean },
        ) => {
          setCachedLogs((logs) =>
            patchLogById(logs, id, (log) => {
              const merged = { ...log, ...serverLog };
              if (!options.preserveOptimisticTask) return merged;
              return {
                ...merged,
                task_id: log.task_id,
                task: log.task,
              };
            }),
          );
        },
        rollbackLog: (id: string, rollbackLog: TaskTimeLog) => {
          setCachedLogs((logs) => patchLogById(logs, id, () => rollbackLog));
        },
        sendTaskUpdate: async (id: string, taskId: string) =>
          projectTimeService.update(id, { task_id: taskId }),
      };

      void enqueueLogTaskIntent(runtime, logId, nextTaskId)
        .catch((e) => {
          setError(getErrorMessage(e, "Failed to update task."));
          toast.error("Failed to update task.");
        })
        .finally(() => {
          void invalidateMyLogs();
        });
    },
    [
      getCachedLogs,
      invalidateMyLogs,
      isMemberLockedLog,
      setCachedLogs,
      taskTitleById,
      toast,
    ],
  );

  const saveEditedLog = async () => {
    if (!editingLogId) return;
    if (hasRunningLog) {
      setError("Stop the running timer before editing logs.");
      closeEditLogModal();
      return;
    }

    const logId = editingLogId;
    const started_at = fromLocalDateTimeInput(editStartedAt);
    const ended_at = fromLocalDateTimeInput(editEndedAt);
    if (!started_at) {
      setError("Time-in is required.");
      return;
    }

    const rollbackLog = findLogById(getCachedLogs(), logId);
    if (!rollbackLog) return;
    if (isMemberLockedLog(rollbackLog)) {
      closeEditLogModal();
      setError("Approved and rejected logs are read-only.");
      return;
    }

    closeEditLogModal();
    setError(null);
    setLogPending(logId, true);
    setCachedLogs((logs) =>
      patchLogById(logs, logId, (log) => ({
        ...log,
        started_at,
        ended_at: ended_at ?? null,
        updated_at: new Date().toISOString(),
      })),
    );

    try {
      const updated = await projectTimeService.update(logId, {
        started_at,
        ...(ended_at ? { ended_at } : {}),
      });
      setCachedLogs((logs) => patchLogById(logs, logId, () => updated));
    } catch (e) {
      setCachedLogs((logs) => patchLogById(logs, logId, () => rollbackLog));
      setError(getErrorMessage(e, "Failed to update time log."));
      toast.error("Failed to update time log.");
    } finally {
      setLogPending(logId, false);
      void invalidateMyLogs();
    }
  };

  const stopLog = async (logId: string) => {
    if (pendingLogByIdRef.current[logId]) return;
    const rollbackLog = findLogById(getCachedLogs(), logId);
    if (!rollbackLog) return;

    const nowIso = new Date().toISOString();
    const startedMs = new Date(rollbackLog.started_at).getTime();
    const nowMs = new Date(nowIso).getTime();
    const durationSeconds =
      Number.isFinite(startedMs) && Number.isFinite(nowMs) && nowMs > startedMs
        ? Math.floor((nowMs - startedMs) / 1000)
        : rollbackLog.duration_seconds;

    setError(null);
    setLogPending(logId, true);
    setCachedLogs((logs) =>
      patchLogById(logs, logId, (log) => ({
        ...log,
        ended_at: nowIso,
        duration_seconds: durationSeconds ?? null,
        updated_at: nowIso,
      })),
    );

    try {
      const stopped = await projectTimeService.stop(logId);
      setCachedLogs((logs) => patchLogById(logs, logId, () => stopped));
    } catch (e) {
      setCachedLogs((logs) => patchLogById(logs, logId, () => rollbackLog));
      setError(getErrorMessage(e, "Failed to stop timer."));
      toast.error("Failed to stop timer.");
    } finally {
      setLogPending(logId, false);
      void invalidateMyLogs();
    }
  };

  const deleteLog = async (logId: string) => {
    if (pendingLogByIdRef.current[logId]) return;

    const removal = removeLogById(getCachedLogs(), logId);
    if (!removal) return;
    if (isMemberLockedLog(removal.removedLog)) {
      setError("Approved and rejected logs are read-only.");
      toast.error("Approved and rejected logs are read-only.");
      return;
    }

    setError(null);
    setLogPending(logId, true);
    setCachedLogs(() => removal.logs);

    try {
      await projectTimeService.delete(logId);
    } catch (e) {
      setCachedLogs((logs) =>
        restoreLogAtIndex(logs, removal.removedLog, removal.removedIndex),
      );
      setError(getErrorMessage(e, "Failed to delete time log."));
      toast.error("Failed to delete time log.");
    } finally {
      setLogPending(logId, false);
      void invalidateMyLogs();
      setDeleteLogId((current) => (current === logId ? null : current));
    }
  };

  const requestDeleteLog = useCallback((logId: string) => {
    const log = findLogById(getCachedLogs(), logId);
    if (isMemberLockedLog(log)) {
      setError("Approved and rejected logs are read-only.");
      return;
    }
    setDeleteLogId(logId);
  }, [getCachedLogs, isMemberLockedLog]);

  const closeDeleteLogModal = useCallback(() => {
    if (deleteLogId && pendingLogByIdRef.current[deleteLogId]) return;
    setDeleteLogId(null);
  }, [deleteLogId]);

  const confirmDeleteLog = useCallback(async () => {
    if (!deleteLogId) return;
    await deleteLog(deleteLogId);
  }, [deleteLogId]);

  const createLogFromModal = async () => {
    if (!newLogTaskId) {
      setError("Select a task.");
      return;
    }

    const taskId = newLogTaskId;
    const tempId = createTempId("tmp-log");
    const nowIso = new Date().toISOString();
    const tempLog: TaskTimeLog = {
      id: tempId,
      project_id: projectId,
      task_id: taskId,
      member_user_id: actorKey,
      started_at: nowIso,
      ended_at: null,
      duration_seconds: null,
      status: "pending",
      reviewed_by: null,
      reviewed_at: null,
      review_note: null,
      source: "timer",
      created_at: nowIso,
      updated_at: nowIso,
      task: {
        id: taskId,
        title: taskTitleById.get(taskId) ?? "Task",
      },
    };

    setIsAddLogModalOpen(false);
    setNewLogTaskId("");
    setError(null);
    setLogPending(tempId, true);
    setCachedLogs((logs) => prependLog(logs, tempLog));

    try {
      const created = await projectTimeService.start(projectId, taskId);
      setCachedLogs((logs) => replaceLogByTempId(logs, tempId, created));
    } catch (e) {
      setCachedLogs((logs) => logs.filter((log) => log.id !== tempId));
      setError(getErrorMessage(e, "Failed to add log."));
      toast.error("Failed to add log.");
    } finally {
      setLogPending(tempId, false);
      await Promise.all([invalidateMyLogs(), invalidateOwnRate(), invalidateTasks()]);
    }
  };

  const openTaskPickerModal = useCallback((log: TaskTimeLog) => {
    if (isMemberLockedLog(log)) {
      setError("Approved and rejected logs are read-only.");
      return;
    }
    setTaskPickerLogId(log.id);
    setTaskPickerTaskId(log.task_id);
    setIsTaskPickerModalOpen(true);
  }, [isMemberLockedLog]);

  const closeTaskPickerModal = useCallback(() => {
    setIsTaskPickerModalOpen(false);
    setTaskPickerLogId(null);
    setTaskPickerTaskId("");
  }, []);

  const saveTaskPickerModal = useCallback(async () => {
    if (!taskPickerLogId || !taskPickerTaskId) return;
    const currentLog = findLogById(getCachedLogs(), taskPickerLogId);
    if (!currentLog) {
      closeTaskPickerModal();
      return;
    }
    if (isMemberLockedLog(currentLog)) {
      closeTaskPickerModal();
      setError("Approved and rejected logs are read-only.");
      return;
    }
    if (currentLog.task_id === taskPickerTaskId) {
      closeTaskPickerModal();
      return;
    }

    setError(null);
    enqueueTaskChange(taskPickerLogId, taskPickerTaskId);
    closeTaskPickerModal();
  }, [
    closeTaskPickerModal,
    enqueueTaskChange,
    getCachedLogs,
    isMemberLockedLog,
    taskPickerLogId,
    taskPickerTaskId,
  ]);

  const rowPendingById = useMemo(() => pendingLogById, [pendingLogById]);
  const taskSyncById = useMemo(() => activeLogTaskSyncById, [activeLogTaskSyncById]);
  const savingAddLog = false;
  const savingLogEdit = editingLogId ? Boolean(pendingLogById[editingLogId]) : false;

  useEffect(() => {
    if (!hasRunningLog || editingLogId === null) return;
    closeEditLogModal();
    setError("Stop the running timer before editing logs.");
  }, [hasRunningLog, editingLogId]);

  return (
    <div ref={scrollContainerRef} className="h-full w-full overflow-y-auto">
      <TimeRouteFrame
        projectId={projectId}
        activeTab="my_logs"
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
        ) : shouldBlockPage ? (
          <div className="app-surface-card rounded-2xl border-dashed p-12 text-center">
            <p className="text-sm font-semibold text-slate-800">Time tracking is not enabled.</p>
            <p className="mt-1 text-sm text-slate-500">
              Ask a manager to add your hourly rate before using the Time page.
            </p>
          </div>
        ) : (
          <>
            {showMyLogsTabSkeleton && (
              <div className="rounded-xl border border-slate-200 overflow-hidden bg-white animate-pulse">
                <div className="h-10 border-b border-slate-200 bg-slate-100" />
                <div className="p-3 space-y-2">
                  {Array.from({ length: 7 }).map((_, idx) => (
                    <div key={idx} className="h-8 rounded bg-slate-100" />
                  ))}
                </div>
              </div>
            )}

            {canShowMyLogsTab ? (
              <div className="grid grid-cols-1 xl:grid-cols-10 gap-4 items-start">
                <div className="xl:col-span-7 min-w-0">
                  <MyLogsGrid
                    logs={myLogs}
                    tasks={projectTasks}
                    ownRate={ownRate}
                    loadingLogs={loadingMyLogs}
                    loadingTasks={loadingProjectTasks}
                    taskSyncById={taskSyncById}
                    rowPendingById={rowPendingById}
                    onOpenTaskModal={openTaskPickerModal}
                    onStopLog={stopLog}
                    onDeleteLog={requestDeleteLog}
                    onEditLog={beginEditLog}
                    onOpenTaskInRoadmap={openTaskInRoadmap}
                    canOpenTaskInRoadmap={canOpenTaskInRoadmap}
                    onOpenAddLog={() => setIsAddLogModalOpen(true)}
                  />
                </div>

                <aside className="xl:col-span-3 xl:sticky xl:top-6">
                  <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                    <div className="border-b border-slate-200 bg-slate-900 px-4 py-3">
                      <h3 className="text-sm font-semibold text-white">
                        Project Member Time Rate
                      </h3>
                    </div>

                    <div className="p-4 space-y-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-500">Employee ID</span>
                        <span className="font-semibold text-slate-700">
                          {ownRate?.custom_id || ownRate?.member_user_id || "-"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-500">Start Date</span>
                        <span className="text-right">{formatRateDate(ownRate?.start_date)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-500">End Date</span>
                        <span className="text-right">{formatRateDate(ownRate?.end_date)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-500">Hourly Rate</span>
                        <span className="font-semibold">
                          {ownRate
                            ? `${Number(ownRate.hourly_rate).toFixed(2)} ${ownRate.currency}`
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
                              <th className="px-2 py-1 text-left border-b border-slate-200">
                                Approved
                              </th>
                              <th className="px-2 py-1 text-left border-b border-slate-200">
                                Rejected
                              </th>
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
            ) : !showMyLogsTabSkeleton ? (
              <div className="app-surface-card rounded-2xl border-dashed p-12 text-center">
                <p className="text-sm font-semibold text-slate-800">
                  Your personal logs are not available.
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Use Team Logs to review member entries and rates.
                </p>
              </div>
            ) : null}
          </>
        )}

        <EditLogModal
          isOpen={editingLogId !== null}
          startedAt={editStartedAt}
          endedAt={editEndedAt}
          saving={savingLogEdit}
          onClose={closeEditLogModal}
          onSave={saveEditedLog}
          onChangeStartedAt={setEditStartedAt}
          onChangeEndedAt={setEditEndedAt}
        />

        <AddLogModal
          isOpen={isAddLogModalOpen}
          tasks={projectTasks}
          selectedTaskId={newLogTaskId}
          saving={savingAddLog}
          onClose={() => {
            setIsAddLogModalOpen(false);
            setNewLogTaskId("");
          }}
          onSave={createLogFromModal}
          onChangeTaskId={setNewLogTaskId}
        />

        <AddLogModal
          isOpen={isTaskPickerModalOpen}
          tasks={projectTasks}
          selectedTaskId={taskPickerTaskId}
          saving={Boolean(taskPickerLogId && pendingLogById[taskPickerLogId])}
          title="Update Task"
          description="Choose a task for this time log."
          saveLabel="Save Task"
          onClose={closeTaskPickerModal}
          onSave={saveTaskPickerModal}
          onChangeTaskId={setTaskPickerTaskId}
        />

        <DeleteTimeLogModal
          isOpen={deleteLogId !== null}
          deleting={Boolean(deleteLogId && pendingLogById[deleteLogId])}
          taskLabel={
            deleteLogId
              ? findLogById(myLogs, deleteLogId)?.task?.title ??
                taskTitleById.get(findLogById(myLogs, deleteLogId)?.task_id ?? "")
              : undefined
          }
          onClose={closeDeleteLogModal}
          onConfirm={confirmDeleteLog}
        />
      </TimeRouteFrame>

      {(canScrollUp || canScrollDown) && (
        <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-1.5">
          <div className="h-7 w-7">
            {canScrollUp && (
              <button
                type="button"
                onClick={scrollToTop}
                aria-label="Scroll to top"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-white shadow-md transition-colors hover:bg-slate-700"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="h-7 w-7">
            {canScrollDown && (
              <button
                type="button"
                onClick={scrollToBottom}
                aria-label="Scroll to bottom"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-white shadow-md transition-colors hover:bg-slate-700"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

