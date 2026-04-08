import { memo, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Square, Trash2 } from "lucide-react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type {
  ProjectMemberTimeRate,
  ProjectTaskOption,
  TaskTimeLog,
} from "@/services/project-time.service";
import { liveDurationSecondsFromLog } from "./time-utils";

type MyLogGridRow = {
  id: string;
  is_placeholder?: boolean;
  placeholder_index?: number;
  date: string;
  task_id: string;
  time_in: string;
  is_running: boolean;
  log: TaskTimeLog;
};

interface TaskPickerCellProps {
  value: string;
  taskTitle: string;
  loadingTasks: boolean;
  taskSyncing: boolean;
  disabled?: boolean;
  onOpenTaskModal: () => void;
}

const TaskPickerCell = memo(function TaskPickerCell({
  value,
  taskTitle,
  loadingTasks,
  taskSyncing,
  disabled = false,
  onOpenTaskModal,
}: TaskPickerCellProps) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onOpenTaskModal}
        disabled={loadingTasks || disabled}
        className="w-full rounded-md border border-gray-300 bg-white px-2 py-0.5 text-[11px] leading-tight text-left text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        title={taskTitle}
      >
        <span className="truncate block">{taskTitle || value || "Select task"}</span>
      </button>
      {taskSyncing && (
        <Loader2
          className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-700"
          aria-label="Task update syncing"
        />
      )}
    </div>
  );
});

function MyLogsGridSkeleton() {
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden bg-white animate-pulse">
      <div className="h-10 border-b border-gray-200 bg-gray-100" />
      <div className="p-3 space-y-2">
        {Array.from({ length: 7 }).map((_, idx) => (
          <div key={idx} className="h-8 rounded bg-gray-100" />
        ))}
      </div>
    </div>
  );
}

interface MyLogsGridProps {
  logs: TaskTimeLog[];
  tasks: ProjectTaskOption[];
  ownRate: ProjectMemberTimeRate | null;
  loadingLogs: boolean;
  loadingTasks: boolean;
  taskSyncById: Record<string, boolean>;
  rowPendingById: Record<string, boolean>;
  onOpenTaskModal: (log: TaskTimeLog) => void;
  onStopLog: (logId: string) => void | Promise<void>;
  onDeleteLog: (logId: string) => void | Promise<void>;
  onEditLog: (log: TaskTimeLog) => void;
  onOpenAddLog: () => void;
}

