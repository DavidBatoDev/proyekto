import { AlertTriangle, Check, RotateCcw, Wallet, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import type { TaskTimeLog } from "@/services/team-time.service";
import { BillableAmount } from "../BillableAmount";
import { buildLogRowActions } from "../logRowActions";
import { RowActionsMenu } from "../RowActionsMenu";
import type { ReviewOnlyDecision } from "../TeamApprovalsInbox";
import {
	formatHours,
	formatLogEnd,
	formatLogStart,
	initialsFromName,
	isUnusuallyLongLog,
	logFee,
	memberLabel,
	statusBadgeClass,
} from "../time-utils";

export interface DayLogsModalProps {
	isOpen: boolean;
	dateLabel: string;
	logs: TaskTimeLog[];
	/** The log the user actually clicked — visually highlighted on open. */
	highlightLogId?: string | null;
	/** Team mode shows a Member column and enables review/pay/bulk actions. */
	mode: "my" | "team";
	currentUserId: string | null;
	busyLogIds?: Set<string>;
	onClose: () => void;
	onReviewLogs?: (
		logIds: string[],
		decision: ReviewOnlyDecision,
	) => void | Promise<void>;
	onPayMember?: (memberId: string, logIds: string[], currency: string) => void;
	onOpenTaskInRoadmap: (log: TaskTimeLog) => void;
	canOpenTaskInRoadmap: (taskId: string | null) => boolean;
}

/**
 * Click-through detail view for a calendar day: every log logged that day,
 * with the same review/pay/open-in-roadmap actions as the list view's
 * drilldown table, plus checkbox-driven bulk actions (approve/reject/reset/
 * pay) when review handlers are supplied — mirrors TeamApprovalsInbox's
 * floating bulk bar, just inline in the modal footer instead of floating.
 */
export function DayLogsModal({
	isOpen,
	dateLabel,
	logs,
	highlightLogId,
	mode,
	currentUserId,
	busyLogIds,
	onClose,
	onReviewLogs,
	onPayMember,
	onOpenTaskInRoadmap,
	canOpenTaskInRoadmap,
}: DayLogsModalProps) {
	const toast = useToast();
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [openMenuRowId, setOpenMenuRowId] = useState<string | null>(null);

	useEffect(() => {
		if (isOpen) setSelected(new Set());
	}, [isOpen]);

	const canBulkAct = mode === "team" && Boolean(onReviewLogs);

	const isEligible = (log: TaskTimeLog) =>
		canBulkAct && Boolean(log.ended_at) && log.member_user_id !== currentUserId;

	const toggleSelect = (logId: string, checked: boolean) =>
		setSelected((prev) => {
			const next = new Set(prev);
			if (checked) next.add(logId);
			else next.delete(logId);
			return next;
		});

	const eligibleIds = logs.filter(isEligible).map((l) => l.id);
	const allSelected =
		eligibleIds.length > 0 && eligibleIds.every((id) => selected.has(id));
	const someSelected =
		eligibleIds.some((id) => selected.has(id)) && !allSelected;

	const selectedLogs = useMemo(
		() => logs.filter((l) => selected.has(l.id)),
		[logs, selected],
	);
	const selectionInfo = useMemo(() => {
		const members = new Set(selectedLogs.map((l) => l.member_user_id));
		const currencies = new Set(
			selectedLogs.map((l) => l.currency_snapshot || "USD"),
		);
		const allApproved =
			selectedLogs.length > 0 &&
			selectedLogs.every((l) => l.status === "approved");
		return {
			count: selectedLogs.length,
			singleMember: members.size === 1 ? Array.from(members)[0] : null,
			singleCurrency: currencies.size === 1 ? Array.from(currencies)[0] : null,
			allApproved,
		};
	}, [selectedLogs]);
	const canPaySelection =
		selectionInfo.allApproved &&
		selectionInfo.singleMember !== null &&
		selectionInfo.singleCurrency !== null;

	const runReview = async (ids: string[], decision: ReviewOnlyDecision) => {
		if (!onReviewLogs || ids.length === 0) return;
		await onReviewLogs(ids, decision);
		setSelected(new Set());
	};

	if (!isOpen) return null;

	return (
		<div
			className="fixed inset-0 z-165 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-[2px]"
			onClick={onClose}
		>
			<div
				className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
					<div>
						<h3 className="text-base font-semibold text-slate-900">
							{dateLabel}
						</h3>
						<p className="mt-1 text-xs text-slate-500">
							{logs.length} log{logs.length === 1 ? "" : "s"}
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
						aria-label="Close"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				<div className="flex-1 overflow-y-auto">
					<table className="w-full text-[11px]">
						<thead className="sticky top-0 bg-white">
							<tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
								{canBulkAct && (
									<th className="w-8 px-3 py-2">
										<input
											type="checkbox"
											aria-label="Select all eligible logs"
											checked={allSelected}
											ref={(el) => {
												if (el) el.indeterminate = someSelected;
											}}
											disabled={eligibleIds.length === 0}
											onChange={(e) => {
												for (const id of eligibleIds)
													toggleSelect(id, e.currentTarget.checked);
											}}
											className="h-3.5 w-3.5 rounded border-slate-300"
										/>
									</th>
								)}
								{mode === "team" && (
									<th className="px-2 py-2 font-semibold">Member</th>
								)}
								<th className="px-2 py-2 font-semibold">Project</th>
								<th className="px-2 py-2 font-semibold">Task</th>
								<th className="px-2 py-2 font-semibold">Time</th>
								<th className="px-2 py-2 text-right font-semibold">Hours</th>
								<th className="px-2 py-2 text-right font-semibold">Billable</th>
								<th className="px-2 py-2 font-semibold">Status</th>
								<th className="w-10 px-2 py-2" />
							</tr>
						</thead>
						<tbody>
							{logs.map((log) => (
								<DayLogRow
									key={log.id}
									log={log}
									mode={mode}
									highlighted={log.id === highlightLogId}
									selected={selected.has(log.id)}
									eligible={isEligible(log)}
									isSelf={log.member_user_id === currentUserId}
									busy={busyLogIds?.has(log.id) ?? false}
									openMenuRowId={openMenuRowId}
									onSetOpenMenuRowId={setOpenMenuRowId}
									onToggleSelect={toggleSelect}
									onWarnClick={(message) => toast.warning(message)}
									canBulkAct={canBulkAct}
									onReviewLogs={onReviewLogs}
									onPayMember={onPayMember}
									onOpenTaskInRoadmap={onOpenTaskInRoadmap}
									canOpenTaskInRoadmap={canOpenTaskInRoadmap}
								/>
							))}
						</tbody>
					</table>
				</div>

				<div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
					{canBulkAct && selectionInfo.count > 0 && (
						<>
							<span className="mr-auto px-1 text-xs font-semibold text-slate-600">
								{selectionInfo.count} selected
							</span>
							<ModalBulkButton
								tone="success"
								icon={<Check className="h-3.5 w-3.5" />}
								label="Approve"
								onClick={() => void runReview(Array.from(selected), "approved")}
							/>
							<ModalBulkButton
								tone="danger"
								icon={<X className="h-3.5 w-3.5" />}
								label="Reject"
								onClick={() => void runReview(Array.from(selected), "rejected")}
							/>
							<ModalBulkButton
								tone="default"
								icon={<RotateCcw className="h-3.5 w-3.5" />}
								label="Reset"
								onClick={() => void runReview(Array.from(selected), "pending")}
							/>
							<ModalBulkButton
								tone="pay"
								icon={<Wallet className="h-3.5 w-3.5" />}
								label="Pay"
								disabled={!canPaySelection}
								title={
									canPaySelection
										? undefined
										: "Select approved logs of a single member and currency to pay."
								}
								onClick={() => {
									if (!canPaySelection) return;
									onPayMember?.(
										selectionInfo.singleMember as string,
										Array.from(selected),
										selectionInfo.singleCurrency as string,
									);
									setSelected(new Set());
								}}
							/>
							<span className="mx-1 h-4 w-px bg-slate-200" />
						</>
					)}
					<button
						type="button"
						onClick={onClose}
						className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
					>
						Close
					</button>
				</div>
			</div>
		</div>
	);
}

function ModalBulkButton({
	tone,
	icon,
	label,
	onClick,
	disabled,
	title,
}: {
	tone: "success" | "danger" | "default" | "pay";
	icon: React.ReactNode;
	label: string;
	onClick: () => void;
	disabled?: boolean;
	title?: string;
}) {
	const toneClass =
		tone === "success"
			? "text-emerald-700 hover:bg-emerald-50"
			: tone === "danger"
				? "text-rose-700 hover:bg-rose-50"
				: tone === "pay"
					? "text-white bg-indigo-600 hover:bg-indigo-700"
					: "text-slate-600 hover:bg-slate-100";
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={title}
			className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
		>
			{icon}
			{label}
		</button>
	);
}

