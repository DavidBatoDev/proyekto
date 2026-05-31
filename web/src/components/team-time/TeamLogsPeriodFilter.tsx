import { useEffect, useMemo, useState } from "react";
import {
	type CutoffHalf,
	type LogPeriodPreset,
	type TeamLogResolvedPeriod,
	cutoffLabel,
} from "./log-period";

interface TeamLogsPeriodFilterProps {
	period: TeamLogResolvedPeriod;
	onPresetChange: (preset: LogPeriodPreset) => void;
	onCutoffMonthChange: (month: string) => void;
	onCutoffHalfChange: (half: CutoffHalf) => void;
	onApplyCustomRange: (fromDate: string, toDate: string) => void;
}

export function TeamLogsPeriodFilter({
	period,
	onPresetChange,
	onCutoffMonthChange,
	onCutoffHalfChange,
	onApplyCustomRange,
}: TeamLogsPeriodFilterProps) {
	const [customFrom, setCustomFrom] = useState(period.customFromDate);
	const [customTo, setCustomTo] = useState(period.customToDate);

	useEffect(() => {
		setCustomFrom(period.customFromDate);
		setCustomTo(period.customToDate);
	}, [period.customFromDate, period.customToDate]);

	const rangeLabel = useMemo(() => {
		const start = new Date(period.fromIso);
		const end = new Date(period.toIso);
		if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
			return "Invalid period";
		}
		const fmt = new Intl.DateTimeFormat(undefined, {
			month: "short",
			day: "numeric",
			year: "numeric",
		});
		return `${fmt.format(start)} - ${fmt.format(end)}`;
	}, [period.fromIso, period.toIso]);

	return (
		<div className="space-y-3 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
			<div className="flex flex-wrap items-center gap-3">
				<div className="inline-flex items-center rounded-lg bg-slate-100 p-0.5">
					{([
						{ id: "this_week", label: "This week" },
						{ id: "this_month", label: "This month" },
						{ id: "cutoff", label: "Cutoff" },
						{ id: "custom", label: "Custom" },
					] as const).map((item) => {
						const active = period.preset === item.id;
						return (
							<button
								key={item.id}
								type="button"
								onClick={() => onPresetChange(item.id)}
								className={
									active
										? "rounded-md bg-white px-3 py-1 text-xs font-medium text-slate-900 shadow-sm"
										: "rounded-md px-3 py-1 text-xs font-medium text-slate-500 hover:text-slate-700"
								}
							>
								{item.label}
							</button>
						);
					})}
				</div>
				<span className="text-xs font-medium text-slate-600">{rangeLabel}</span>
			</div>

			{period.preset === "cutoff" && (
				<div className="flex flex-wrap items-center gap-3">
					<label className="inline-flex items-center gap-2 text-xs text-slate-600">
						<span className="font-semibold uppercase tracking-wide text-slate-500">
							Month
						</span>
						<input
							type="month"
							value={period.cutoffMonth}
							onChange={(e) => onCutoffMonthChange(e.target.value)}
							className="rounded-md border border-slate-300 px-2 py-1 text-xs"
						/>
					</label>
					<div className="inline-flex items-center rounded-lg bg-slate-100 p-0.5">
						{(["1", "2"] as const).map((half) => {
							const active = period.cutoffHalf === half;
							return (
								<button
									key={half}
									type="button"
									onClick={() => onCutoffHalfChange(half)}
									className={
										active
											? "rounded-md bg-white px-3 py-1 text-xs font-medium text-slate-900 shadow-sm"
											: "rounded-md px-3 py-1 text-xs font-medium text-slate-500 hover:text-slate-700"
									}
									title={cutoffLabel(period.cutoffMonth, half)}
								>
									{half === "1" ? "1-15" : "16-EOM"}
								</button>
							);
						})}
					</div>
					<span className="text-xs text-slate-500">
						{cutoffLabel(period.cutoffMonth, period.cutoffHalf)}
					</span>
				</div>
			)}

			{period.preset === "custom" && (
				<div className="flex flex-wrap items-end gap-2">
					<label className="space-y-1 text-xs">
						<span className="font-semibold uppercase tracking-wide text-slate-500">
							From
						</span>
						<input
							type="date"
							value={customFrom}
							onChange={(e) => setCustomFrom(e.target.value)}
							className="block rounded-md border border-slate-300 px-2 py-1 text-xs"
						/>
					</label>
					<label className="space-y-1 text-xs">
						<span className="font-semibold uppercase tracking-wide text-slate-500">
							To
						</span>
						<input
							type="date"
							value={customTo}
							onChange={(e) => setCustomTo(e.target.value)}
							className="block rounded-md border border-slate-300 px-2 py-1 text-xs"
						/>
					</label>
					<button
						type="button"
						onClick={() => onApplyCustomRange(customFrom, customTo)}
						className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
					>
						Apply
					</button>
				</div>
			)}
		</div>
	);
}