export function MyLogsGrid({
  logs,
  tasks,
  ownRate,
  loadingLogs,
  loadingTasks,
  taskSyncById,
  rowPendingById,
  onOpenTaskModal,
  onStopLog,
  onDeleteLog,
  onEditLog,
  onOpenAddLog,
}: MyLogsGridProps) {
  const [liveNowMs, setLiveNowMs] = useState(Date.now());

  const hasActiveLog = useMemo(
    () => logs.some((log) => !log.ended_at),
    [logs],
  );

  useEffect(() => {
    if (!hasActiveLog) return;
    const interval = window.setInterval(() => setLiveNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [hasActiveLog]);

  const fullDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    [],
  );

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    [],
  );
  const shortDateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    [],
  );

  const rows = useMemo<MyLogGridRow[]>(() => {
    const sortedLogs = [...logs].sort((a, b) => {
      const aMs = new Date(a.started_at).getTime();
      const bMs = new Date(b.started_at).getTime();
      return aMs - bMs;
    });
    const populatedRows = sortedLogs.map((log) => {
      const startedDate = new Date(log.started_at);
      const hasValidStart = !Number.isNaN(startedDate.getTime());

      return {
        id: log.id,
        date: !hasValidStart ? "-" : fullDateFormatter.format(startedDate),
        task_id: log.task_id,
        time_in: !hasValidStart
          ? "-"
          : timeFormatter.format(startedDate),
        is_running: !log.ended_at,
        log,
      };
    });
    const minimumRows = Math.max(4, populatedRows.length + 1);
    if (populatedRows.length >= minimumRows) return populatedRows;
    const emptyCount = minimumRows - populatedRows.length;
    const emptyRows: MyLogGridRow[] = Array.from({ length: emptyCount }).map(
      (_, idx) => ({
        id: `empty-${idx}`,
        is_placeholder: true,
        placeholder_index: idx,
        date: "",
        task_id: "",
        time_in: "",
        is_running: false,
        log: null as unknown as TaskTimeLog,
      }),
    );
    return [...populatedRows, ...emptyRows];
  }, [
    fullDateFormatter,
    logs,
    shortDateTimeFormatter,
    timeFormatter,
  ]);

  const formatTimeOut = useMemo(
    () => (log: TaskTimeLog) => {
      const endedDate = log.ended_at ? new Date(log.ended_at) : null;
      const nowDate = new Date(liveNowMs);
      const startedDate = new Date(log.started_at);
      const hasValidStart = !Number.isNaN(startedDate.getTime());
      const hasValidEnd = Boolean(endedDate && !Number.isNaN(endedDate.getTime()));
      const hasValidNow = !Number.isNaN(nowDate.getTime());
      const endedDateValue: Date | undefined = hasValidEnd
        ? (endedDate as Date)
        : undefined;
      const isMultiDay =
        hasValidStart &&
        hasValidEnd &&
        startedDate.toDateString() !== endedDateValue?.toDateString();

      if (hasValidEnd) {
        return isMultiDay
          ? shortDateTimeFormatter.format(endedDateValue)
          : timeFormatter.format(endedDateValue);
      }
      if (!hasValidNow) return "-";
      if (hasValidStart && startedDate.toDateString() !== nowDate.toDateString()) {
        return shortDateTimeFormatter.format(nowDate);
      }
      return timeFormatter.format(nowDate);
    },
    [liveNowMs, shortDateTimeFormatter, timeFormatter],
  );

  const getHoursWorked = useMemo(
    () => (log: TaskTimeLog) =>
      Number((liveDurationSecondsFromLog(log, liveNowMs) / 3600).toFixed(2)),
    [liveNowMs],
  );

  const getFees = useMemo(
    () => (log: TaskTimeLog) => {
      const hourlyRate = ownRate ? Number(ownRate.hourly_rate) : null;
      const hoursWorked = getHoursWorked(log);
      if (hourlyRate === null || !Number.isFinite(hourlyRate)) return null;
      return Number((hoursWorked * hourlyRate).toFixed(2));
    },
    [getHoursWorked, ownRate],
  );

  const taskTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of tasks) {
      map.set(task.id, task.title || "Untitled task");
    }
    return map;
  }, [tasks]);

  const columnHelper = createColumnHelper<MyLogGridRow>();
  const columns = useMemo(
    () => [
      columnHelper.accessor("date", {
        id: "date",
        header: "Dates",
        cell: (info) =>
          info.row.original.is_placeholder ? null : info.getValue(),
      }),
      columnHelper.accessor("task_id", {
        id: "task_id",
        header: "Task",
        cell: (info) => {
          const row = info.row.original;
          if (row.is_placeholder) return null;
          return (
            <TaskPickerCell
              value={row.task_id}
              taskTitle={row.log.task?.title || taskTitleById.get(row.task_id) || "Task"}
              loadingTasks={loadingTasks}
              taskSyncing={Boolean(taskSyncById[row.id])}
              disabled={Boolean(rowPendingById[row.id])}
              onOpenTaskModal={() => onOpenTaskModal(row.log)}
            />
          );
        },
      }),
      columnHelper.accessor("time_in", {
        id: "time_in",
        header: "Time-in",
        cell: (info) =>
          info.row.original.is_placeholder ? null : (
            <span className="tabular-nums">{info.getValue()}</span>
          ),
      }),
      columnHelper.display({
        id: "time_out",
        header: "Time-Out",
        cell: (info) =>
          info.row.original.is_placeholder ? null : (
            <span className="tabular-nums">{formatTimeOut(info.row.original.log)}</span>
          ),
      }),
      columnHelper.display({
        id: "hours_worked",
        header: "Hours",
        cell: (info) => {
          const row = info.row.original;
          if (row.is_placeholder) return null;
          return (
            <span className="text-xs font-semibold text-gray-700">
              {getHoursWorked(row.log).toFixed(2)}
            </span>
          );
        },
      }),
      columnHelper.display({
        id: "fees",
        header: "Fees",
        cell: (info) => {
          const row = info.row.original;
          if (row.is_placeholder) return null;
          const fees = getFees(row.log);
          return (
            <span className="text-xs font-semibold text-emerald-700">
              {fees === null ? "-" : `${fees.toFixed(2)} ${ownRate?.currency || "USD"}`}
            </span>
          );
        },
      }),
      columnHelper.display({
        id: "actions",
        header: "Actions",
        cell: (info) => {
          const row = info.row.original;
          if (row.is_placeholder) {
            return row.placeholder_index === 0 ? (
              <button
                type="button"
                onClick={onOpenAddLog}
                title="Add Log"
                aria-label="Add Log"
                className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            ) : null;
          }

          return (
            <div className="flex items-center gap-1">
              {row.is_running && (
                <button
                  type="button"
                  onClick={() => void onStopLog(row.id)}
                  disabled={rowPendingById[row.id]}
                  title="Stop Timer"
                  aria-label="Stop Timer"
                  className="inline-flex items-center justify-center h-7 w-8 rounded-md border border-rose-200 bg-rose-50 text-rose-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => onEditLog(row.log)}
                disabled={rowPendingById[row.id] || hasActiveLog}
                title={
                  hasActiveLog
                    ? "Stop the running timer to edit logs"
                    : "Edit Log"
                }
                aria-label="Edit Log"
                className="inline-flex items-center justify-center h-7 w-8 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void onDeleteLog(row.id)}
                disabled={rowPendingById[row.id]}
                title="Delete Log"
                aria-label="Delete Log"
                className="inline-flex items-center justify-center h-7 w-8 rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              {rowPendingById[row.id] && (
                <Loader2
                  className="h-3.5 w-3.5 shrink-0 animate-spin text-gray-500"
                  aria-label="Row pending"
                />
              )}
            </div>
          );
        },
      }),
    ],
    [
      columnHelper,
      loadingTasks,
      formatTimeOut,
      getFees,
      getHoursWorked,
      onDeleteLog,
      onEditLog,
      onOpenAddLog,
      onOpenTaskModal,
      onStopLog,
      ownRate?.currency,
      rowPendingById,
      taskTitleById,
      taskSyncById,
    ],
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (loadingLogs) return <MyLogsGridSkeleton />;
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <table className="w-full table-fixed text-[11px]">
        <colgroup>
          <col className="w-[22%]" />
          <col className="w-[21%]" />
          <col className="w-[15%]" />
          <col className="w-[15%]" />
          <col className="w-[9%]" />
          <col className="w-[9%]" />
          <col className="w-[9%]" />
        </colgroup>
        <thead className="bg-primary text-white">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="px-2 py-2.5 text-left text-sm font-bold border-r border-white/30 last:border-r-0"
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className={`border-t border-gray-200 ${
                !row.original.is_placeholder && rowPendingById[row.original.id]
                  ? "bg-amber-50/40"
                  : ""
              }`}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-2 py-1.5 align-middle">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

