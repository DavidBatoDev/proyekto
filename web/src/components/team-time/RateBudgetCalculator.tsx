import {
	useMutation,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Calculator, Info, Link2, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useToast } from "@/hooks/useToast";
import { formatMoney } from "@/lib/contract-term";
import {
	capsFromMonthlyHours,
	capsFromRate,
	evenAllocation,
	monthlyRevenue,
	monthlyTeamPool,
	rateFromHours,
	WEEKS_PER_MONTH,
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

function fmtHrs(n: number): string {
	return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
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
		return all.find((c) => c.status === "signed") ?? all[0] ?? null;
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

	// The contract is what the client is actually billed in, and these rates are
	// carved out of that contract's pool — so it wins over the project-level
	// default. Same precedence as the invoice builder.
	const currency = contract?.currency ?? projectQuery.data?.currency ?? "USD";
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
	const evenShare = evenAllocation(pool, rows.length);

	/**
	 * This member's slice of the pool, as SAVED in Financials. Read-only here —
	 * the budget is set there now, and this screen turns it into a rate and a
	 * cap. In 'equal' mode nothing is stored per member, so the even share is
	 * derived instead.
	 */
	const allocationFor = (teamId: string, userId: string): number => {
		const economics = economicsQuery.data;
		if (!economics) return 0;
		if (economics.allocation_mode === "equal") return evenShare;
		const match = economics.allocations.find(
			(a) => a.team_id === teamId && a.user_id === userId,
		);
		return Number(match?.monthly_allocation ?? 0);
	};

	// Per-member editable draft, seeded from the active rate. Keyed by TEAM AND
	// user: the same person can be on two attached teams with different rates,
	// and keying by user alone made them share one draft.
	const [drafts, setDrafts] = useState<Record<string, Draft>>({});
	const draftFor = (key: string, rate: TeamMemberRate | null): Draft =>
		drafts[key] ?? {
			rateType: rate?.rate_type ?? "hourly",
			hourlyRate: rate?.hourly_rate ? String(rate.hourly_rate) : "",
			monthlyHours:
				rate?.monthly_limit_hours != null
					? String(rate.monthly_limit_hours)
					: "",
			fixedAmount: rate?.fixed_amount != null ? String(rate.fixed_amount) : "",
		};
	const patchDraft = (key: string, base: Draft, patch: Partial<Draft>) =>
		setDrafts((prev) => ({ ...prev, [key]: { ...base, ...patch } }));

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
			// `team_member_rates_fixed_amount_check` requires a positive amount on
			// every fixed row. Catch it here so a blank field reads as a field
			// error instead of a raw Postgres constraint message.
			if (isFixed && !(Number(draft.fixedAmount) > 0)) {
				throw new Error(
					"Enter the fixed monthly amount before saving this member.",
				);
			}
			// A member with a budget slice derives the cap from allocation ÷ rate;
			// one without uses the hour cap entered directly. The slice now comes
			// from Financials rather than an editable field on this screen.
			const allocation = allocationFor(row.teamId, row.member.user_id);
			const caps = isFixed
				? { monthly: null, weekly: null }
				: allocation > 0
					? capsFromRate(allocation, Number(draft.hourlyRate) || 0)
					: capsFromMonthlyHours(Number(draft.monthlyHours) || 0);
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
			<div className="space-y-5 px-5 py-6">
				<div className="flex items-center gap-2">
					<Calculator className="h-5 w-5 text-slate-700" />
					<h3 className="text-lg font-semibold text-slate-900">
						Rate &amp; budget calculator
					</h3>
				</div>

				<HowItWorks />

				<PoolFormula
					currency={currency}
					revenue={revenue}
					teamPercent={teamPercent}
					pool={pool}
					memberCount={rows.length}
					each={evenShare}
					showExpectedHours={contract.billing_mode === "time_based"}
					expectedHours={expectedHours}
					onExpectedHoursChange={setExpectedHours}
				/>

				{/* Per-member cards */}
				<div className="space-y-3">
					{rows.map((row, i) => {
						const rate = rateQueries[i]?.data ?? null;
						const key = `${row.teamId}:${row.member.user_id}`;
						const draft = draftFor(key, rate);
						return (
							<MemberCard
								key={key}
								currency={currency}
								label={memberLabel(row.member)}
								position={row.member.position ?? null}
								avatarUrl={row.member.user?.avatar_url ?? null}
								allocation={allocationFor(row.teamId, row.member.user_id)}
								projectId={projectId}
								draft={draft}
								onPatch={(patch) => patchDraft(key, draft, patch)}
								onSave={() => saveMutation.mutate({ row, rate, draft })}
								saving={saveMutation.isPending}
							/>
						);
					})}
				</div>
			</div>
		</div>
	);
}

