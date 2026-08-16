import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserMinus } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import {
	AppSectionHeader,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { AutosaveIndicator } from "@/components/common/FormFields";
import { useAutosave } from "@/hooks/useAutosave";
import {
	useProjectMembersQuery,
	useProjectRemoveMemberMutation,
} from "@/hooks/useProjectQueries";
import {
	type ProjectRosterRow,
	rosterMemberLabel,
	useProjectRoster,
} from "@/hooks/useProjectRoster";
import { useToast } from "@/hooks/useToast";
import { formatMoney } from "@/lib/contract-term";
import {
	evenAllocation,
	monthlyRevenue,
	monthlyTeamPool,
} from "@/lib/rate-budget";
import {
	type AllocationMode,
	contractService,
	type ProjectMemberAllocation,
} from "@/services/contract.service";
import { projectService } from "@/services/project.service";

/**
 * Company margin, the team pool, and how that pool divides between members.
 *
 * This used to be step 4 of the contract builder, which was the wrong home for
 * it: contracts get built on screen shares WITH the client, and the client must
 * never see what the agency keeps. It lives in Financials now, behind a
 * consultant/admin gate.
 */

const rowKey = (r: { teamId: string; userId: string }) =>
	`${r.teamId}:${r.userId}`;

export function BudgetSplitPanel({ projectId }: { projectId: string }) {
	const qc = useQueryClient();
	const toast = useToast();
	const companyPercentId = useId();

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
	const { rows, isPending: rosterPending } = useProjectRoster(projectId);

	const contract = useMemo(() => {
		const all = contractsQuery.data ?? [];
		return all.find((c) => c.status === "signed") ?? all[0] ?? null;
	}, [contractsQuery.data]);

	const economics = economicsQuery.data ?? null;
	const currency = contract?.currency ?? projectQuery.data?.currency ?? "USD";

	const [companyPercent, setCompanyPercent] = useState("40");
	const [mode, setMode] = useState<AllocationMode>("equal");
	/** Per-member amounts, keyed `teamId:userId`. Only meaningful in custom mode. */
	const [custom, setCustom] = useState<Record<string, string>>({});
	const [seeded, setSeeded] = useState(false);

	// Seed once the server value lands. Re-seeding on every economics change
	// would fight the consultant's typing mid-edit.
	useEffect(() => {
		if (!economics || seeded) return;
		setCompanyPercent(String(economics.company_percent));
		setMode(economics.allocation_mode);
		setCustom(
			Object.fromEntries(
				economics.allocations.map((a) => [
					rowKey({ teamId: a.team_id, userId: a.user_id }),
					a.monthly_allocation == null ? "" : String(a.monthly_allocation),
				]),
			),
		);
		setSeeded(true);
	}, [economics, seeded]);

	const company = Number(companyPercent);
	const team = Number.isFinite(company) ? 100 - company : 0;
	const validSplit = Number.isFinite(company) && company >= 0 && company <= 100;

	// time_based revenue depends on hours actually logged, so there is no
	// up-front monthly figure to divide — the split still applies, per invoice.
	const revenue = contract
		? monthlyRevenue({
				billingMode: contract.billing_mode,
				recurringFee: contract.recurring_fee,
				clientHourlyRate: contract.client_hourly_rate,
				invoiceCadence: contract.invoice_cadence,
			})
		: 0;
	const pool = monthlyTeamPool(revenue, team);
	const evenShare = evenAllocation(pool, rows.length);

	const amountFor = (row: ProjectRosterRow): number => {
		if (mode === "equal") return evenShare;
		const raw =
			custom[rowKey({ teamId: row.teamId, userId: row.member.user_id })];
		return Number(raw) || 0;
	};

	const allocated = rows.reduce((sum, r) => sum + amountFor(r), 0);
	const remaining = pool - allocated;

	const allocationsPayload = (): ProjectMemberAllocation[] =>
		rows.map((r) => ({
			team_id: r.teamId,
			user_id: r.member.user_id,
			monthly_allocation: mode === "equal" ? null : amountFor(r),
		}));

	// The roster is part of the key: removing a member has to re-persist the
	// remaining slices, or the removed person keeps drawing from the pool.
	const memberKeys = rows
		.map((r) => rowKey({ teamId: r.teamId, userId: r.member.user_id }))
		.join(",");

	const saveStatus = useAutosave(
		{ company, team, mode, custom, memberKeys },
		async () => {
			await contractService.updateEconomics(projectId, {
				company_percent: company,
				team_percent: team,
				currency,
				allocation_mode: mode,
				allocations: allocationsPayload(),
			});
			void qc.invalidateQueries({
				queryKey: ["project", projectId, "economics"],
			});
		},
		{
			enabled: validSplit && seeded && !rosterPending,
			onError: (err) => toast.error(err.message),
		},
	);

	const removeMember = useProjectRemoveMemberMutation(projectId);
	// removeMember takes the project_access ROW id, not the user id — the roster
	// is keyed by user, so it has to be translated before the call.
	const membersQuery = useProjectMembersQuery(projectId);
	const accessRowIdFor = (userId: string): string | undefined =>
		membersQuery.data?.find((m) => m.user_id === userId)?.id;

	if (economicsQuery.isPending || contractsQuery.isPending) {
		return (
			<AppSurfaceCard className="p-6">
				<div className="flex justify-center py-8">
					<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
				</div>
			</AppSurfaceCard>
		);
	}

	return (
		<AppSurfaceCard className="p-6">
			<AppSectionHeader
				kicker="Internal"
				title="Budget split"
				subtitle="How each period's revenue divides between company margin and the pool that pays the team. The client never sees this."
			/>

			{/* Company vs team */}
			<div className="mt-5 flex flex-wrap items-end gap-4">
				<div>
					<label
						htmlFor={companyPercentId}
						className="mb-1.5 block text-xs font-semibold text-muted-foreground"
					>
						Company %
					</label>
					<input
						id={companyPercentId}
						type="number"
						min={0}
						max={100}
						step="1"
						value={companyPercent}
						onChange={(e) => setCompanyPercent(e.target.value)}
						className="w-28 rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
					/>
				</div>
				<div className="text-sm text-muted-foreground">
					Team pool:{" "}
					<span className="font-semibold text-foreground">{team}%</span>
					{pool > 0 && (
						<>
							{" · "}
							<span className="font-semibold text-foreground">
								{formatMoney(currency, pool)}
							</span>{" "}
							per month
						</>
					)}
				</div>
			</div>
			{!validSplit && (
				<p className="mt-3 text-xs text-destructive">
					Company % must be between 0 and 100.
				</p>
			)}

			{contract?.billing_mode === "time_based" && (
				<p className="mt-4 text-xs text-muted-foreground">
					This contract bills by the hour, so the monthly pool depends on
					approved hours. The split still applies to whatever each period
					actually invoices.
				</p>
			)}

			{/* Per-member allocation */}
			<div className="mt-7 border-t border-border pt-6">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h3 className="text-sm font-semibold text-foreground">
							Who the pool pays
						</h3>
						<p className="mt-0.5 text-xs text-muted-foreground">
							Hours are never truly equal — switch to a custom split to weight
							the slices.
						</p>
					</div>
					<SplitModeToggle
						value={mode}
						onChange={(next) => {
							// Materialise the derived even amounts so switching to custom
							// starts from what's on screen rather than from zero.
							if (next === "custom") {
								setCustom(
									Object.fromEntries(
										rows.map((r) => [
											rowKey({ teamId: r.teamId, userId: r.member.user_id }),
											String(Math.round(evenShare)),
										]),
									),
								);
							}
							setMode(next);
						}}
					/>
				</div>

				{rosterPending ? (
					<div className="flex justify-center py-6">
						<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
					</div>
				) : rows.length === 0 ? (
					<p className="mt-4 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
						No members on this project yet. Attach a team and add members from
						the Team page.
					</p>
				) : (
					<>
						<AllocationBar
							rows={rows}
							amountFor={amountFor}
							pool={pool}
							currency={currency}
						/>

						<ul className="mt-4 divide-y divide-border">
							{rows.map((row) => {
								const key = rowKey({
									teamId: row.teamId,
									userId: row.member.user_id,
								});
								return (
									<li
										key={key}
										className="flex flex-wrap items-center gap-3 py-2.5"
									>
										<span className="min-w-0 flex-1 truncate text-sm text-foreground">
											{rosterMemberLabel(row.member)}
											{row.member.position && (
												<span className="ml-2 text-xs text-muted-foreground">
													{row.member.position}
												</span>
											)}
										</span>
										{mode === "custom" ? (
											<input
												type="number"
												min={0}
												step="1"
												aria-label={`Monthly budget for ${rosterMemberLabel(row.member)}`}
												value={custom[key] ?? ""}
												onChange={(e) =>
													setCustom((prev) => ({
														...prev,
														[key]: e.target.value,
													}))
												}
												className="w-32 rounded-lg border border-input bg-card px-3 py-1.5 text-right text-sm tabular-nums text-card-foreground shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
											/>
										) : (
											<span className="w-32 text-right text-sm font-semibold tabular-nums text-foreground">
												{formatMoney(currency, evenShare)}
											</span>
										)}
										<button
											type="button"
											title="Remove from the project"
											aria-label={`Remove ${rosterMemberLabel(row.member)} from the project`}
											disabled={
												removeMember.isPending ||
												!accessRowIdFor(row.member.user_id)
											}
											onClick={() => {
												const accessRowId = accessRowIdFor(row.member.user_id);
												if (!accessRowId) return;
												if (
													!window.confirm(
														`Remove ${rosterMemberLabel(row.member)} from this project? They lose access and their tasks are unassigned. Their pool slice is redistributed.`,
													)
												) {
													return;
												}
												removeMember.mutate(accessRowId, {
													onSuccess: () =>
														toast.success("Removed from project"),
													onError: (err) => toast.error((err as Error).message),
												});
											}}
											className="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
										>
											<UserMinus className="h-4 w-4" />
										</button>
									</li>
								);
							})}
						</ul>

						{pool > 0 && (
							<p
								className={`mt-3 text-xs ${
									remaining < -0.01
										? "font-semibold text-destructive"
										: "text-muted-foreground"
								}`}
							>
								{remaining < -0.01
									? `Over-allocated by ${formatMoney(currency, Math.abs(remaining))} — the slices exceed the pool.`
									: `${formatMoney(currency, remaining)} of the pool still unallocated.`}
							</p>
						)}
					</>
				)}
			</div>

			<AutosaveIndicator status={saveStatus} />
		</AppSurfaceCard>
	);
}

/** Equal vs hand-tuned. */
function SplitModeToggle({
	value,
	onChange,
}: {
	value: AllocationMode;
	onChange: (mode: AllocationMode) => void;
}) {
	const options: Array<{ mode: AllocationMode; label: string }> = [
		{ mode: "equal", label: "Split equally" },
		{ mode: "custom", label: "Custom split" },
	];
	return (
		<div className="inline-flex rounded-lg border border-border p-0.5 text-xs font-medium">
			{options.map((o) => (
				<button
					key={o.mode}
					type="button"
					onClick={() => onChange(o.mode)}
					className={`rounded-md px-2.5 py-1 transition ${
						value === o.mode
							? "bg-primary text-primary-foreground"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

/**
 * One stacked bar showing how the pool is carved up, plus what's left.
 *
 * A meter, not a chart — it answers "is this fully allocated?" at a glance,
 * which a pie chart of five near-equal slices does not. Theme tokens only.
 */
function AllocationBar({
	rows,
	amountFor,
	pool,
	currency,
}: {
	rows: ProjectRosterRow[];
	amountFor: (row: ProjectRosterRow) => number;
	pool: number;
	currency: string;
}) {
	if (!(pool > 0)) return null;
	const allocated = rows.reduce((sum, r) => sum + amountFor(r), 0);
	const over = allocated > pool;
	// Over-allocated: scale against the total so the overflow is visible rather
	// than silently clipped at 100%.
	const denominator = over ? allocated : pool;

	return (
		<div className="mt-4">
			<div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
				{rows.map((row, i) => {
					const amount = amountFor(row);
					if (!(amount > 0)) return null;
					return (
						<div
							key={`${row.teamId}:${row.member.user_id}`}
							title={`${rosterMemberLabel(row.member)} — ${formatMoney(currency, amount)}`}
							style={{ width: `${(amount / denominator) * 100}%` }}
							className={
								over
									? "bg-destructive"
									: i % 2 === 0
										? "bg-primary"
										: "bg-primary/70"
							}
						/>
					);
				})}
			</div>
		</div>
	);
}
