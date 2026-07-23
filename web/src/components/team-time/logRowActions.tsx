import {
	Check,
	Coins,
	Eye,
	ExternalLink,
	Pencil,
	RotateCcw,
	Square,
	Trash2,
	X,
} from "lucide-react";
import type { TaskTimeLog } from "@/services/team-time.service";
import type { ActionMenuItem } from "./RowActionsMenu";
import type { ReviewOnlyDecision } from "./TeamApprovalsInbox";

/** A reviewed log (approved/rejected) is read-only for its owner. */
function isMemberReadOnlyStatus(status: TaskTimeLog["status"]): boolean {
	return status === "approved" || status === "rejected";
}

/**
 * Builds the "⋯" action-menu items for one log row: review/pay actions when
 * the log is eligible (ended, not the caller's own, review handlers given),
 * plus "Open task in roadmap" always. Shared by TeamApprovalsInbox's
 * drilldown table and the calendar's DayLogsModal so both surfaces offer
 * identical actions for the same log.
 */
export function buildLogRowActions({
	log,
	eligible,
	isSelf,
	memberId,
	currency,
	onReviewLogs,
	onPayMember,
	onOpenTaskInRoadmap,
	canOpenTaskInRoadmap,
	onViewTaskDetails,
}: {
	log: TaskTimeLog;
	eligible: boolean;
	isSelf: boolean;
	memberId: string;
	currency: string;
	onReviewLogs?: (
		logIds: string[],
		decision: ReviewOnlyDecision,
	) => void | Promise<void>;
	onPayMember?: (memberId: string, logIds: string[], currency: string) => void;
	onOpenTaskInRoadmap: (log: TaskTimeLog) => void;
	canOpenTaskInRoadmap: (taskId: string | null) => boolean;
	onViewTaskDetails?: (log: TaskTimeLog) => void;
}): ActionMenuItem[] {
	const items: ActionMenuItem[] = [];
	if (eligible && !isSelf && onReviewLogs) {
		if (log.status === "pending") {
			items.push(
				{
					id: "approve",
					label: "Approve",
					icon: <Check className="h-3.5 w-3.5" />,
					onSelect: () => void onReviewLogs([log.id], "approved"),
					tone: "success",
				},
				{
					id: "reject",
					label: "Reject",
					icon: <X className="h-3.5 w-3.5" />,
					onSelect: () => void onReviewLogs([log.id], "rejected"),
					tone: "warning",
				},
			);
		} else if (log.status === "approved") {
			items.push(
				{
					id: "pay",
					label: "Pay this log",
					icon: <Coins className="h-3.5 w-3.5" />,
					onSelect: () => onPayMember?.(memberId, [log.id], currency),
					tone: "info",
					disabled: !onPayMember,
				},
				{
					id: "reject",
					label: "Reject",
					icon: <X className="h-3.5 w-3.5" />,
					onSelect: () => void onReviewLogs([log.id], "rejected"),
					tone: "warning",
				},
				{
					id: "pending",
					label: "Set pending",
					icon: <RotateCcw className="h-3.5 w-3.5" />,
					onSelect: () => void onReviewLogs([log.id], "pending"),
				},
			);
		} else if (log.status === "rejected") {
			items.push({
				id: "pending",
				label: "Set pending",
				icon: <RotateCcw className="h-3.5 w-3.5" />,
				onSelect: () => void onReviewLogs([log.id], "pending"),
			});
		}
	}
	if (onViewTaskDetails && log.task_id) {
		items.push({
			id: "view-task",
			label: "View task details",
			icon: <Eye className="h-3.5 w-3.5" />,
			onSelect: () => onViewTaskDetails(log),
		});
	}
	items.push({
		id: "open-roadmap",
		label: "Open task in roadmap",
		icon: <ExternalLink className="h-3.5 w-3.5" />,
		onSelect: () => onOpenTaskInRoadmap(log),
		disabled: !canOpenTaskInRoadmap(log.task_id),
	});
	return items;
}

/**
 * Builds the "⋯" action-menu items a MEMBER gets on their own log row: Stop
 * (running only), Change task, Edit, Delete, Open-in-roadmap. Mirrors the
 * list view's row menu (TeamMyLogsList) exactly — same items, same disable
 * rules — so My Logs → Calendar offers identical member actions to the list.
 * (Approved/rejected logs are read-only; edit is blocked while another timer
 * is running.)
 */
export function buildMemberLogRowActions({
	log,
	isRowPending,
	loadingTasks,
	hasActiveLog,
	onStopLog,
	onChangeTask,
	onEditLog,
	onDeleteLog,
	onOpenTaskInRoadmap,
	canOpenTaskInRoadmap,
	onViewTaskDetails,
}: {
	log: TaskTimeLog;
	isRowPending: boolean;
	loadingTasks: boolean;
	hasActiveLog: boolean;
	onStopLog: (log: TaskTimeLog) => void | Promise<void>;
	onChangeTask: (log: TaskTimeLog) => void;
	onEditLog: (log: TaskTimeLog) => void;
	onDeleteLog: (log: TaskTimeLog) => void | Promise<void>;
	onOpenTaskInRoadmap: (log: TaskTimeLog) => void;
	canOpenTaskInRoadmap: (taskId: string | null) => boolean;
	onViewTaskDetails?: (log: TaskTimeLog) => void;
}): ActionMenuItem[] {
	const isRunning = !log.ended_at;
	const isReadOnly = isMemberReadOnlyStatus(log.status);
	const items: ActionMenuItem[] = [];
	if (isRunning) {
		items.push({
			id: "stop",
			label: "Stop timer",
			icon: <Square className="h-3.5 w-3.5" />,
			onSelect: () => void onStopLog(log),
			disabled: isRowPending,
		});
	}
	items.push(
		{
			id: "change-task",
			label: "Change task",
			icon: <Pencil className="h-3.5 w-3.5" />,
			onSelect: () => onChangeTask(log),
			disabled: isRowPending || loadingTasks || isReadOnly,
		},
		{
			id: "edit",
			label: "Edit log",
			icon: <Pencil className="h-3.5 w-3.5" />,
			onSelect: () => onEditLog(log),
			disabled: isRowPending || hasActiveLog || isReadOnly,
		},
		{
			id: "delete",
			label: "Delete log",
			icon: <Trash2 className="h-3.5 w-3.5" />,
			onSelect: () => void onDeleteLog(log),
			disabled: isRowPending || isReadOnly,
			tone: "danger",
		},
	);
	if (onViewTaskDetails && log.task_id) {
		items.push({
			id: "view-task",
			label: "View task details",
			icon: <Eye className="h-3.5 w-3.5" />,
			onSelect: () => onViewTaskDetails(log),
		});
	}
	items.push({
		id: "open-roadmap",
		label: "Open task in roadmap",
		icon: <ExternalLink className="h-3.5 w-3.5" />,
		onSelect: () => onOpenTaskInRoadmap(log),
		disabled: isRowPending || !canOpenTaskInRoadmap(log.task_id),
	});
	return items;
}