/* ── How it works ─────────────────────────────────────────────────────────── */

function HowItWorks() {
	return (
		<div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600">
			<div className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-700">
				<Info className="h-4 w-4 text-blue-600" />
				How this works
			</div>
			<p>
				<span className="font-semibold text-slate-700">Team pool</span> =
				monthly revenue × the team's split. Divided evenly, each member gets a{" "}
				<span className="font-semibold text-slate-700">monthly budget</span>{" "}
				(you can adjust each slice).
			</p>
			<p>
				<span className="font-semibold text-slate-700">Hourly members:</span>{" "}
				<code className="rounded bg-white px-1 py-0.5 font-mono text-[11px] text-slate-700 ring-1 ring-slate-200">
					budget ÷ rate = monthly hour cap
				</code>{" "}
				(weekly cap = monthly ÷ {WEEKS_PER_MONTH.toFixed(2)} weeks). Type a rate
				to get the cap, or type target hours to get the rate — the two stay
				linked.
			</p>
			<p>
				<span className="font-semibold text-slate-700">Fixed members:</span> the
				budget is a flat monthly amount — no hour cap.
			</p>
			<p>
				The <span className="font-semibold text-slate-700">monthly budget</span>{" "}
				is optional — switch it off for a member to set their rate and hour cap
				directly, without tying them to a pool slice.
			</p>
			<p className="text-slate-400">
				Saving writes the member's rate and the weekly + monthly caps together.
			</p>
		</div>
	);
}

/* ── Pool formula strip ───────────────────────────────────────────────────── */

function PoolFormula({
	currency,
	revenue,
	teamPercent,
	pool,
	memberCount,
	each,
	showExpectedHours,
	expectedHours,
	onExpectedHoursChange,
}: {
	currency: string;
	revenue: number;
	teamPercent: number;
	pool: number;
	memberCount: number;
	each: number;
	showExpectedHours: boolean;
	expectedHours: string;
	onExpectedHoursChange: (v: string) => void;
}) {
	return (
		<div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5">
			<div className="flex flex-wrap items-end gap-x-3 gap-y-3">
				<PoolTerm
					label="Monthly revenue"
					value={formatMoney(currency, revenue)}
				/>
				<Op>×</Op>
				<PoolTerm label="Team split" value={`${teamPercent}%`} />
				<Op>=</Op>
				<PoolTerm
					label="Team pool"
					value={formatMoney(currency, pool)}
					strong
				/>
				<Op>÷</Op>
				<PoolTerm label="Members" value={String(memberCount)} />
				<Op>=</Op>
				<PoolTerm
					label="Budget each"
					value={formatMoney(currency, each)}
					strong
				/>
			</div>

			{showExpectedHours && (
				<div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
					<label className="flex items-center gap-2 text-xs text-slate-500">
						<span className="font-medium text-slate-600">
							Expected billable hrs / month
						</span>
						<input
							type="number"
							min={0}
							value={expectedHours}
							onChange={(e) => onExpectedHoursChange(e.target.value)}
							className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm tabular-nums outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
						/>
					</label>
					<span className="text-[11px] text-slate-400">
						This contract bills hourly, so revenue = client rate × these hours.
					</span>
				</div>
			)}
		</div>
	);
}

function PoolTerm({
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
			<p className="text-[11px] uppercase tracking-wide text-slate-400">
				{label}
			</p>
			<p
				className={`tabular-nums ${
					strong
						? "text-base font-bold text-slate-900"
						: "text-sm font-medium text-slate-700"
				}`}
			>
				{value}
			</p>
		</div>
	);
}

function Op({ children }: { children: string }) {
	return (
		<span className="pb-0.5 text-lg font-semibold text-slate-300 select-none">
			{children}
		</span>
	);
}

/* ── Member card ──────────────────────────────────────────────────────────── */

