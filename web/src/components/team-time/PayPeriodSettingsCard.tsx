import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useToast } from "@/hooks/useToast";
import {
	type PayPeriodConfig,
	type PayPeriodDef,
	updateTeam,
} from "@/services/teams.service";
import {
	DEFAULT_PAY_PERIOD_CONFIG,
	payDateLabel,
	resolvePayPeriods,
} from "./log-period";

interface PayPeriodSettingsCardProps {
	teamId: string;
	config?: PayPeriodConfig | null;
	canManage: boolean;
}

function newPeriodId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `p-${crypto.randomUUID().slice(0, 8)}`;
	}
	return `p-${Math.floor(performance.now())}`;
}

/**
 * Owner-only editor for a team's payout cut-off schedule
 * (teams.pay_period_config). Mirrors the retroactive-days / default-currency
 * cards in settings/time.tsx: local draft + Save. A live preview shows the
 * concrete cut-off windows and their pay dates for the current month.
 */
export function PayPeriodSettingsCard({
	teamId,
	config,
	canManage,
}: PayPeriodSettingsCardProps) {
	const toast = useToast();
	const qc = useQueryClient();
	const [draft, setDraft] = useState<PayPeriodDef[]>(
		() => (config ?? DEFAULT_PAY_PERIOD_CONFIG).periods,
	);

	const saveMutation = useMutation({
		mutationFn: (periods: PayPeriodDef[]) =>
			updateTeam(teamId, {
				pay_period_config: { cadence: "monthly", periods },
			}),
		onSuccess: () => {
			toast.success("Cut-off schedule saved");
			qc.invalidateQueries({ queryKey: ["teams", "detail", teamId] });
			qc.invalidateQueries({ queryKey: ["team", teamId] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const resetMutation = useMutation({
		mutationFn: () => updateTeam(teamId, { pay_period_config: null }),
		onSuccess: () => {
			toast.success("Cut-off schedule reset to default");
			setDraft(DEFAULT_PAY_PERIOD_CONFIG.periods);
			qc.invalidateQueries({ queryKey: ["teams", "detail", teamId] });
			qc.invalidateQueries({ queryKey: ["team", teamId] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const previewMonth = useMemo(() => {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
	}, []);
	const preview = useMemo(
		() => resolvePayPeriods({ cadence: "monthly", periods: draft }, previewMonth),
		[draft, previewMonth],
	);

	const updateRow = (index: number, patch: Partial<PayPeriodDef>) =>
		setDraft((rows) =>
			rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
		);
	const removeRow = (index: number) =>
		setDraft((rows) => rows.filter((_, i) => i !== index));
	const addRow = () =>
		setDraft((rows) => [
			...rows,
			{
				id: newPeriodId(),
				label: `Period ${rows.length + 1}`,
				start_day: 1,
				end_day: 15,
				pay_day: 20,
				pay_month_offset: 0,
			},
		]);

	const clampDay = (v: number) => Math.min(31, Math.max(1, Math.round(v) || 1));

	return (
		<div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
			<div className="flex items-start justify-between gap-2">
				<div>
					<p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
						Payout cut-offs
					</p>
					<p className="mt-1 text-xs text-slate-500">
						Define your pay periods and when each is paid. Members and admins pick
						these from the period filter (e.g. “Current cut-off”). Leave as-is to
						use the default semi-monthly schedule.
					</p>
				</div>
			</div>

			<div className="mt-3 space-y-2">
				{/* Header row (desktop) */}
				<div className="hidden grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 sm:grid">
					<span>Label</span>
					<span>Start day</span>
					<span>End day</span>
					<span>Pay day</span>
					<span>Pay month</span>
					<span />
				</div>
				{draft.map((row, i) => (
					<div
						key={row.id}
						className="grid grid-cols-2 items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/60 p-2 sm:grid-cols-[1fr_auto_auto_auto_auto_auto] sm:border-0 sm:bg-transparent sm:p-1"
					>
						<input
							type="text"
							value={row.label}
							disabled={!canManage}
							onChange={(e) => updateRow(i, { label: e.target.value })}
							placeholder="Label"
							className="col-span-2 rounded-md border border-slate-300 px-2 py-1 text-sm sm:col-span-1"
						/>
						<input
							type="number"
							min={1}
							max={31}
							value={row.start_day}
							disabled={!canManage}
							onChange={(e) =>
								updateRow(i, { start_day: clampDay(Number(e.target.value)) })
							}
							className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums"
							aria-label="Start day"
						/>
						<div className="flex items-center gap-1">
							{row.end_day === "EOM" ? (
								<span className="w-16 rounded-md border border-slate-200 bg-slate-100 px-2 py-1 text-center text-xs font-medium text-slate-500">
									EOM
								</span>
							) : (
								<input
									type="number"
									min={1}
									max={31}
									value={row.end_day}
									disabled={!canManage}
									onChange={(e) =>
										updateRow(i, { end_day: clampDay(Number(e.target.value)) })
									}
									className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums"
									aria-label="End day"
								/>
							)}
							<label className="flex items-center gap-1 text-[10px] text-slate-500">
								<input
									type="checkbox"
									disabled={!canManage}
									checked={row.end_day === "EOM"}
									onChange={(e) =>
										updateRow(i, { end_day: e.target.checked ? "EOM" : 15 })
									}
									className="h-3 w-3 rounded border-slate-300"
								/>
								EOM
							</label>
						</div>
						<input
							type="number"
							min={1}
							max={31}
							value={row.pay_day}
							disabled={!canManage}
							onChange={(e) =>
								updateRow(i, { pay_day: clampDay(Number(e.target.value)) })
							}
							className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums"
							aria-label="Pay day"
						/>
						<select
							value={row.pay_month_offset}
							disabled={!canManage}
							onChange={(e) =>
								updateRow(i, { pay_month_offset: Number(e.target.value) })
							}
							className="rounded-md border border-slate-300 px-2 py-1 text-xs"
							aria-label="Pay month"
						>
							<option value={0}>Same month</option>
							<option value={1}>Next month</option>
							<option value={2}>+2 months</option>
						</select>
						<button
							type="button"
							disabled={!canManage || draft.length <= 1}
							onClick={() => removeRow(i)}
							className="justify-self-end rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
							aria-label="Remove period"
						>
							<Trash2 className="h-3.5 w-3.5" />
						</button>
					</div>
				))}
			</div>

			{canManage && (
				<button
					type="button"
					onClick={addRow}
					disabled={draft.length >= 12}
					className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
				>
					<Plus className="h-3.5 w-3.5" />
					Add period
				</button>
			)}

			{/* Live preview for the current month */}
			<div className="mt-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
				<p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
					This month
				</p>
				<ul className="mt-1 space-y-0.5">
					{preview.map((p) => (
						<li
							key={p.id}
							className="flex items-center justify-between gap-3 text-xs text-slate-600"
						>
							<span className="font-medium text-slate-700">
								{p.label}{" "}
								<span className="font-normal text-slate-400">
									({p.dayRangeLabel})
								</span>
							</span>
							<span className="text-emerald-600">
								{payDateLabel(p.payDate.toISOString())}
							</span>
						</li>
					))}
				</ul>
			</div>

			{canManage && (
				<div className="mt-3 flex items-center gap-2">
					<button
						type="button"
						onClick={() => saveMutation.mutate(draft)}
						disabled={saveMutation.isPending}
						className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
					>
						{saveMutation.isPending ? "Saving..." : "Save cut-offs"}
					</button>
					<button
						type="button"
						onClick={() => resetMutation.mutate()}
						disabled={resetMutation.isPending}
						className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
					>
						<RotateCcw className="h-3.5 w-3.5" />
						Reset to default
					</button>
				</div>
			)}
		</div>
	);
}
