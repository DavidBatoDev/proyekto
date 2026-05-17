import { createPortal } from "react-dom";
import { useMemo } from "react";
import type { TaskTimeLog } from "@/services/team-time.service";
import { liveDurationSecondsFromLog, useLiveNowMs } from "./time-utils";

interface NumericStats {
	count: number;
	sum: number;
	avg: number;
	min: number;
	max: number;
}

function computeStats(values: number[]): NumericStats {
	const count = values.length;
	const sum = values.reduce((a, b) => a + b, 0);
	return {
		count,
		sum,
		avg: count > 0 ? sum / count : 0,
		min: count > 0 ? Math.min(...values) : 0,
		max: count > 0 ? Math.max(...values) : 0,
	};
}

function fmt2(n: number): string {
	return n.toFixed(2);
}

function StatRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between gap-4">
			<span className="text-slate-500 text-[10px] uppercase tracking-wide shrink-0">
				{label}
			</span>
			<span className="text-black text-[11px] font-semibold tabular-nums">
				{value}
			</span>
		</div>
	);
}

interface CellSelectionScoreboardProps {
	selectedCells: Set<string>;
	logs: TaskTimeLog[];
	ownRateByProjectId?: Record<string, { hourly_rate: number; currency: string }>;
}

export function CellSelectionScoreboard({
	selectedCells,
	logs,
	ownRateByProjectId,
}: CellSelectionScoreboardProps) {
	const logById = useMemo(() => {
		const m = new Map<string, TaskTimeLog>();
		for (const log of logs) m.set(log.id, log);
		return m;
	}, [logs]);

	// Subscribe to live timer only when any selected log is running
	const hasRunningSelected = useMemo(() => {
		for (const key of selectedCells) {
			const rowId = key.split(":")[0];
			const log = logById.get(rowId);
			if (log && !log.ended_at) return true;
		}
		return false;
	}, [selectedCells, logById]);

	const nowMs = useLiveNowMs(hasRunningSelected);

	const { cellCount, hoursStats, feesByCurrency } = useMemo(() => {
		const hoursValues: number[] = [];
		// fees grouped by currency
		const feeMap = new Map<string, number[]>();

		for (const key of selectedCells) {
			const [rowId, colId] = key.split(":");
			const log = logById.get(rowId);
			if (!log) continue;

			if (colId === "hours_worked") {
				const h = liveDurationSecondsFromLog(log, nowMs) / 3600;
				hoursValues.push(h);
			} else if (colId === "fees") {
				const snap = Number(log.rate_snapshot ?? 0);
				const fallback = ownRateByProjectId?.[log.project_id];
				const hourly = snap > 0 ? snap : fallback ? Number(fallback.hourly_rate) : null;
				if (hourly !== null && Number.isFinite(hourly)) {
					const h = liveDurationSecondsFromLog(log, nowMs) / 3600;
					const fee = h * hourly;
					const currency =
						log.currency_snapshot || fallback?.currency || "USD";
					const existing = feeMap.get(currency) ?? [];
					existing.push(fee);
					feeMap.set(currency, existing);
				}
			}
		}

		return {
			cellCount: selectedCells.size,
			hoursStats: hoursValues.length > 0 ? computeStats(hoursValues) : null,
			feesByCurrency:
				feeMap.size > 0
					? Array.from(feeMap.entries()).map(([currency, values]) => ({
							currency,
							stats: computeStats(values),
						}))
					: null,
		};
	}, [selectedCells, logById, nowMs, ownRateByProjectId]);

	if (selectedCells.size === 0) return null;

	return createPortal(
		<div
			className="fixed top-4 right-4 z-50 min-w-[220px] max-w-[280px] rounded-xl border border-black bg-white shadow-lg p-3 space-y-3"
			style={{ pointerEvents: "none" }}
		>
			{/* Header */}
			<div className="flex items-center justify-between border-b border-black pb-2">
				<span className="text-[11px] font-bold text-black uppercase tracking-widest">
					Selection
				</span>
				<span className="text-[10px] text-slate-500">
					{cellCount} {cellCount === 1 ? "cell" : "cells"}
				</span>
			</div>

			{/* Hours stats */}
			{hoursStats && (
				<div className="space-y-1.5">
					<p className="text-[10px] font-semibold text-sky-600 uppercase tracking-wide">
						Hours
					</p>
					<StatRow label="Count" value={String(hoursStats.count)} />
					<StatRow label="Sum" value={fmt2(hoursStats.sum)} />
					<StatRow label="Avg" value={fmt2(hoursStats.avg)} />
					<StatRow label="Min" value={fmt2(hoursStats.min)} />
					<StatRow label="Max" value={fmt2(hoursStats.max)} />
				</div>
			)}

			{/* Fees stats (per currency) */}
			{feesByCurrency &&
				feesByCurrency.map(({ currency, stats }) => (
					<div key={currency} className="space-y-1.5">
						<p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide">
							Fees ({currency})
						</p>
						<StatRow label="Count" value={String(stats.count)} />
						<StatRow label="Sum" value={fmt2(stats.sum)} />
						<StatRow label="Avg" value={fmt2(stats.avg)} />
						<StatRow label="Min" value={fmt2(stats.min)} />
						<StatRow label="Max" value={fmt2(stats.max)} />
					</div>
				))}

			{/* Show cell count only when no numeric stats */}
			{!hoursStats && !feesByCurrency && (
				<StatRow label="Count" value={String(cellCount)} />
			)}
		</div>,
		document.body,
	);
}
