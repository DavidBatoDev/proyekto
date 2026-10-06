import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useToast } from "@/hooks/useToast";
import { isPlanLimitError } from "@/lib/planLimitErrors";
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

export const PAY_PERIOD_COPY = {
	title: "Billing and pay cut-offs",
	description:
		"The cut-off periods this team bills hours and pays people by, and when each is paid. They show up in the report's period filter (“Current cut-off”). Leave as is to use the default semi-monthly schedule.",
	saved: "Cut-offs saved",
	resetDone: "Cut-offs reset to the default",
	save: "Save cut-offs",
	saving: "Saving…",
	reset: "Reset to default",
	addPeriod: "Add period",
	thisMonth: "This month",
} as const;

interface PayPeriodSettingsCardProps {
	teamId: string;
	config?: PayPeriodConfig | null;
	/** The team owner (the backend keeps `pay_period_config` owner-only). */
	canManage: boolean;
	/**
	 * The plan notice shown when the team's workspace has neither
	 * `time_billable_invoices` nor `time_payouts` (L14, D39). While it is set
	 * the schedule is read-only, whoever is looking.
	 */
	planNotice?: ReactNode;
}

function newPeriodId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return `p-${crypto.randomUUID().slice(0, 8)}`;
	}
	return `p-${Math.floor(performance.now())}`;
}

/**
 * "Billing and pay cut-offs" (ux.md › Team Override, L14): the team's cut-off
 * schedule (teams.pay_period_config), which serves both hourly invoices and
 * payouts. The owner edits it when the team's workspace plan has either
 * feature; otherwise it reads only, under `planNotice`. Local draft + Save, in
 * the same flat section shell as the rest of Team settings › Time, with a live
 * preview of this month's concrete windows and their pay dates.
 */