function DayLogRow({
	log,
	mode,
	highlighted,
	selected,
	eligible,
	isSelf,
	busy,
	openMenuRowId,
	onSetOpenMenuRowId,
	onToggleSelect,
	onWarnClick,
	canBulkAct,
	onReviewLogs,
	onPayMember,
	onOpenTaskInRoadmap,
	canOpenTaskInRoadmap,
}: {
	log: TaskTimeLog;
	mode: "my" | "team";
	highlighted: boolean;
	selected: boolean;
	eligible: boolean;
	isSelf: boolean;
	busy: boolean;
	openMenuRowId: string | null;
	onSetOpenMenuRowId: (id: string | null) => void;
	onToggleSelect: (logId: string, checked: boolean) => void;
	onWarnClick: (message: string) => void;
	canBulkAct: boolean;
	onReviewLogs?: (
		logIds: string[],
		decision: ReviewOnlyDecision,
	) => void | Promise<void>;
	onPayMember?: (memberId: string, logIds: string[], currency: string) => void;
	onOpenTaskInRoadmap: (log: TaskTimeLog) => void;
	canOpenTaskInRoadmap: (taskId: string | null) => boolean;
}) {
	const isRunning = !log.ended_at;
	const currency = log.currency_snapshot || "USD";
	const fee = isRunning ? 0 : logFee(log);
	const started = new Date(log.started_at);
	const ended = log.ended_at ? new Date(log.ended_at) : null;

	const menuItems = buildLogRowActions({
		log,
		eligible,
		isSelf,
		memberId: log.member_user_id,
		currency,
		onReviewLogs: canBulkAct ? onReviewLogs : undefined,
		onPayMember: canBulkAct ? onPayMember : undefined,
		onOpenTaskInRoadmap,
		canOpenTaskInRoadmap,
	});

	return (
		<tr
			className={`border-t border-slate-200/70 ${highlighted ? "bg-sky-50" : "hover:bg-slate-50/60"}`}
		>
			{canBulkAct && (
				<td className="px-3 py-2 align-middle">
					<input
						type="checkbox"
						aria-label="Select log"
						checked={selected}
						disabled={!eligible || busy}
						onChange={(e) => onToggleSelect(log.id, e.currentTarget.checked)}
						className="h-3.5 w-3.5 rounded border-slate-300"
					/>
				</td>
			)}
			{mode === "team" && (
				<td className="px-2 py-2 align-middle">
					<div className="flex items-center gap-1.5">
						<Avatar
							url={log.member?.avatar_url ?? null}
							name={memberLabel(log)}
						/>
						<span className="truncate text-slate-700">{memberLabel(log)}</span>
					</div>
				</td>
			)}
			<td className="max-w-[140px] px-2 py-2 align-middle">
				<span
					className="block truncate text-slate-700"
					title={log.project?.title ?? ""}
				>
					{log.project?.title || "—"}
				</span>
			</td>
			<td className="max-w-40 px-2 py-2 align-middle">
				<span
					className={`block truncate ${log.task?.title ? "text-slate-700" : "italic text-slate-400"}`}
					title={
						log.task?.title || "General time — not linked to a specific task."
					}
				>
					{log.task?.title || "No task"}
				</span>
			</td>
			<td className="px-2 py-2 align-middle tabular-nums text-slate-500">
				{formatLogStart(started)}
				{" – "}
				{isRunning ? (
					<span className="text-sky-600">now</span>
				) : ended ? (
					formatLogEnd(started, ended)
				) : (
					"—"
				)}
			</td>
			<td className="px-2 py-2 text-right align-middle tabular-nums font-semibold text-slate-700">
				<span className="inline-flex items-center justify-end gap-1">
					{isUnusuallyLongLog(log) && (
						<button
							type="button"
							className="inline-flex text-amber-500 hover:text-amber-600"
							onClick={(e) => {
								e.stopPropagation();
								onWarnClick(
									`${memberLabel(log)} logged ${formatHours(log.duration_seconds)}h in a single entry — unusually long. A timer may have been left running; verify before approving.`,
								);
							}}
						>
							<AlertTriangle
								className="h-3.5 w-3.5"
								aria-label="Unusually long log"
							/>
						</button>
					)}
					{formatHours(log.duration_seconds)}
				</span>
			</td>
			<td className="px-2 py-2 text-right align-middle tabular-nums font-semibold">
				<BillableAmount
					status={log.status}
					running={isRunning}
					fee={fee}
					currency={currency}
				/>
			</td>
			<td className="px-2 py-2 align-middle">
				<span
					className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusBadgeClass(isRunning ? "running" : log.status)}`}
				>
					{isRunning ? "running" : log.status}
				</span>
			</td>
			<td className="px-2 py-2 text-right align-middle">
				<RowActionsMenu
					rowId={log.id}
					openMenuRowId={openMenuRowId}
					onSetOpenMenuRowId={onSetOpenMenuRowId}
					items={menuItems}
					loading={busy}
					menuZIndexClassName="z-175"
				/>
			</td>
		</tr>
	);
}

function Avatar({ url, name }: { url: string | null; name: string }) {
	if (url) {
		return (
			<img
				src={url}
				alt={name}
				className="h-5 w-5 shrink-0 rounded-full object-cover"
			/>
		);
	}
	return (
		<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[9px] font-semibold text-slate-600">
			{initialsFromName(name)}
		</div>
	);
}
