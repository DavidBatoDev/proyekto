import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	AlertTriangle,
	Ban,
	CalendarClock,
	CheckCircle2,
	ClipboardCheck,
	ExternalLink,
	Loader2,
	Lock,
	Wallet,
	X,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
	buildTeamLogPeriodSearch,
	payPeriodForDate,
	payPeriodLabel,
	resolveTeamLogPeriod,
} from "@/components/team-time/log-period";
import { PayMemberModal } from "@/components/team-time/PayMemberModal";
import {
	formatMoney,
	initialsFromName,
	logFee,
} from "@/components/team-time/time-utils";
import { useToast } from "@/hooks/useToast";
import { type Payout, payoutsService } from "@/services/payouts.service";
import { getTeam, type PayPeriodConfig } from "@/services/teams.service";
import {
	type TaskTimeLog,
	teamTimeService,
} from "@/services/team-time.service";

export const Route = createFileRoute("/teams/$teamId/time/payouts")({
	component: PayoutsRoute,
});

interface PayTarget {
	memberId: string;
	memberLabel: string;
	currency: string;
	logs: TaskTimeLog[];
}

/** One member's balance (single currency) within a cut-off. */
interface MemberOwe {
	memberId: string;
	label: string;
	avatarUrl: string | null;
	currency: string;
	/** Approved (payable) logs. */
	logs: TaskTimeLog[];
	seconds: number;
	amount: number;
	/** This member's logs in the cut-off still awaiting review. */
	pendingCount: number;
	pendingSeconds: number;
}

/** A cut-off period with outstanding balances and/or logs still to review. */
interface CutoffGroup {
	key: string;
	month: string;
	periodId: string;
	label: string;
	payDate: Date;
	from: number;
	overdue: boolean;
	members: MemberOwe[];
	/** Logs in this cut-off still awaiting approve/reject — block payment. */
	pendingCount: number;
	pendingSeconds: number;
}

function memberLabelFromLog(log: TaskTimeLog): string {
	return (
		log.member?.display_name ||
		[log.member?.first_name, log.member?.last_name]
			.filter(Boolean)
			.join(" ")
			.trim() ||
		log.member?.email ||
		log.member_user_id
	);
}

const METHOD_LABEL: Record<string, string> = {
	bank: "Bank",
	gcash: "GCash",
	maya: "Maya",
	paypal: "PayPal",
	other: "Other",
};

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	year: "numeric",
});

function payoutMemberLabel(p: Payout): string {
	return (
		p.member?.display_name ||
		[p.member?.first_name, p.member?.last_name]
			.filter(Boolean)
			.join(" ")
			.trim() ||
		p.member?.email ||
		p.member_user_id
	);
}

