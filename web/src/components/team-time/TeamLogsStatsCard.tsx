import { History, Wallet } from "lucide-react";
import type { TaskTimeLog } from "@/services/team-time.service";
import type { TeamMemberRate } from "@/services/teams.service";
import { formatMoney } from "./time-utils";

type Bucket = {
	pendingFees: number;
	approvedFees: number;
	paidFees: number;
	rejectedFees: number;
	totalFees: number;
};

export type LogStats = {
	buckets: Record<string, Bucket>;
	currencies: string[];
	totalHours: number;
};

/** Zero-state stats — used as a fallback while a summary query is loading. */
export const EMPTY_LOG_STATS: LogStats = {
	buckets: {},
	currencies: [],
	totalHours: 0,
};

export function computeLogStats(logs: TaskTimeLog[]): LogStats {
	const buckets: Record<string, Bucket> = {};
	let totalSeconds = 0;
	const ensureBucket = (cur: string) => {
		if (!buckets[cur]) {
			buckets[cur] = {
				pendingFees: 0,
				approvedFees: 0,
				paidFees: 0,
				rejectedFees: 0,
				totalFees: 0,
			};
		}
		return buckets[cur];
	};
	for (const log of logs) {
		const seconds = log.duration_seconds ?? 0;
		if (seconds > 0) totalSeconds += seconds;
		const rate = Number(log.rate_snapshot ?? 0);
		if (!Number.isFinite(rate) || rate <= 0 || seconds <= 0) continue;
		const fees = (seconds / 3600) * rate;
		const cur = log.currency_snapshot || "USD";
		const bucket = ensureBucket(cur);
		bucket.totalFees += fees;
		if (log.status === "pending") bucket.pendingFees += fees;
		else if (log.status === "approved") bucket.approvedFees += fees;
		else if (log.status === "paid") bucket.paidFees += fees;
		else if (log.status === "rejected") bucket.rejectedFees += fees;
	}
	return {
		buckets,
		currencies: Object.keys(buckets).sort(),
		totalHours: totalSeconds / 3600,
	};
}

function formatRateDate(value?: string | null) {
	if (!value) return "—";
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return value;
	return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
		parsed,
	);
}

interface TeamLogsStatsCardProps {
	rate: TeamMemberRate | null;
	stats: LogStats;
	fallbackCurrency: string;
	loading: boolean;
	canShowHistory?: boolean;
	onOpenHistory?: () => void;
	includePaidColumn?: boolean;
	includeTrainingRate?: boolean;
	rateLabel?: string;
}

type SegKey = "pending" | "approved" | "paid" | "rejected";

interface Segment {
	key: SegKey;
	label: string;
	amount: number;
	bar: string;
	dot: string;
	text: string;
}

const SEGMENT_STYLES: Record<
	SegKey,
	{ label: string; bar: string; dot: string; text: string }
> = {
	pending: {
		label: "Pending",
		bar: "bg-amber-400",
		dot: "bg-amber-400",
		text: "text-amber-700",
	},
	approved: {
		label: "Approved",
		bar: "bg-emerald-500",
		dot: "bg-emerald-500",
		text: "text-emerald-700",
	},
	paid: {
		label: "Paid",
		bar: "bg-indigo-500",
		dot: "bg-indigo-500",
		text: "text-indigo-700",
	},
	rejected: {
		label: "Rejected",
		bar: "bg-rose-400",
		dot: "bg-rose-400",
		text: "text-rose-700",
	},
};

