import { useQuery } from "@tanstack/react-query";
import { Loader2, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import {
	AppSectionHeader,
	AppStatCard,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { BudgetSplitPanel } from "@/components/financials/BudgetSplitPanel";
import {
	MarginTrendChart,
	RevenueCostChart,
} from "@/components/financials/FinancialsCharts";
import { formatCurrency } from "@/lib/currency";
import {
	financialsService,
	type ProjectFinancials,
} from "@/services/financials.service";

export function ProjectFinancials({ projectId }: { projectId: string }) {
	const financialsQuery = useQuery({
		queryKey: ["project", projectId, "financials"],
		queryFn: () => financialsService.getProjectFinancials(projectId),
	});
	const fin = financialsQuery.data;

	return (
		<div className="w-full py-6">
			<AppSurfaceCard strong className="mb-6 p-6">
				<AppSectionHeader
					kicker="Finance"
					title="Financials"
					subtitle="Is this project profitable? Revenue from invoices, cost from logged time, and how the margin splits."
				/>
			</AppSurfaceCard>

			{financialsQuery.isPending ? (
				<Center>
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</Center>
			) : fin ? (
				<FinancialsBody fin={fin} />
			) : null}

			<div className="mt-6">
				<BudgetSplitPanel projectId={projectId} />
			</div>
		</div>
	);
}

function FinancialsBody({ fin }: { fin: ProjectFinancials }) {
	const { totals, currency } = fin;
	const positive = totals.margin >= 0;
	const marginPct = totals.margin_percent;

	return (
		<div className="space-y-6">
			{/* Scorecards */}
			<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
				<AppStatCard
					label="Revenue"
					value={formatCurrency(totals.revenue, currency)}
					icon={Wallet}
				/>
				<AppStatCard
					label="Cost"
					value={formatCurrency(totals.cost, currency)}
				/>
				<AppStatCard
					label="Margin"
					value={formatCurrency(totals.margin, currency)}
					icon={positive ? TrendingUp : TrendingDown}
				/>
				<AppStatCard
					label="Margin %"
					value={marginPct == null ? "—" : `${marginPct}%`}
				/>
			</div>

			{/* Verdict */}
			<div
				className={`rounded-xl border px-4 py-3 text-sm font-medium ${
					marginPct == null
						? "border-border bg-muted/40 text-muted-foreground"
						: positive
							? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
							: "border-rose-500/30 bg-rose-500/10 text-rose-700"
				}`}
			>
				{verdict(fin)}
			</div>

			{/* Charts */}
			<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
				<AppSurfaceCard className="p-5">
					<h3 className="mb-3 text-sm font-semibold text-foreground">
						Revenue vs cost
					</h3>
					<RevenueCostChart months={fin.months} currency={currency} />
				</AppSurfaceCard>
				<AppSurfaceCard className="p-5">
					<h3 className="mb-3 text-sm font-semibold text-foreground">
						Margin % trend
					</h3>
					<MarginTrendChart months={fin.months} />
				</AppSurfaceCard>
			</div>

			{/* Economics split */}
			<AppSurfaceCard className="p-5">
				<h3 className="text-sm font-semibold text-foreground">
					Budget split ({fin.economics.company_percent}% company /{" "}
					{fin.economics.team_percent}% team)
				</h3>
				<dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4 text-sm">
					<Split
						label="Company share"
						value={formatCurrency(totals.company_share, currency)}
					/>
					<Split
						label="Team pool"
						value={formatCurrency(totals.team_pool, currency)}
					/>
					<Split
						label="Team burn"
						value={formatCurrency(totals.team_burn, currency)}
					/>
					<Split
						label="Pool remaining"
						value={formatCurrency(totals.pool_remaining, currency)}
						warn={totals.pool_remaining < 0}
					/>
				</dl>
			</AppSurfaceCard>

			{/* Other currencies */}
			{fin.by_currency.length > 1 && (
				<AppSurfaceCard className="p-5">
					<h3 className="text-sm font-semibold text-foreground">
						Other currencies
					</h3>
					<p className="mt-1 text-xs text-muted-foreground">
						Amounts are never converted across currencies. The headline above is
						in {currency}.
					</p>
					<ul className="mt-3 space-y-1 text-sm">
						{fin.by_currency
							.filter((c) => c.currency !== currency)
							.map((c) => (
								<li key={c.currency} className="flex justify-between">
									<span className="text-muted-foreground">{c.currency}</span>
									<span className="tabular-nums text-foreground">
										{formatCurrency(c.revenue, c.currency)} rev ·{" "}
										{formatCurrency(c.margin, c.currency)} margin
									</span>
								</li>
							))}
					</ul>
				</AppSurfaceCard>
			)}
		</div>
	);
}

function verdict(fin: ProjectFinancials): string {
	const { totals } = fin;
	if (totals.revenue === 0 && totals.cost === 0) {
		return "No revenue or cost recorded yet — issue an invoice and log some time to see profitability.";
	}
	if (totals.margin_percent == null) {
		return `Cost of ${formatCurrency(totals.cost, fin.currency)} with no invoiced revenue yet.`;
	}
	const state =
		totals.margin >= 0
			? `Profitable at ${totals.margin_percent}%`
			: `Running at a loss (${totals.margin_percent}%)`;
	const pool =
		totals.pool_remaining < 0
			? ` Team burn has exceeded the ${formatCurrency(totals.team_pool, fin.currency)} pool by ${formatCurrency(-totals.pool_remaining, fin.currency)}.`
			: "";
	return `${state} — ${formatCurrency(totals.margin, fin.currency)} margin on ${formatCurrency(totals.revenue, fin.currency)} revenue.${pool}`;
}

function Split({
	label,
	value,
	warn,
}: {
	label: string;
	value: string;
	warn?: boolean;
}) {
	return (
		<div>
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd
				className={`mt-0.5 font-semibold tabular-nums ${warn ? "text-rose-600" : "text-foreground"}`}
			>
				{value}
			</dd>
		</div>
	);
}

function Center({ children }: { children: React.ReactNode }) {
	return <div className="flex justify-center py-16">{children}</div>;
}