function PayoutsRoute() {
	const { teamId } = Route.useParams();
	const qc = useQueryClient();
	const navigate = useNavigate();
	const [openId, setOpenId] = useState<string | null>(null);
	const [payTarget, setPayTarget] = useState<PayTarget | null>(null);
	const teamQuery = useQuery({
		queryKey: ["teams", "detail", teamId],
		queryFn: () => getTeam(teamId),
	});
	const payPeriodConfig: PayPeriodConfig | null =
		teamQuery.data?.pay_period_config ?? null;

	// Approved (payable) + pending (needs-review) logs, grouped into the cut-off
	// each belongs to, so the owner sees every cut-off that needs action and
	// can't pay one until its pending logs are settled.
	const approvedQuery = useQuery({
		queryKey: ["payouts", teamId, "approved-logs"],
		queryFn: () => teamTimeService.listAllTeamLogsByStatus(teamId, "approved"),
	});
	const pendingQuery = useQuery({
		queryKey: ["payouts", teamId, "pending-logs"],
		queryFn: () => teamTimeService.listAllTeamLogsByStatus(teamId, "pending"),
	});

	const groups = useMemo<CutoffGroup[]>(() => {
		interface Draft {
			key: string;
			month: string;
			periodId: string;
			label: string;
			payDate: Date;
			from: number;
			members: Map<string, MemberOwe>;
			pendingCount: number;
			pendingSeconds: number;
		}
		const cutoffs = new Map<string, Draft>();
		const memberBucket = (log: TaskTimeLog): MemberOwe => {
			const { month, period } = payPeriodForDate(
				payPeriodConfig,
				new Date(log.started_at),
			);
			const ck = `${month}:${period.id}`;
			let g = cutoffs.get(ck);
			if (!g) {
				g = {
					key: ck,
					month,
					periodId: period.id,
					label: payPeriodLabel(period),
					payDate: period.payDate,
					from: period.from.getTime(),
					members: new Map(),
					pendingCount: 0,
					pendingSeconds: 0,
				};
				cutoffs.set(ck, g);
			}
			const currency = log.currency_snapshot || "USD";
			const mk = `${log.member_user_id}:${currency}`;
			let m = g.members.get(mk);
			if (!m) {
				m = {
					memberId: log.member_user_id,
					label: memberLabelFromLog(log),
					avatarUrl: log.member?.avatar_url ?? null,
					currency,
					logs: [],
					seconds: 0,
					amount: 0,
					pendingCount: 0,
					pendingSeconds: 0,
				};
				g.members.set(mk, m);
			}
			return m;
		};
		for (const log of approvedQuery.data ?? []) {
			const m = memberBucket(log);
			m.logs.push(log);
			m.seconds += log.duration_seconds ?? 0;
			m.amount += logFee(log);
		}
		for (const log of pendingQuery.data ?? []) {
			const m = memberBucket(log);
			m.pendingCount += 1;
			m.pendingSeconds += log.duration_seconds ?? 0;
		}
		// Roll member pending counts up to the cut-off for the header chip.
		for (const g of cutoffs.values()) {
			for (const m of g.members.values()) {
				g.pendingCount += m.pendingCount;
				g.pendingSeconds += m.pendingSeconds;
			}
		}
		const now = Date.now();
		return Array.from(cutoffs.values())
			.map((g) => ({
				key: g.key,
				month: g.month,
				periodId: g.periodId,
				label: g.label,
				payDate: g.payDate,
				from: g.from,
				overdue: g.payDate.getTime() < now,
				members: Array.from(g.members.values()).sort(
					(a, b) => b.amount - a.amount,
				),
				pendingCount: g.pendingCount,
				pendingSeconds: g.pendingSeconds,
			}))
			.sort((a, b) => b.from - a.from);
	}, [approvedQuery.data, pendingQuery.data, payPeriodConfig]);

	const grandTotalLabel = useMemo(() => {
		const totals: Record<string, number> = {};
		for (const g of groups)
			for (const m of g.members)
				totals[m.currency] = (totals[m.currency] ?? 0) + m.amount;
		return Object.entries(totals)
			.filter(([, a]) => a > 0.005)
			.map(([c, a]) => formatMoney(a, c))
			.join(" · ");
	}, [groups]);

	const payoutsQuery = useQuery({
		queryKey: ["payouts", teamId],
		queryFn: () => payoutsService.listTeamPayouts(teamId),
	});
	const payouts = payoutsQuery.data ?? [];

	const handlePay = (m: MemberOwe) =>
		setPayTarget({
			memberId: m.memberId,
			memberLabel: m.label,
			currency: m.currency,
			logs: m.logs,
		});

	// Jump to Team Logs, focused on this cut-off + member's pending logs. Pass
	// the FULLY RESOLVED period (from/to) so Team Logs adopts this cut-off
	// instead of restoring the member's last-used period from localStorage.
	const handleReview = (g: CutoffGroup, memberId?: string) => {
		const resolved = resolveTeamLogPeriod(
			{
				preset: "cutoff",
				cutoff_month: g.month,
				cutoff_period: g.periodId,
			},
			payPeriodConfig,
		);
		navigate({
			to: "/teams/$teamId/time/team-logs",
			params: { teamId },
			search: {
				...buildTeamLogPeriodSearch(resolved),
				status: "pending",
				member: memberId,
			},
		});
	};

	return (
		<div className="space-y-4">
			{/* ─── To pay: outstanding balances grouped by cut-off ───────────── */}
			<section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
				<div className="flex flex-wrap items-baseline justify-between gap-2">
					<div>
						<h3 className="text-sm font-semibold text-slate-900">To pay</h3>
						<p className="text-xs text-slate-500">
							Balances grouped by cut-off, newest first.
						</p>
					</div>
					{grandTotalLabel && (
						<div className="text-right">
							<div className="text-[10px] uppercase tracking-wide text-slate-400">
								Approved outstanding
							</div>
							<div className="text-sm font-semibold text-slate-800">
								{grandTotalLabel}
							</div>
						</div>
					)}
				</div>

				{/* Two-step reminder */}
				<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
					<span className="inline-flex items-center gap-1.5">
						<ClipboardCheck className="h-3.5 w-3.5 text-slate-400" />
						<span className="font-semibold text-slate-600">1.</span> Approve or
						reject a cut-off's logs in Team Logs
					</span>
					<span className="inline-flex items-center gap-1.5">
						<Wallet className="h-3.5 w-3.5 text-slate-400" />
						<span className="font-semibold text-slate-600">2.</span> Pay the
						cut-off here once nothing is pending
					</span>
				</div>

				<div className="mt-3 space-y-3">
					{approvedQuery.isPending || pendingQuery.isPending ? (
						<div className="flex justify-center py-8">
							<Loader2 className="h-5 w-5 animate-spin text-slate-400" />
						</div>
					) : groups.length === 0 ? (
						<div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
							Nothing to pay or review. Approved logs will appear here grouped
							by cut-off.
						</div>
					) : (
						groups.map((g) => (
							<CutoffSection
								key={g.key}
								group={g}
								onPay={handlePay}
								onReview={(memberId) => handleReview(g, memberId)}
							/>
						))
					)}
				</div>
			</section>

			{/* ─── Paid history ──────────────────────────────────────────────── */}
			<section className="rounded-xl border border-slate-200 bg-white">
				<div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
					<h3 className="text-sm font-semibold text-slate-900">Payout history</h3>
					{payouts.length > 0 && (
						<span className="text-xs text-slate-400">
							{payouts.length} record{payouts.length === 1 ? "" : "s"}
						</span>
					)}
				</div>
				{payoutsQuery.isPending ? (
					<div className="flex justify-center p-12">
						<Loader2 className="h-6 w-6 animate-spin text-slate-400" />
					</div>
				) : payouts.length === 0 ? (
					<div className="px-6 py-12 text-center text-sm text-slate-500">
						No payouts recorded yet. Pay a member above (or from Team Logs) and
						the record appears here with its method, reference, and proof.
					</div>
				) : (
					<ul className="divide-y divide-slate-100">
						{payouts.map((p) => {
							const label = payoutMemberLabel(p);
							const isVoid = p.status === "void";
							return (
								<li key={p.id}>
									<button
										type="button"
										onClick={() => setOpenId(p.id)}
										className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
									>
										{p.member?.avatar_url ? (
											<img
												src={p.member.avatar_url}
												alt={label}
												className="h-9 w-9 shrink-0 rounded-full object-cover"
											/>
										) : (
											<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
												{initialsFromName(label)}
											</div>
										)}
										<div className="min-w-0 flex-1">
											<div className="flex items-center gap-2">
												<span
													className={`truncate text-sm font-medium ${isVoid ? "text-slate-400 line-through" : "text-slate-800"}`}
												>
													{label}
												</span>
												<span
													className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
														isVoid
															? "bg-slate-100 text-slate-500"
															: "bg-emerald-50 text-emerald-700"
													}`}
												>
													{isVoid ? "void" : "paid"}
												</span>
											</div>
											<div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
												<span>{DATE_FMT.format(new Date(p.paid_at))}</span>
												{p.method_type && (
													<>
														<span className="text-slate-300">·</span>
														<span>
															{METHOD_LABEL[p.method_type] ?? p.method_type}
															{p.method_label ? ` · ${p.method_label}` : ""}
														</span>
													</>
												)}
												{p.reference_number && (
													<>
														<span className="text-slate-300">·</span>
														<span className="truncate">
															Ref {p.reference_number}
														</span>
													</>
												)}
											</div>
										</div>
										<div className="shrink-0 text-right">
											<div
												className={`text-sm font-semibold tabular-nums ${isVoid ? "text-slate-400 line-through" : "text-emerald-700"}`}
											>
												{formatMoney(p.total_amount, p.currency)}
											</div>
										</div>
										<ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-300" />
									</button>
								</li>
							);
						})}
					</ul>
				)}
			</section>

			{payTarget && (
				<PayMemberModal
					isOpen
					teamId={teamId}
					memberId={payTarget.memberId}
					memberLabel={payTarget.memberLabel}
					currency={payTarget.currency}
					logs={payTarget.logs}
					payPeriodConfig={payPeriodConfig}
					onClose={() => setPayTarget(null)}
					onSuccess={() => {
						setPayTarget(null);
						qc.invalidateQueries({ queryKey: ["payouts", teamId] });
						qc.invalidateQueries({ queryKey: ["team-time", teamId] });
					}}
				/>
			)}

			{openId && (
				<PayoutDetailDrawer
					teamId={teamId}
					payoutId={openId}
					onClose={() => setOpenId(null)}
				/>
			)}
		</div>
	);
}

function CutoffSection({
	group,
	onPay,
	onReview,
}: {
	group: CutoffGroup;
	onPay: (m: MemberOwe) => void;
	onReview: (memberId?: string) => void;
}) {
	const hasPending = group.pendingCount > 0;

	// One status chip summarising where this cut-off stands.
	const chip = hasPending
		? {
				cls: "bg-amber-100 text-amber-800",
				icon: <ClipboardCheck className="h-3 w-3" />,
				text: `${group.pendingCount} pending review`,
			}
		: group.overdue
			? {
					cls: "bg-rose-100 text-rose-700",
					icon: <AlertTriangle className="h-3 w-3" />,
					text: "Overdue",
				}
			: {
					cls: "bg-emerald-100 text-emerald-700",
					icon: <CheckCircle2 className="h-3 w-3" />,
					text: "Ready to pay",
				};

	return (
		<div
			className={`overflow-hidden rounded-xl border ${hasPending ? "border-amber-200" : "border-slate-200"}`}
		>
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2">
				<div className="flex flex-wrap items-center gap-2">
					<CalendarClock className="h-4 w-4 text-slate-400" />
					<span className="text-sm font-semibold text-slate-800">
						{group.label}
					</span>
					<span className="text-[11px] text-slate-400">
						{group.overdue ? "was due" : "pays"} {DATE_FMT.format(group.payDate)}
					</span>
				</div>
				<span
					className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${chip.cls}`}
				>
					{chip.icon}
					{chip.text}
				</span>
			</div>

			<ul className="divide-y divide-slate-100">
				{group.members.map((m) => {
					const memberPending = m.pendingCount > 0;
					const meta: string[] = [];
					if (m.amount > 0)
						meta.push(
							`${(m.seconds / 3600).toFixed(2)} h · ${m.logs.length} approved`,
						);
					if (memberPending) meta.push(`${m.pendingCount} pending`);
					return (
						<li
							key={`${m.memberId}:${m.currency}`}
							className="flex items-center justify-between gap-3 px-3 py-2.5"
						>
							<div className="flex min-w-0 items-center gap-2.5">
								{m.avatarUrl ? (
									<img
										src={m.avatarUrl}
										alt={m.label}
										className="h-8 w-8 shrink-0 rounded-full object-cover"
									/>
								) : (
									<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-600">
										{initialsFromName(m.label)}
									</div>
								)}
								<div className="min-w-0">
									<div className="truncate text-sm font-medium text-slate-800">
										{m.label}
									</div>
									<div className="text-[11px] tabular-nums text-slate-500">
										{meta.join(" · ")}
									</div>
								</div>
							</div>
							<div className="flex shrink-0 items-center gap-2">
								{memberPending && (
									<button
										type="button"
										onClick={() => onReview(m.memberId)}
										className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50"
									>
										<ClipboardCheck className="h-3.5 w-3.5" />
										Review
									</button>
								)}
								{m.amount > 0 && (
									<button
										type="button"
										onClick={() => onPay(m)}
										disabled={memberPending}
										title={
											memberPending
												? "Settle this member's pending logs first"
												: undefined
										}
										className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white ${
											memberPending
												? "cursor-not-allowed bg-slate-300"
												: "bg-indigo-600 hover:bg-indigo-700"
										}`}
									>
										{memberPending ? (
											<Lock className="h-3.5 w-3.5" />
										) : (
											<Wallet className="h-3.5 w-3.5" />
										)}
										Pay {formatMoney(m.amount, m.currency)}
									</button>
								)}
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

function PayoutDetailDrawer({
	teamId,
	payoutId,
	onClose,
}: {
	teamId: string;
	payoutId: string;
	onClose: () => void;
}) {
	const toast = useToast();
	const qc = useQueryClient();

	const detailQuery = useQuery({
		queryKey: ["payout", payoutId],
		queryFn: () => payoutsService.getPayout(payoutId),
	});

	const voidMutation = useMutation({
		mutationFn: () => payoutsService.voidPayout(payoutId),
		onSuccess: () => {
			toast.success("Payout voided. Its logs are back to approved.");
			qc.invalidateQueries({ queryKey: ["payouts", teamId] });
			qc.invalidateQueries({ queryKey: ["payout", payoutId] });
			qc.invalidateQueries({ queryKey: ["team-time", teamId] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const payout = detailQuery.data;

	return (
		<div
			className="fixed inset-0 z-160 flex justify-end bg-slate-900/40"
			onClick={onClose}
		>
			<div
				className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
					<h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
						<Wallet className="h-4 w-4 text-indigo-600" />
						Payout detail
					</h3>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				{detailQuery.isPending || !payout ? (
					<div className="flex flex-1 items-center justify-center">
						<Loader2 className="h-6 w-6 animate-spin text-slate-400" />
					</div>
				) : (
					<div className="flex-1 space-y-4 p-5">
						<div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
							<div className="text-2xl font-bold text-emerald-700">
								{formatMoney(payout.total_amount, payout.currency)}
							</div>
							<div className="mt-1 text-xs text-slate-500">
								Paid to {payoutMemberLabel(payout)} on{" "}
								{DATE_FMT.format(new Date(payout.paid_at))}
							</div>
						</div>

						<dl className="space-y-2 text-xs">
							<Row label="Method">
								{payout.method_type
									? `${METHOD_LABEL[payout.method_type] ?? payout.method_type}${payout.method_label ? ` · ${payout.method_label}` : ""}`
									: "—"}
							</Row>
							<Row label="Account">
								{payout.method_account_name
									? `${payout.method_account_name}${payout.method_account_identifier ? ` · ${payout.method_account_identifier}` : ""}`
									: "—"}
							</Row>
							<Row label="Reference">{payout.reference_number || "—"}</Row>
							<Row label="Note">{payout.note || "—"}</Row>
							<Row label="Status">{payout.status}</Row>
						</dl>

						{payout.proof_path && (
							<ProofPreview
								payoutId={payout.id}
								proofPath={payout.proof_path}
							/>
						)}

						<div>
							<div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
								Logs in this payout ({payout.logs.length})
							</div>
							<div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
								{payout.logs.map((log) => (
									<div
										key={log.id}
										className="flex items-center justify-between px-3 py-2 text-xs"
									>
										<span className="truncate text-slate-700">
											{log.task?.title || log.project?.title || "Log"}
										</span>
										<span className="tabular-nums text-slate-500">
											{((log.duration_seconds ?? 0) / 3600).toFixed(2)}h
										</span>
									</div>
								))}
							</div>
						</div>

						{payout.status === "recorded" && (
							<button
								type="button"
								onClick={() => voidMutation.mutate()}
								disabled={voidMutation.isPending}
								className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
							>
								{voidMutation.isPending ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : (
									<Ban className="h-3.5 w-3.5" />
								)}
								Void payout
							</button>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

function ProofPreview({
	payoutId,
	proofPath,
}: {
	payoutId: string;
	proofPath: string;
}) {
	const isPdf = proofPath.toLowerCase().endsWith(".pdf");
	const urlQuery = useQuery({
		queryKey: ["payout-proof", payoutId],
		queryFn: () => payoutsService.getProofUrl(payoutId),
		staleTime: 4 * 60 * 1000, // presigned URLs are short-lived; refetch periodically
	});

	return (
		<div className="space-y-1.5">
			<div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
				Proof
			</div>
			{urlQuery.isPending ? (
				<div className="flex h-40 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
					<Loader2 className="h-5 w-5 animate-spin text-slate-400" />
				</div>
			) : urlQuery.isError || !urlQuery.data ? (
				<div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
					Couldn't load the proof file.
				</div>
			) : isPdf ? (
				<a
					href={urlQuery.data}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
				>
					<ExternalLink className="h-3.5 w-3.5" />
					Open PDF proof
				</a>
			) : (
				<a
					href={urlQuery.data}
					target="_blank"
					rel="noopener noreferrer"
					title="Open full size"
					className="group block overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
				>
					<img
						src={urlQuery.data}
						alt="Payment proof"
						className="max-h-72 w-full object-contain transition-opacity group-hover:opacity-90"
					/>
				</a>
			)}
		</div>
	);
}

function Row({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex justify-between gap-4">
			<dt className="text-slate-400">{label}</dt>
			<dd className="text-right font-medium text-slate-700">{children}</dd>
		</div>
	);
}
