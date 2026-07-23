import { AlertTriangle, Clock } from "lucide-react";
import { useMemo } from "react";
import type { TaskTimeLog } from "@/services/team-time.service";

interface WindowStat {
	window: "weekly" | "monthly";
	limit: number;
	logged: number;
	over: boolean;
}

/**
 * Compact hour-cap summary for a member: shows logged vs. limit for whichever
 * capped windows their logs fall in, derived from each log's `limit_context`
 * (computed server-side). Amber when close, red when over. Renders nothing
 * when no rate has an hour cap.
 */
export function HourCapBanner({ logs }: { logs: TaskTimeLog[] }) {
	const stats = useMemo<WindowStat[]>(() => {
		// For each capped window, keep the reading with the most logged hours
		// (the most complete view of the current window across the loaded logs).
		const best = new Map<"weekly" | "monthly", WindowStat>();
		for (const log of logs) {
			const ctx = log.limit_context;
			if (!ctx || !ctx.limit_window || ctx.limit_hours == null) continue;
			const logged = ctx.logged_hours_in_window ?? 0;
			const prev = best.get(ctx.limit_window);
			if (!prev || logged > prev.logged) {
				best.set(ctx.limit_window, {
					window: ctx.limit_window,
					limit: ctx.limit_hours,
					logged,
					over: ctx.over_limit,
				});
			}
		}
		return Array.from(best.values());
	}, [logs]);

	if (stats.length === 0) return null;

	return (
		<div className="flex flex-wrap gap-2">
			{stats.map((s) => {
				const remaining = s.limit - s.logged;
				const ratio = s.limit > 0 ? s.logged / s.limit : 0;
				const tone = s.over
					? "border-rose-200 bg-rose-50 text-rose-700"
					: ratio >= 0.85
						? "border-amber-200 bg-amber-50 text-amber-800"
						: "border-slate-200 bg-white text-slate-600";
				return (
					<div
						key={s.window}
						className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${tone}`}
					>
						{s.over ? (
							<AlertTriangle className="h-3.5 w-3.5" />
						) : (
							<Clock className="h-3.5 w-3.5" />
						)}
						<span className="capitalize">{s.window}</span>
						<span className="tabular-nums">
							{s.logged.toFixed(1)} / {s.limit.toFixed(0)}h
						</span>
						<span className="tabular-nums opacity-80">
							{s.over
								? `${Math.abs(remaining).toFixed(1)}h over`
								: `${remaining.toFixed(1)}h left`}
						</span>
					</div>
				);
			})}
		</div>
	);
}