function MemberCard({
	currency,
	label,
	position,
	avatarUrl,
	allocation,
	projectId,
	draft,
	onPatch,
	onSave,
	saving,
}: {
	currency: string;
	label: string;
	position: string | null;
	avatarUrl: string | null;
	/** This member's saved slice of the pool. Set in Financials, read-only here. */
	allocation: number;
	projectId: string;
	draft: Draft;
	onPatch: (patch: Partial<Draft>) => void;
	onSave: () => void;
	saving: boolean;
}) {
	const isFixed = draft.rateType === "fixed";
	const alloc = allocation;
	const useBudget = alloc > 0;
	const fixedVal = Number(draft.fixedAmount) || 0;
	// A fixed row without a positive amount is rejected by the DB check
	// constraint, so hold the save until it's filled in.
	const fixedIncomplete = isFixed && fixedVal <= 0;
	const rateVal = Number(draft.hourlyRate) || 0;
	const hoursVal = Number(draft.monthlyHours) || 0;
	// The cap shown/saved: derived from the budget when the member has a slice,
	// otherwise taken straight from the entered monthly hours.
	const caps = useBudget
		? capsFromRate(alloc, rateVal)
		: capsFromMonthlyHours(hoursVal);

	return (
		<div className="rounded-xl border border-slate-200 bg-white p-4">
			{/* Header: identity + type toggle */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2.5">
					{avatarUrl ? (
						<img
							src={avatarUrl}
							alt={label}
							className="h-8 w-8 shrink-0 rounded-full object-cover"
						/>
					) : (
						<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold uppercase text-slate-600">
							{label.trim().charAt(0) || "?"}
						</div>
					)}
					<div className="min-w-0">
						<div className="truncate text-sm font-semibold text-slate-800">
							{label}
						</div>
						{position && (
							<div className="truncate text-[11px] text-slate-500">
								{position}
							</div>
						)}
					</div>
				</div>

				<TypeToggle
					value={draft.rateType}
					onChange={(rateType) =>
						onPatch({
							rateType,
							// Switching to fixed with a budget slice already set: that
							// slice IS the flat monthly pay (see HowItWorks), so seed it
							// rather than making the consultant retype the same number.
							...(rateType === "fixed" && !draft.fixedAmount && alloc > 0
								? { fixedAmount: String(alloc) }
								: {}),
						})
					}
				/>
			</div>

			{/* Fields */}
			<div className="mt-4 grid gap-x-4 gap-y-3 sm:grid-cols-3">
				<Field
					label="Monthly budget"
					help={
						useBudget
							? "This member's slice of the team pool — set in Financials"
							: "No slice yet — set the rate and hours directly"
					}
					action={
						<Link
							to="/marketplace/finance"
							search={{ tab: "overview", projectId }}
							className="text-[11px] font-semibold text-blue-600 hover:underline"
						>
							Edit split
						</Link>
					}
				>
					{useBudget ? (
						<div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-semibold tabular-nums text-slate-700">
							{formatMoney(currency, alloc)}
						</div>
					) : (
						<div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-400">
							Not tied to a budget
						</div>
					)}
				</Field>

				{isFixed ? (
					<Field
						label="Fixed monthly amount"
						help="Flat pay — no hour cap applies"
					>
						<AdornedInput
							prefix={currency}
							value={draft.fixedAmount}
							onChange={(v) => onPatch({ fixedAmount: v })}
						/>
					</Field>
				) : (
					<>
						<Field label="Hourly rate" help="What this member costs per hour">
							<AdornedInput
								prefix={currency}
								suffix="/hr"
								step="0.01"
								value={draft.hourlyRate}
								onChange={(v) => {
									// With a budget, entering a rate re-derives the hour cap.
									// Untied, the rate stands alone.
									if (!useBudget) {
										onPatch({ hourlyRate: v });
										return;
									}
									const next = capsFromRate(alloc, Number(v) || 0);
									onPatch({
										hourlyRate: v,
										monthlyHours:
											next.monthly != null
												? String(next.monthly)
												: draft.monthlyHours,
									});
								}}
							/>
						</Field>
						<Field
							label="Monthly hours"
							help={
								useBudget ? "Hour cap this budget buys" : "Hour cap per month"
							}
							hint={useBudget}
						>
							<AdornedInput
								suffix="hrs"
								step="0.5"
								value={draft.monthlyHours}
								onChange={(v) => {
									// With a budget, target hours re-derive the rate. Untied,
									// the hours are the cap outright.
									if (!useBudget) {
										onPatch({ monthlyHours: v });
										return;
									}
									const nextRate = rateFromHours(alloc, Number(v) || 0);
									onPatch({
										monthlyHours: v,
										hourlyRate:
											nextRate != null ? String(nextRate) : draft.hourlyRate,
									});
								}}
							/>
						</Field>
					</>
				)}
			</div>

			{/* Result / formula line */}
			<div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
				{isFixed ? (
					fixedIncomplete ? (
						<p className="text-xs text-amber-600">
							Enter the fixed monthly amount to save this member.
						</p>
					) : (
						<p className="text-xs text-slate-500">
							Paid{" "}
							<span className="font-semibold text-slate-700">
								{formatMoney(currency, fixedVal)}
							</span>{" "}
							per month · no hour cap.
						</p>
					)
				) : useBudget ? (
					caps.monthly != null ? (
						<p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
							<span className="tabular-nums text-slate-500">
								{formatMoney(currency, alloc)} ÷{" "}
								{formatMoney(currency, rateVal)}
								/hr
							</span>
							<span className="text-slate-300">=</span>
							<span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-semibold tabular-nums text-slate-800">
								{fmtHrs(caps.monthly)} hrs / mo cap
							</span>
							<span className="text-slate-400">
								(≈ {fmtHrs(caps.weekly ?? 0)} hrs / wk)
							</span>
						</p>
					) : (
						<p className="text-xs text-slate-400">
							Enter a budget and a rate (or target hours) to see the hour cap.
						</p>
					)
				) : caps.monthly != null ? (
					<p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
						<span className="text-slate-500">Cap set to</span>
						<span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-semibold tabular-nums text-slate-800">
							{fmtHrs(caps.monthly)} hrs / mo
						</span>
						<span className="text-slate-400">
							(≈ {fmtHrs(caps.weekly ?? 0)} hrs / wk)
						</span>
					</p>
				) : (
					<p className="text-xs text-slate-400">
						No hour cap — this member's logged hours aren't limited.
					</p>
				)}

				<button
					type="button"
					onClick={onSave}
					disabled={saving || fixedIncomplete}
					title={
						fixedIncomplete ? "Fixed members need a monthly amount" : undefined
					}
					className="shrink-0 rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-40"
				>
					{saving ? "Saving…" : "Save rate + caps"}
				</button>
			</div>
		</div>
	);
}

/* ── Small field primitives ───────────────────────────────────────────────── */

function TypeToggle({
	value,
	onChange,
}: {
	value: "hourly" | "fixed";
	onChange: (v: "hourly" | "fixed") => void;
}) {
	return (
		<div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium">
			{(["hourly", "fixed"] as const).map((t) => (
				<button
					key={t}
					type="button"
					onClick={() => onChange(t)}
					className={`rounded-md px-3 py-1 capitalize transition ${
						value === t
							? "bg-white text-slate-900 shadow-sm"
							: "text-slate-500 hover:text-slate-700"
					}`}
				>
					{t}
				</button>
			))}
		</div>
	);
}

function Field({
	label,
	help,
	hint,
	action,
	children,
}: {
	label: string;
	help?: string;
	/** Marks the field as one half of the linked rate↔hours pair. */
	hint?: boolean;
	/** Optional control shown right-aligned in the label row (e.g. a switch). */
	action?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div>
			<div className="flex items-center justify-between gap-2">
				<span className="flex items-center gap-1 text-xs font-semibold text-slate-600">
					{label}
					{hint && <Link2 className="h-3 w-3 text-slate-400" />}
				</span>
				{action}
			</div>
			<div className="mt-1">{children}</div>
			{help && <p className="mt-1 text-[11px] text-slate-400">{help}</p>}
		</div>
	);
}

function AdornedInput({
	prefix,
	suffix,
	value,
	onChange,
	step,
}: {
	prefix?: string;
	suffix?: string;
	value: string;
	onChange: (v: string) => void;
	step?: string;
}) {
	return (
		<div className="flex items-center rounded-lg border border-slate-300 bg-white transition focus-within:border-slate-400 focus-within:ring-2 focus-within:ring-slate-900/10">
			{prefix && (
				<span className="pl-2.5 text-[11px] font-medium text-slate-400">
					{prefix}
				</span>
			)}
			<input
				type="number"
				min={0}
				step={step}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className="w-full bg-transparent px-2 py-1.5 text-sm tabular-nums outline-none"
			/>
			{suffix && (
				<span className="pr-2.5 text-[11px] font-medium text-slate-400">
					{suffix}
				</span>
			)}
		</div>
	);
}