function CurrencyReport({
	currency,
	bucket,
	includePaid,
}: {
	currency: string;
	bucket: Bucket;
	includePaid: boolean;
}) {
	const segments: Segment[] = (
		[
			{ key: "pending", amount: bucket.pendingFees },
			{ key: "approved", amount: bucket.approvedFees },
			...(includePaid
				? [{ key: "paid" as const, amount: bucket.paidFees }]
				: []),
			{ key: "rejected", amount: bucket.rejectedFees },
		] as { key: SegKey; amount: number }[]
	).map((s) => ({ ...SEGMENT_STYLES[s.key], key: s.key, amount: s.amount }));

	const total = segments.reduce((sum, s) => sum + s.amount, 0);
	// Billable = approved + paid (confirmed billable work). Pending is not yet
	// billable and rejected is non-billable, so neither counts toward it.
	const billable = bucket.approvedFees + bucket.paidFees;
	// Outstanding = approved but not yet paid — billable money still owed.
	const outstanding = bucket.approvedFees;

	return (
		<div className="px-4 py-4 sm:px-5">
			{/* Hero row: billable (approved + paid) + outstanding (approved) */}
			<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
				<div>
					<div
						className="text-[10px] font-semibold uppercase tracking-wider text-slate-400"
						title="Approved + paid — the confirmed billable amount. Pending is not yet billable; rejected is non-billable."
					>
						Billable · {currency}
					</div>
					<div className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900">
						{formatMoney(billable, currency)}
					</div>
				</div>
				<div className="text-right">
					<div
						className="text-[10px] font-semibold uppercase tracking-wider text-slate-400"
						title="Approved but not yet paid — billable money still owed."
					>
						Outstanding
					</div>
					<div className="mt-0.5 text-lg font-semibold tabular-nums text-amber-700">
						{formatMoney(outstanding, currency)}
					</div>
				</div>
			</div>

			{/* Composition bar */}
			<div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
				{total > 0 &&
					segments.map((s) =>
						s.amount > 0 ? (
							<div
								key={s.key}
								className={s.bar}
								style={{ width: `${(s.amount / total) * 100}%` }}
								title={`${s.label}: ${formatMoney(s.amount, currency)}`}
							/>
						) : null,
					)}
			</div>

			{/* Legend breakdown */}
			<div className="mt-3.5 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-4">
				{segments.map((s) => {
					const pct = total > 0 ? Math.round((s.amount / total) * 100) : 0;
					return (
						<div key={s.key} className="min-w-0">
							<div className="flex items-center gap-1.5">
								<span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
								<span className="truncate text-[11px] font-medium text-slate-500">
									{s.label}
								</span>
								<span className="ml-auto text-[10px] tabular-nums text-slate-400">
									{pct}%
								</span>
							</div>
							<div
								className={`mt-0.5 pl-3.5 text-sm font-semibold tabular-nums ${s.text}`}
							>
								{formatMoney(s.amount, currency)}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

export function TeamLogsStatsCard({
	rate,
	stats,
	fallbackCurrency,
	loading,
	canShowHistory = false,
	onOpenHistory,
	includePaidColumn = true,
	includeTrainingRate = true,
	rateLabel = "Work",
}: TeamLogsStatsCardProps) {
	const renderCurrencies =
		stats.currencies.length > 0 ? stats.currencies : [fallbackCurrency];
	const emptyBucket: Bucket = {
		pendingFees: 0,
		approvedFees: 0,
		paidFees: 0,
		rejectedFees: 0,
		totalFees: 0,
	};

	return (
		<div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
			{/* Rate header */}
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5 text-xs sm:px-5">
				<span className="inline-flex items-center gap-1.5 text-slate-400">
					<Wallet className="h-3.5 w-3.5" />
				</span>
				{rate ? (
					<>
						{rate.custom_id ? (
							<span className="inline-flex items-center gap-1.5">
								<span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
									ID
								</span>
								<span className="font-mono font-semibold text-slate-900">
									{rate.custom_id}
								</span>
							</span>
						) : (
							<span className="italic text-slate-400">No ID</span>
						)}
						<span className="inline-flex items-center gap-1.5">
							<span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
								{rateLabel}
							</span>
							<span className="text-sm font-semibold text-slate-900">
								{Number(rate.hourly_rate).toFixed(2)} {rate.currency || "USD"}
								<span className="font-normal text-slate-400">/hr</span>
							</span>
						</span>
						{includeTrainingRate && (
							<span className="inline-flex items-center gap-1.5">
								<span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
									Training
								</span>
								<span className="text-sm font-semibold text-slate-900">
									{Number(rate.training_hourly_rate).toFixed(2)}{" "}
									{rate.currency || "USD"}
									<span className="font-normal text-slate-400">/hr</span>
								</span>
							</span>
						)}
						{rate.start_date && (
							<span className="text-slate-400">
								since {formatRateDate(rate.start_date)}
							</span>
						)}
					</>
				) : (
					<span className="italic text-slate-400"></span>
				)}
				<span className="ml-auto inline-flex items-center gap-1.5">
					<span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
						Total hours
					</span>
					{loading ? (
						<span className="inline-block h-4 w-12 animate-pulse rounded bg-slate-200" />
					) : (
						<span className="text-sm font-semibold tabular-nums text-sky-700">
							{stats.totalHours.toFixed(2)} h
						</span>
					)}
					{canShowHistory && onOpenHistory && (
						<button
							type="button"
							onClick={onOpenHistory}
							className="ml-2 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
						>
							<History className="h-3.5 w-3.5" />
							History
						</button>
					)}
				</span>
			</div>

			{/* Balance report */}
			{loading ? (
				<div className="space-y-3 px-4 py-4 sm:px-5">
					<div className="h-8 w-40 animate-pulse rounded bg-slate-100" />
					<div className="h-2.5 w-full animate-pulse rounded-full bg-slate-100" />
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						{[0, 1, 2, 3].map((i) => (
							<div
								key={i}
								className="h-9 animate-pulse rounded bg-slate-100"
							/>
						))}
					</div>
				</div>
			) : (
				<div className="divide-y divide-slate-100">
					{renderCurrencies.map((cur) => (
						<CurrencyReport
							key={cur}
							currency={cur}
							bucket={stats.buckets[cur] ?? emptyBucket}
							includePaid={includePaidColumn}
						/>
					))}
				</div>
			)}
		</div>
	);
}
