import {
	AlertTriangle,
	Check,
	ChevronDown,
	ChevronRight,
	ClipboardCheck,
	Loader2,
	RotateCcw,
	Wallet,
	X,
} from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import type { TaskTimeLog, TimeLogStatus } from "@/services/team-time.service";
import { BillableAmount } from "./BillableAmount";
import { buildLogRowActions } from "./logRowActions";
import { type ActionMenuItem, RowActionsMenu } from "./RowActionsMenu";
import {
	formatHours,
	formatLogEnd,
	formatLogStart,
	formatMoney,
	initialsFromName,
	isUnusuallyLongLog,
	liveDurationSecondsFromLog,
	logFee,
	memberLabel,
	statusBadgeClass,
	useLiveNowMs,
} from "./time-utils";

export type ReviewOnlyDecision = "approved" | "rejected" | "pending";

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
	weekday: "short",
	month: "short",
	day: "numeric",
});

interface MemberGroup {
	memberId: string;
	label: string;
	avatarUrl: string | null;
	logs: TaskTimeLog[];
	totalSeconds: number;
	/** Approved + paid fees per currency — the confirmed billable total. */
	billableByCurrency: Map<string, number>;
	statusCounts: Record<TimeLogStatus, number>;
	runningCount: number;
	/** Approved, ended logs grouped by currency — the payable buckets. */
	approvedByCurrency: Map<string, { ids: string[]; amount: number }>;
}

function buildGroups(logs: TaskTimeLog[]): MemberGroup[] {
	const byMember = new Map<string, MemberGroup>();
	for (const log of logs) {
		let group = byMember.get(log.member_user_id);
		if (!group) {
			group = {
				memberId: log.member_user_id,
				label: memberLabel(log),
				avatarUrl: log.member?.avatar_url ?? null,
				logs: [],
				totalSeconds: 0,
				billableByCurrency: new Map(),
				statusCounts: { pending: 0, approved: 0, paid: 0, rejected: 0 },
				runningCount: 0,
				approvedByCurrency: new Map(),
			};
			byMember.set(log.member_user_id, group);
		}
		group.logs.push(log);
		group.statusCounts[log.status] += 1;
		if (!log.ended_at) group.runningCount += 1;
		group.totalSeconds += log.duration_seconds ?? 0;
		const fee = logFee(log);
		// Billable = approved + paid only. Pending is not yet billable and
		// rejected is non-billable, so neither contributes to the total.
		if (fee > 0 && (log.status === "approved" || log.status === "paid")) {
			const cur = log.currency_snapshot || "USD";
			group.billableByCurrency.set(
				cur,
				(group.billableByCurrency.get(cur) ?? 0) + fee,
			);
		}
		if (log.status === "approved" && log.ended_at) {
			const cur = log.currency_snapshot || "USD";
			const bucket = group.approvedByCurrency.get(cur) ?? {
				ids: [],
				amount: 0,
			};
			bucket.ids.push(log.id);
			bucket.amount += fee;
			group.approvedByCurrency.set(cur, bucket);
		}
	}
	// Sort logs within each group newest-first, and groups by name.
	for (const group of byMember.values()) {
		group.logs.sort(
			(a, b) =>
				new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
		);
	}
	return Array.from(byMember.values()).sort((a, b) =>
		a.label.localeCompare(b.label),
	);
}

function billableLabel(billableByCurrency: Map<string, number>): string {
	if (billableByCurrency.size === 0) return "—";
	return Array.from(billableByCurrency.entries())
		.map(([cur, amount]) => formatMoney(amount, cur))
		.join(" · ");
}

const STATUS_PILL_ORDER: TimeLogStatus[] = [
	"pending",
	"approved",
	"paid",
	"rejected",
];

interface TeamApprovalsInboxProps {
	logs: TaskTimeLog[];
	loadingLogs: boolean;
	currentUserId: string | null;
	/** Log ids with a review/pay mutation in flight (drives spinners). */
	busyLogIds?: Set<string>;
	onReviewLogs: (
		logIds: string[],
		decision: ReviewOnlyDecision,
	) => void | Promise<void>;
	onPayMember: (
		memberId: string,
		logIds: string[],
		currency: string,
		payAll?: boolean,
	) => void;
	onOpenTaskInRoadmap: (log: TaskTimeLog) => void;
	canOpenTaskInRoadmap: (taskId: string | null) => boolean;
}

