import {
	useMutation,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { Calculator, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useToast } from "@/hooks/useToast";
import { formatMoney } from "@/lib/contract-term";
import {
	capsFromRate,
	evenAllocation,
	monthlyRevenue,
	monthlyTeamPool,
	rateFromHours,
} from "@/lib/rate-budget";
import { contractService } from "@/services/contract.service";
import { projectService } from "@/services/project.service";
import {
	createMemberRate,
	getActiveMemberRate,
	type TeamMember,
	type TeamMemberRate,
	updateMemberRate,
} from "@/services/teams.service";

interface MemberRow {
	teamId: string;
	member: TeamMember;
}

interface Props {
	projectId: string;
	rows: MemberRow[];
}

interface Draft {
	/** Monthly budget slice for this member. */
	allocation: string;
	rateType: "hourly" | "fixed";
	hourlyRate: string;
	/** Target monthly hours (drives the rate when the consultant edits it). */
	monthlyHours: string;
	fixedAmount: string;
}

function memberLabel(m: TeamMember): string {
	const composed = [m.user?.first_name, m.user?.last_name]
		.filter(Boolean)
		.join(" ")
		.trim();
	return m.user?.display_name || composed || m.user?.email || m.user_id;
}

/**
 * Sets each member's rate + hour caps FROM the contract budget, on one screen.
 *
 * Pool = monthly revenue (from the contract's billing mode) × the team's split.
 * Each member gets a slice; entering an hourly rate suggests the hour cap that
 * fits the slice, or entering target hours suggests the rate. Saving writes the
 * rate AND the caps to the member's rate row in one call — the single place both
 * are set, so it turns the activation guide's rate/cap items green.
 */
export function RateBudgetCalculator({ projectId, rows }: Props) {
	const toast = useToast();
	const qc = useQueryClient();

	const projectQuery = useQuery({
		queryKey: ["project", projectId],
		queryFn: () => projectService.get(projectId),
	});
	const contractsQuery = useQuery({
		queryKey: ["contracts", projectId],
		queryFn: () => contractService.listByProject(projectId),
	});
	const economicsQuery = useQuery({
		queryKey: ["project", projectId, "economics"],
		queryFn: () => contractService.getEconomics(projectId),
	});

	const contract = useMemo(() => {
		const all = contractsQuery.data ?? [];
		return (
			all.find((c) => c.status === "signed" || c.status === "active") ??
			all[0] ??
			null
		);
	}, [contractsQuery.data]);

	// Each member's active rate on this project (to update vs create + seed defaults).
	const rateQueries = useQueries({
		queries: rows.map((r) => ({
			queryKey: [
				"team",
				r.teamId,
				"rates",
				"active",
				r.member.user_id,
				projectId,
			],
			queryFn: () => getActiveMemberRate(r.teamId, r.member.user_id, projectId),
		})),
	});

	const currency = projectQuery.data?.currency ?? contract?.currency ?? "USD";
	const teamPercent = economicsQuery.data?.team_percent ?? 100;

	// time_based contracts need an expected-hours input to have a monthly figure.
	const [expectedHours, setExpectedHours] = useState("160");

	const revenue = contract
		? monthlyRevenue({
				billingMode: contract.billing_mode,
				recurringFee: contract.recurring_fee,
				clientHourlyRate: contract.client_hourly_rate,
				invoiceCadence: contract.invoice_cadence,
				expectedMonthlyHours: Number(expectedHours) || 0,
			})
		: 0;
	const pool = monthlyTeamPool(revenue, teamPercent);
	const defaultAllocation = evenAllocation(pool, rows.length);

	// Per-member editable draft, seeded from the active rate + even allocation.
	const [drafts, setDrafts] = useState<Record<string, Draft>>({});
	const draftFor = (userId: string, rate: TeamMemberRate | null): Draft =>
		drafts[userId] ?? {
			allocation:
				defaultAllocation > 0 ? String(Math.round(defaultAllocation)) : "",
			rateType: rate?.rate_type ?? "hourly",
			hourlyRate: rate?.hourly_rate ? String(rate.hourly_rate) : "",
			monthlyHours:
				rate?.monthly_limit_hours != null
					? String(rate.monthly_limit_hours)
					: "",
			fixedAmount: rate?.fixed_amount != null ? String(rate.fixed_amount) : "",
		};
	const patchDraft = (userId: string, base: Draft, patch: Partial<Draft>) =>
		setDrafts((prev) => ({ ...prev, [userId]: { ...base, ...patch } }));

	const anyLoading =
		projectQuery.isPending ||
		contractsQuery.isPending ||
		economicsQuery.isPending ||
		rateQueries.some((q) => q.isPending);

	const saveMutation = useMutation({
		mutationFn: async (args: {
			row: MemberRow;
			rate: TeamMemberRate | null;
			draft: Draft;
		}) => {
			const { row, rate, draft } = args;
			const isFixed = draft.rateType === "fixed";
			const caps = isFixed
				? { monthly: null, weekly: null }
				: capsFromRate(
						Number(draft.allocation) || 0,
						Number(draft.hourlyRate) || 0,
					);
			const common = {
				rate_type: draft.rateType,
				fixed_amount: isFixed ? Number(draft.fixedAmount) || 0 : null,
				weekly_limit_hours: caps.weekly,
				monthly_limit_hours: caps.monthly,
			};
			if (rate) {
				return updateMemberRate(row.teamId, row.member.user_id, rate.id, {
					...common,
					hourly_rate: Number(draft.hourlyRate) || 0,
				});
			}
			// No rate yet — create one scoped to this project with sensible defaults.
			// Create (unlike update) takes undefined, not null, to mean "no cap".
			return createMemberRate(row.teamId, row.member.user_id, {
				project_ids: [projectId],
				rate_type: common.rate_type,
				fixed_amount: common.fixed_amount,
				weekly_limit_hours: caps.weekly ?? undefined,
				monthly_limit_hours: caps.monthly ?? undefined,
				hourly_rate: Number(draft.hourlyRate) || 0,
				training_hourly_rate: 0,
				currency,
			});
		},
		onSuccess: (_res, args) => {
			toast.success(`Saved ${memberLabel(args.row.member)}`);
			void qc.invalidateQueries({
				queryKey: [
					"team",
					args.row.teamId,
					"rates",
					"active",
					args.row.member.user_id,
					projectId,
				],
			});
			void qc.invalidateQueries({
				queryKey: ["project", projectId, "activation-checklist"],
			});
		},
		onError: (err: Error) => toast.error(err.message),
	});

	if (anyLoading) {
		return (
			<div className="flex justify-center p-8">
				<Loader2 className="h-5 w-5 animate-spin text-slate-400" />
			</div>
		);
	}

	if (!contract) {
		return (
			<div className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
				Set up the contract and budget split first — the calculator needs them
				to work out the team pool.
			</div>
		);
	}

	return (
		<div className="app-surface-card-strong overflow-hidden rounded-2xl">
			<div className="space-y-4 px-5 py-6">
				<div className="flex items-center gap-2">
					<Calculator className="h-5 w-5 text-slate-700" />
					<h3 className="text-lg font-semibold text-slate-900">
						Rate &amp; budget calculator
					</h3>
				</div>

				{/* Pool summary */}
				<div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
					<PoolStat
						label="Monthly revenue"
						value={formatMoney(currency, revenue)}
					/>
					<PoolStat
						label={`Team pool (${teamPercent}%)`}
						value={formatMoney(currency, pool)}
						strong
					/>
					{contract.billing_mode === "time_based" && (
						<label className="flex items-center gap-1.5 text-xs text-slate-500">
							Expected billable hrs/mo
							<input
								type="number"
								min={0}
								value={expectedHours}
								onChange={(e) => setExpectedHours(e.target.value)}
								className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums"
							/>
						</label>
					)}
				</div>

				<p className="text-xs text-slate-500">
					Enter a member's hourly rate to see the hour cap that fits their
					budget, or enter target monthly hours to get the rate. Saving writes
					the rate and the weekly/monthly caps together.
				</p>

				<div className="overflow-x-auto">
					<table className="w-full min-w-[720px] text-sm">
						<thead className="text-left text-xs uppercase tracking-wide text-slate-500">
							<tr>
								<th className="py-2 pr-3">Member</th>
								<th className="px-3 py-2">Type</th>
								<th className="px-3 py-2 text-right">Allocation/mo</th>
								<th className="px-3 py-2 text-right">Rate</th>
								<th className="px-3 py-2 text-right">Hours/mo</th>
								<th className="px-3 py-2 text-right">Cap wk/mo</th>
								<th className="px-3 py-2" />
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-100">
							{rows.map((row, i) => {
								const rate = rateQueries[i]?.data ?? null;
								const draft = draftFor(row.member.user_id, rate);
								const isFixed = draft.rateType === "fixed";
								const alloc = Number(draft.allocation) || 0;
								const caps = capsFromRate(alloc, Number(draft.hourlyRate) || 0);
								return (
									<tr key={`${row.teamId}:${row.member.user_id}`}>
										<td className="py-2.5 pr-3 font-medium text-slate-800">
											{memberLabel(row.member)}
										</td>
										<td className="px-3 py-2.5">
											<select
												value={draft.rateType}
												onChange={(e) =>
													patchDraft(row.member.user_id, draft, {
														rateType: e.target.value as "hourly" | "fixed",
													})
												}
												className="rounded-md border border-slate-300 px-2 py-1 text-sm"
											>
												<option value="hourly">Hourly</option>
												<option value="fixed">Fixed</option>
											</select>
										</td>
										<td className="px-3 py-2.5 text-right">
											<input
												type="number"
												min={0}
												value={draft.allocation}
												onChange={(e) =>
													patchDraft(row.member.user_id, draft, {
														allocation: e.target.value,
													})
												}
												className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm tabular-nums"
											/>
										</td>
										<td className="px-3 py-2.5 text-right">
											{isFixed ? (
												<input
													type="number"
													min={0}
													placeholder="fixed amt"
													value={draft.fixedAmount}
													onChange={(e) =>
														patchDraft(row.member.user_id, draft, {
															fixedAmount: e.target.value,
														})
													}
													className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm tabular-nums"
												/>
											) : (
												<input
													type="number"
													min={0}
													step="0.01"
													value={draft.hourlyRate}
													onChange={(e) => {
														// Entering a rate re-derives the suggested monthly hours.
														const nextCaps = capsFromRate(
															alloc,
															Number(e.target.value) || 0,
														);
														patchDraft(row.member.user_id, draft, {
															hourlyRate: e.target.value,
															monthlyHours:
																nextCaps.monthly != null
																	? String(nextCaps.monthly)
																	: draft.monthlyHours,
														});
													}}
													className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm tabular-nums"
												/>
											)}
										</td>
										<td className="px-3 py-2.5 text-right">
											{isFixed ? (
												<span className="text-slate-400">—</span>
											) : (
												<input
													type="number"
													min={0}
													step="0.5"
													value={draft.monthlyHours}
													onChange={(e) => {
														// Entering target hours re-derives the rate.
														const nextRate = rateFromHours(
															alloc,
															Number(e.target.value) || 0,
														);
														patchDraft(row.member.user_id, draft, {
															monthlyHours: e.target.value,
															hourlyRate:
																nextRate != null
																	? String(nextRate)
																	: draft.hourlyRate,
														});
													}}
													className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right text-sm tabular-nums"
												/>
											)}
										</td>
										<td className="px-3 py-2.5 text-right text-xs text-slate-500 tabular-nums">
											{isFixed
												? "—"
												: caps.monthly != null
													? `${caps.weekly} / ${caps.monthly}`
													: "—"}
										</td>
										<td className="px-3 py-2.5 text-right">
											<button
												type="button"
												onClick={() =>
													saveMutation.mutate({ row, rate, draft })
												}
												disabled={saveMutation.isPending}
												className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
											>
												Save
											</button>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}

function PoolStat({
	label,
	value,
	strong,
}: {
	label: string;
	value: string;
	strong?: boolean;
}) {
	return (
		<div>
			<p className="text-xs text-slate-500">{label}</p>
			<p
				className={`tabular-nums ${strong ? "text-base font-semibold text-slate-900" : "text-sm text-slate-700"}`}
			>
				{value}
			</p>
		</div>
	);
}