export function PayPeriodSettingsCard({
	teamId,
	config,
	canManage,
	planNotice,
}: PayPeriodSettingsCardProps) {
	const toast = useToast();
	const qc = useQueryClient();
	const editable = canManage && !planNotice;
	const [draft, setDraft] = useState<PayPeriodDef[]>(
		() => (config ?? DEFAULT_PAY_PERIOD_CONFIG).periods,
	);

	const onError = (e: Error) => {
		// The plan prompt is raised globally (api/axios notifyPlanLimit).
		if (isPlanLimitError(e)) return;
		toast.error(e.message);
	};

	const saveMutation = useMutation({
		mutationFn: (periods: PayPeriodDef[]) =>
			updateTeam(teamId, {
				pay_period_config: { cadence: "monthly", periods },
			}),
		onSuccess: () => {
			toast.success(PAY_PERIOD_COPY.saved);
			qc.invalidateQueries({ queryKey: ["teams", "detail", teamId] });
			qc.invalidateQueries({ queryKey: ["team", teamId] });
		},
		onError,
	});

	const resetMutation = useMutation({
		mutationFn: () => updateTeam(teamId, { pay_period_config: null }),
		onSuccess: () => {
			toast.success(PAY_PERIOD_COPY.resetDone);
			setDraft(DEFAULT_PAY_PERIOD_CONFIG.periods);
			qc.invalidateQueries({ queryKey: ["teams", "detail", teamId] });
			qc.invalidateQueries({ queryKey: ["team", teamId] });
		},
		onError,
	});

	const previewMonth = useMemo(() => {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
	}, []);
	const preview = useMemo(
		() =>
			resolvePayPeriods({ cadence: "monthly", periods: draft }, previewMonth),
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
		<section data-testid="pay-period-settings" aria-labelledby="pay-cutoffs">
			<div>
				<p
					id="pay-cutoffs"
					className="text-sm font-medium leading-5 text-foreground"
				>
					{PAY_PERIOD_COPY.title}
				</p>
				<p className="mt-0.5 max-w-xl text-xs leading-relaxed text-muted-foreground">
					{PAY_PERIOD_COPY.description}
				</p>
			</div>

			{planNotice ? <div className="mt-3">{planNotice}</div> : null}

			<div className="mt-3 space-y-2">
				{/* Header row (desktop) */}
				<div className="hidden grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
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
						className="grid grid-cols-2 items-center gap-2 rounded-lg border border-border bg-muted/60 p-2 sm:grid-cols-[1fr_auto_auto_auto_auto_auto] sm:border-0 sm:bg-transparent sm:p-1"
					>
						<input
							type="text"
							value={row.label}
							disabled={!editable}
							onChange={(e) => updateRow(i, { label: e.target.value })}
							placeholder="Label"
							aria-label="Label"
							className="col-span-2 rounded-md border border-border bg-background px-2 py-1 text-sm sm:col-span-1"
						/>
						<input
							type="number"
							min={1}
							max={31}
							value={row.start_day}
							disabled={!editable}
							onChange={(e) =>
								updateRow(i, {
									start_day: clampDay(Number(e.target.value)),
								})
							}
							className="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums"
							aria-label="Start day"
						/>
						<div className="flex items-center gap-1">
							{row.end_day === "EOM" ? (
								<span className="w-16 rounded-md border border-border bg-muted px-2 py-1 text-center text-xs font-medium text-muted-foreground">
									EOM
								</span>
							) : (
								<input
									type="number"
									min={1}
									max={31}
									value={row.end_day}
									disabled={!editable}
									onChange={(e) =>
										updateRow(i, {
											end_day: clampDay(Number(e.target.value)),
										})
									}
									className="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums"
									aria-label="End day"
								/>
							)}
							<label className="flex items-center gap-1 text-[10px] text-muted-foreground">
								<input
									type="checkbox"
									disabled={!editable}
									checked={row.end_day === "EOM"}
									onChange={(e) =>
										updateRow(i, { end_day: e.target.checked ? "EOM" : 15 })
									}
									className="h-3 w-3 rounded border-border"
								/>
								EOM
							</label>
						</div>
						<input
							type="number"
							min={1}
							max={31}
							value={row.pay_day}
							disabled={!editable}
							onChange={(e) =>
								updateRow(i, { pay_day: clampDay(Number(e.target.value)) })
							}
							className="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums"
							aria-label="Pay day"
						/>
						<select
							value={row.pay_month_offset}
							disabled={!editable}
							onChange={(e) =>
								updateRow(i, { pay_month_offset: Number(e.target.value) })
							}
							className="rounded-md border border-border bg-background px-2 py-1 text-xs"
							aria-label="Pay month"
						>
							<option value={0}>Same month</option>
							<option value={1}>Next month</option>
							<option value={2}>+2 months</option>
						</select>
						{editable ? (
							<button
								type="button"
								disabled={draft.length <= 1}
								onClick={() => removeRow(i)}
								className="justify-self-end rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
								aria-label="Remove period"
							>
								<Trash2 className="h-3.5 w-3.5" />
							</button>
						) : (
							<span />
						)}
					</div>
				))}
			</div>

			{editable && (
				<button
					type="button"
					onClick={addRow}
					disabled={draft.length >= 12}
					className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
				>
					<Plus className="h-3.5 w-3.5" />
					{PAY_PERIOD_COPY.addPeriod}
				</button>
			)}

			{/* Live preview for the current month */}
			<div className="mt-3 rounded-md border border-border bg-muted px-3 py-2">
				<p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
					{PAY_PERIOD_COPY.thisMonth}
				</p>
				<ul className="mt-1 space-y-0.5">
					{preview.map((p) => (
						<li
							key={p.id}
							className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
						>
							<span className="font-medium text-foreground">
								{p.label}{" "}
								<span className="font-normal text-muted-foreground">
									({p.dayRangeLabel})
								</span>
							</span>
							<span className="text-success-foreground">
								{payDateLabel(p.payDate.toISOString())}
							</span>
						</li>
					))}
				</ul>
			</div>

			{editable && (
				<div className="mt-3 flex flex-wrap items-center gap-2">
					<button
						type="button"
						onClick={() => saveMutation.mutate(draft)}
						disabled={saveMutation.isPending}
						className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
					>
						{saveMutation.isPending
							? PAY_PERIOD_COPY.saving
							: PAY_PERIOD_COPY.save}
					</button>
					<button
						type="button"
						onClick={() => resetMutation.mutate()}
						disabled={resetMutation.isPending}
						className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-60"
					>
						<RotateCcw className="h-3.5 w-3.5" />
						{PAY_PERIOD_COPY.reset}
					</button>
				</div>
			)}
		</section>
	);
}