export function TeamApprovalsInbox({
	logs,
	loadingLogs,
	currentUserId,
	busyLogIds,
	onReviewLogs,
	onPayMember,
	onOpenTaskInRoadmap,
	canOpenTaskInRoadmap,
}: TeamApprovalsInboxProps) {
	const groups = useMemo(() => buildGroups(logs), [logs]);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	// When the list narrows to a single member (e.g. arriving from Payouts →
	// Review, or Manage Rates → View logs), open that member's drilldown so the
	// logs are visible without an extra click. Re-runs only when the groups set
	// changes, so a manual collapse still sticks.
	useEffect(() => {
		if (groups.length === 1) setExpanded(new Set([groups[0].memberId]));
	}, [groups]);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [openMenuRowId, setOpenMenuRowId] = useState<string | null>(null);

	const logById = useMemo(() => {
		const map = new Map<string, TaskTimeLog>();
		for (const log of logs) map.set(log.id, log);
		return map;
	}, [logs]);

	const toggleExpand = (memberId: string) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(memberId)) next.delete(memberId);
			else next.add(memberId);
			return next;
		});

	const toggleSelect = (logId: string, checked: boolean) =>
		setSelected((prev) => {
			const next = new Set(prev);
			if (checked) next.add(logId);
			else next.delete(logId);
			return next;
		});

	const isEligible = (log: TaskTimeLog) =>
		Boolean(log.ended_at) && log.member_user_id !== currentUserId;

	// Selection summary for the floating bulk bar.
	const selectedLogs = useMemo(
		() =>
			Array.from(selected)
				.map((id) => logById.get(id))
				.filter(Boolean) as TaskTimeLog[],
		[selected, logById],
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

	const clearSelection = () => setSelected(new Set());

	const runReview = async (ids: string[], decision: ReviewOnlyDecision) => {
		await onReviewLogs(ids, decision);
		setSelected(new Set());
	};

	const canPaySelection =
		selectionInfo.allApproved &&
		selectionInfo.singleMember !== null &&
		selectionInfo.singleCurrency !== null;

	if (loadingLogs) return <InboxSkeleton />;

	if (groups.length === 0) {
		return (
			<div className="rounded-xl border border-slate-200 bg-white px-6 py-16">
				<div className="mx-auto flex max-w-sm flex-col items-center text-center">
					<div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
						<ClipboardCheck className="h-7 w-7 text-slate-500" />
					</div>
					<h3 className="text-base font-semibold text-slate-900">
						Nothing to review
					</h3>
					<p className="mt-2 text-sm text-slate-500">
						When members log time, entries appear here grouped by member for you
						to approve, reject, and pay. Try adjusting the status, project, or
						period filters above.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-2.5 pb-24">
			{groups.map((group) => {
				const isOpen = expanded.has(group.memberId);
				const approvedBuckets = Array.from(group.approvedByCurrency.entries());
				const singleApproved =
					approvedBuckets.length === 1 ? approvedBuckets[0] : null;
				return (
					<div
						key={group.memberId}
						className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
					>
						{/* Collapsed summary row */}
						<div className="flex items-center gap-3 px-3 py-2.5">
							<button
								type="button"
								onClick={() => toggleExpand(group.memberId)}
								className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
								aria-label={isOpen ? "Collapse" : "Expand"}
							>
								{isOpen ? (
									<ChevronDown className="h-4 w-4" />
								) : (
									<ChevronRight className="h-4 w-4" />
								)}
							</button>

							<Avatar url={group.avatarUrl} name={group.label} />

							<button
								type="button"
								onClick={() => toggleExpand(group.memberId)}
								className="min-w-0 flex-1 text-left"
							>
								<div className="truncate text-sm font-semibold text-slate-900">
									{group.label}
								</div>
								<div className="mt-0.5 flex flex-wrap items-center gap-1">
									{STATUS_PILL_ORDER.map((status) => {
										const count = group.statusCounts[status];
										if (!count) return null;
										return (
											<span
												key={status}
												className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${statusBadgeClass(status)}`}
											>
												{count} {status}
											</span>
										);
									})}
									{group.runningCount > 0 && (
										<span
											className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${statusBadgeClass("running")}`}
										>
											{group.runningCount} running
										</span>
									)}
								</div>
							</button>

							<div className="hidden text-right sm:block">
								<div
									className="text-xs text-slate-400"
									title="Tracked duration"
								>
									Hours
								</div>
								<div className="text-sm font-semibold tabular-nums text-slate-700">
									{formatHours(group.totalSeconds)}
								</div>
							</div>

							<div className="hidden text-right md:block">
								<div
									className="text-xs text-slate-400"
									title="Approved + paid — the confirmed billable amount. Pending is not yet billable; rejected is non-billable."
								>
									Billable
								</div>
								<div className="text-sm font-semibold tabular-nums text-emerald-700">
									{billableLabel(group.billableByCurrency)}
								</div>
							</div>

							{approvedBuckets.length > 0 && (
								<button
									type="button"
									onClick={() => {
										if (singleApproved) {
											// payAll: settle EVERY approved log in this currency,
											// not just the ≤200 loaded into this group.
											onPayMember(
												group.memberId,
												singleApproved[1].ids,
												singleApproved[0],
												true,
											);
										} else {
											// Multiple currencies — expand so the payer can pick.
											setExpanded((prev) => new Set(prev).add(group.memberId));
										}
									}}
									className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
								>
									<Wallet className="h-3.5 w-3.5" />
									{singleApproved
										? `Pay ${formatMoney(singleApproved[1].amount, singleApproved[0])}`
										: "Pay…"}
								</button>
							)}
						</div>

						{/* Drill-down */}
						{isOpen && (
							<MemberDrilldown
								group={group}
								currentUserId={currentUserId}
								selected={selected}
								busyLogIds={busyLogIds}
								openMenuRowId={openMenuRowId}
								onSetOpenMenuRowId={setOpenMenuRowId}
								isEligible={isEligible}
								onToggleSelect={toggleSelect}
								onReviewLogs={onReviewLogs}
								onPayMember={onPayMember}
								onOpenTaskInRoadmap={onOpenTaskInRoadmap}
								canOpenTaskInRoadmap={canOpenTaskInRoadmap}
							/>
						)}
					</div>
				);
			})}

			{/* Floating bulk action bar */}
			{selectionInfo.count > 0 && (
				<div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
					<div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 shadow-lg">
						<span className="px-1 text-xs font-semibold text-slate-600">
							{selectionInfo.count} selected
						</span>
						<span className="h-4 w-px bg-slate-200" />
						<BulkButton
							tone="success"
							icon={<Check className="h-3.5 w-3.5" />}
							label="Approve"
							onClick={() => void runReview(Array.from(selected), "approved")}
						/>
						<BulkButton
							tone="danger"
							icon={<X className="h-3.5 w-3.5" />}
							label="Reject"
							onClick={() => void runReview(Array.from(selected), "rejected")}
						/>
						<BulkButton
							tone="default"
							icon={<RotateCcw className="h-3.5 w-3.5" />}
							label="Reset"
							onClick={() => void runReview(Array.from(selected), "pending")}
						/>
						<BulkButton
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
								onPayMember(
									selectionInfo.singleMember as string,
									Array.from(selected),
									selectionInfo.singleCurrency as string,
								);
								clearSelection();
							}}
						/>
						<span className="h-4 w-px bg-slate-200" />
						<button
							type="button"
							onClick={clearSelection}
							className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
						>
							Clear
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

function BulkButton({
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

// ─── drill-down ──────────────────────────────────────────────────────────

interface MemberDrilldownProps {
	group: MemberGroup;
	currentUserId: string | null;
	selected: Set<string>;
	busyLogIds?: Set<string>;
	openMenuRowId: string | null;
	onSetOpenMenuRowId: (id: string | null) => void;
	isEligible: (log: TaskTimeLog) => boolean;
	onToggleSelect: (logId: string, checked: boolean) => void;
	onReviewLogs: (
		logIds: string[],
		decision: ReviewOnlyDecision,
	) => void | Promise<void>;
	onPayMember: (
		memberId: string,
		logIds: string[],
		currency: string,
		payAll?: boolean,
	) => void;
	onOpenTaskInRoadmap: (log: TaskTimeLog) => void;
	canOpenTaskInRoadmap: (taskId: string | null) => boolean;
}

function MemberDrilldown({
	group,
	currentUserId,
	selected,
	busyLogIds,
	openMenuRowId,
	onSetOpenMenuRowId,
	isEligible,
	onToggleSelect,
	onReviewLogs,
	onPayMember,
	onOpenTaskInRoadmap,
	canOpenTaskInRoadmap,
}: MemberDrilldownProps) {
	const eligibleIds = group.logs.filter(isEligible).map((l) => l.id);
	const allSelected =
		eligibleIds.length > 0 && eligibleIds.every((id) => selected.has(id));
	const someSelected =
		eligibleIds.some((id) => selected.has(id)) && !allSelected;

	// Unusually long logs float to the top so they're reviewed first; within
	// each partition the existing newest-first order is preserved (stable sort).
	const ordered = useMemo(() => {
		const arr = [...group.logs];
		arr.sort(
			(a, b) => Number(isUnusuallyLongLog(b)) - Number(isUnusuallyLongLog(a)),
		);
		return arr;
	}, [group.logs]);

	// Client-side pagination — a member can have hundreds of logs; render a page
	// at a time with a "Load more" so the drilldown stays scannable.
	const PAGE = 25;
	const [visible, setVisible] = useState(PAGE);
	const shown = ordered.slice(0, visible);
	const remaining = ordered.length - shown.length;

	return (
		<div className="border-t border-slate-200 bg-slate-50/60">
			<table className="w-full text-[11px]">
				<thead>
					<tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
						<th className="w-8 px-3 py-2">
							<input
								type="checkbox"
								aria-label="Select all eligible logs for this member"
								checked={allSelected}
								ref={(el) => {
									if (el) el.indeterminate = someSelected;
								}}
								disabled={eligibleIds.length === 0}
								onChange={(e) => {
									for (const id of eligibleIds) {
										onToggleSelect(id, e.currentTarget.checked);
									}
								}}
								className="h-3.5 w-3.5 rounded border-slate-300"
							/>
						</th>
						<th className="px-2 py-2 font-semibold">Date</th>
						<th className="px-2 py-2 font-semibold">Project</th>
						<th className="px-2 py-2 font-semibold">Task</th>
						<th className="px-2 py-2 font-semibold">Time</th>
						<th
							className="px-2 py-2 text-right font-semibold"
							title="Tracked duration"
						>
							Hours
						</th>
						<th
							className="px-2 py-2 text-right font-semibold"
							title="Approved + paid count as billable. Pending is not yet billable; rejected is non-billable."
						>
							Billable
						</th>
						<th className="px-2 py-2 font-semibold">Status</th>
						<th className="w-10 px-2 py-2" />
					</tr>
				</thead>
				<tbody>
					{shown.map((log) => (
						<DrilldownRow
							key={log.id}
							log={log}
							memberId={group.memberId}
							currentUserId={currentUserId}
							selected={selected.has(log.id)}
							eligible={isEligible(log)}
							busy={busyLogIds?.has(log.id) ?? false}
							openMenuRowId={openMenuRowId}
							onSetOpenMenuRowId={onSetOpenMenuRowId}
							onToggleSelect={onToggleSelect}
							onReviewLogs={onReviewLogs}
							onPayMember={onPayMember}
							onOpenTaskInRoadmap={onOpenTaskInRoadmap}
							canOpenTaskInRoadmap={canOpenTaskInRoadmap}
						/>
					))}
				</tbody>
			</table>
			{remaining > 0 && (
				<div className="border-t border-slate-200 px-3 py-2 text-center">
					<button
						type="button"
						onClick={() => setVisible((v) => v + PAGE)}
						className="rounded-md px-3 py-1 text-[11px] font-semibold text-sky-600 hover:bg-sky-50"
					>
						Load {Math.min(PAGE, remaining)} more ({remaining} remaining)
					</button>
				</div>
			)}
		</div>
	);
}

const DrilldownRow = memo(function DrilldownRow({
	log,
	memberId,
	currentUserId,
	selected,
	eligible,
	busy,
	openMenuRowId,
	onSetOpenMenuRowId,
	onToggleSelect,
	onReviewLogs,
	onPayMember,
	onOpenTaskInRoadmap,
	canOpenTaskInRoadmap,
}: {
	log: TaskTimeLog;
	memberId: string;
	currentUserId: string | null;
	selected: boolean;
	eligible: boolean;
	busy: boolean;
	openMenuRowId: string | null;
	onSetOpenMenuRowId: (id: string | null) => void;
	onToggleSelect: (logId: string, checked: boolean) => void;
	onReviewLogs: (
		logIds: string[],
		decision: ReviewOnlyDecision,
	) => void | Promise<void>;
	onPayMember: (
		memberId: string,
		logIds: string[],
		currency: string,
		payAll?: boolean,
	) => void;
	onOpenTaskInRoadmap: (log: TaskTimeLog) => void;
	canOpenTaskInRoadmap: (taskId: string | null) => boolean;
}) {
	const toast = useToast();
	const isRunning = !log.ended_at;
	const nowMs = useLiveNowMs(isRunning);
	const seconds = liveDurationSecondsFromLog(log, nowMs);
	const currency = log.currency_snapshot || "USD";
	const fee = isRunning ? 0 : logFee(log);
	const started = new Date(log.started_at);
	const ended = log.ended_at ? new Date(log.ended_at) : null;
	const isSelf = log.member_user_id === currentUserId;

	const menuItems = useMemo<ActionMenuItem[]>(
		() =>
			buildLogRowActions({
				log,
				eligible,
				isSelf,
				memberId,
				currency,
				onReviewLogs,
				onPayMember,
				onOpenTaskInRoadmap,
				canOpenTaskInRoadmap,
			}),
		[
			eligible,
			isSelf,
			log,
			memberId,
			currency,
			onReviewLogs,
			onPayMember,
			onOpenTaskInRoadmap,
			canOpenTaskInRoadmap,
		],
	);

	return (
		<tr className="border-t border-slate-200/70 hover:bg-white">
			<td className="px-3 py-2 align-middle">
				<input
					type="checkbox"
					aria-label="Select log"
					checked={selected}
					disabled={!eligible || busy}
					title={
						isSelf
							? "You cannot review your own logs."
							: isRunning
								? "Running logs are skipped."
								: undefined
					}
					onChange={(e) => onToggleSelect(log.id, e.currentTarget.checked)}
					className="h-3.5 w-3.5 rounded border-slate-300"
				/>
			</td>
			<td className="px-2 py-2 align-middle tabular-nums text-slate-600">
				{DATE_FORMATTER.format(started)}
			</td>
			<td className="max-w-[140px] px-2 py-2 align-middle">
				<span
					className="block truncate text-slate-700"
					title={log.project?.title ?? ""}
				>
					{log.project?.title || "—"}
				</span>
			</td>
			<td className="max-w-[160px] px-2 py-2 align-middle">
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
								toast.warning(
									`${memberLabel(log)} logged ${(seconds / 3600).toFixed(2)}h in a single entry — unusually long. A timer may have been left running; verify before approving.`,
								);
							}}
						>
							<AlertTriangle
								className="h-3.5 w-3.5"
								aria-label="Unusually long log"
							/>
						</button>
					)}
					{(seconds / 3600).toFixed(2)}
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
				/>
			</td>
		</tr>
	);
});

function Avatar({ url, name }: { url: string | null; name: string }) {
	if (url) {
		return (
			<img
				src={url}
				alt={name}
				className="h-8 w-8 shrink-0 rounded-full object-cover"
			/>
		);
	}
	return (
		<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-600">
			{initialsFromName(name)}
		</div>
	);
}

function InboxSkeleton() {
	return (
		<div className="space-y-2.5">
			{Array.from({ length: 4 }).map((_, idx) => (
				<div
					key={idx}
					className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 animate-pulse"
				>
					<div className="h-8 w-8 rounded-full bg-slate-100" />
					<div className="flex-1 space-y-2">
						<div className="h-3 w-40 rounded bg-slate-100" />
						<div className="h-2.5 w-24 rounded bg-slate-100" />
					</div>
					<Loader2 className="h-4 w-4 animate-spin text-slate-300" />
				</div>
			))}
		</div>
	);
}
