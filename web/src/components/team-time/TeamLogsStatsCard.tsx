import { History } from "lucide-react";
import type { TaskTimeLog } from "@/services/team-time.service";
import type { TeamMemberRate } from "@/services/teams.service";

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
}

export function TeamLogsStatsCard({
	rate,
	stats,
	fallbackCurrency,
	loading,
	canShowHistory = false,
	onOpenHistory,
}: TeamLogsStatsCardProps) {
	const renderCurrencies =
		stats.currencies.length > 0 ? stats.currencies : [fallbackCurrency];
	const pick = (
		field:
			| "pendingFees"
			| "approvedFees"
			| "paidFees"
			| "rejectedFees"
			| "totalFees",
		cur: string,
	) => stats.buckets[cur]?.[field] ?? 0;
	const columns: {
		label: string;
		values: { currency: string; amount: number }[];
		emphasize?: boolean;
		isHours?: boolean;
	}[] = [
		{
			label: "Balance",
			values: renderCurrencies.map((c) => ({
				currency: c,
				amount: pick("pendingFees", c),
			})),
			emphasize: true,
		},
		{
			label: "Approved",
			values: renderCurrencies.map((c) => ({
				currency: c,
				amount: pick("approvedFees", c),
			})),
		},
		{
			label: "Paid",
			values: renderCurrencies.map((c) => ({
				currency: c,
				amount: pick("paidFees", c),
			})),
		},
		{
			label: "Rejected",
			values: renderCurrencies.map((c) => ({
				currency: c,
				amount: pick("rejectedFees", c),
			})),
		},
		{
			label: "All works",
			values: renderCurrencies.map((c) => ({
				currency: c,
				amount: pick("totalFees", c),
			})),
		},
		{
			label: "Total hours",
			values: [{ currency: "h", amount: stats.totalHours }],
			isHours: true,
		},
	];

	return (
		<div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-200 px-3 py-2 text-xs">
				{rate ? (
					<>
						{rate.custom_id ? (
							<span className="inline-flex items-center gap-1.5 text-sm">
								<span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
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
							<span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
								Work
							</span>
							<span className="text-sm font-semibold text-slate-900">
								{Number(rate.hourly_rate).toFixed(2)} {rate.currency || "USD"}
								<span className="font-normal text-slate-500">/hr</span>
							</span>
						</span>
						<span className="inline-flex items-center gap-1.5">
							<span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
								Training
							</span>
							<span className="text-sm font-semibold text-slate-900">
								{Number(rate.training_hourly_rate).toFixed(2)}{" "}
								{rate.currency || "USD"}
								<span className="font-normal text-slate-500">/hr</span>
							</span>
						</span>
						{rate.start_date && (
							<span className="text-slate-400">
								since {formatRateDate(rate.start_date)}
							</span>
						)}
					</>
				) : (
					<span className="italic text-slate-400">No active rate</span>
				)}
				{canShowHistory && onOpenHistory && (
					<button
						type="button"
						onClick={onOpenHistory}
						className="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
					>
						<History className="h-3.5 w-3.5" />
						History
					</button>
				)}
			</div>

			<div className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
				<table className="w-full min-w-[640px] border-collapse text-xs">
					<thead>
						<tr className="bg-slate-50 text-slate-600">
							<th className="w-20 border-r border-slate-200 px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
								&nbsp;
							</th>
							{columns.map((col) => (
								<th
									key={col.label}
									className="border-r border-slate-200 px-3 py-1.5 text-right text-[11px] font-semibold last:border-r-0"
								>
									{col.label}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						<tr className="border-t border-slate-200 bg-white">
							<th className="border-r border-slate-200 px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-700">
								Totals
							</th>
							{columns.map((col) => (
								<td
									key={col.label}
									className={`border-r border-slate-200 px-3 py-2 text-right tabular-nums last:border-r-0 align-top ${
										col.emphasize
											? "font-bold text-slate-900"
											: "text-slate-700"
									}`}
								>
									{loading ? (
										<span>—</span>
									) : (
										<div className="flex flex-col items-end gap-0.5">
											{col.values.map((v) => (
												<span key={v.currency}>
													{v.amount.toFixed(2)}
													{col.isHours ? " h" : ` ${v.currency}`}
												</span>
											))}
										</div>
									)}
								</td>
							))}
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	);
}
