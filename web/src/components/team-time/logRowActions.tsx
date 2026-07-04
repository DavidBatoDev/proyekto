import { Check, Coins, ExternalLink, RotateCcw, X } from "lucide-react";
import type { TaskTimeLog } from "@/services/team-time.service";
import type { ActionMenuItem } from "./RowActionsMenu";
import type { ReviewOnlyDecision } from "./TeamApprovalsInbox";

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
	items.push({
		id: "open-roadmap",
		label: "Open task in roadmap",
		icon: <ExternalLink className="h-3.5 w-3.5" />,
		onSelect: () => onOpenTaskInRoadmap(log),
		disabled: !canOpenTaskInRoadmap(log.task_id),
	});
	return items;
}
