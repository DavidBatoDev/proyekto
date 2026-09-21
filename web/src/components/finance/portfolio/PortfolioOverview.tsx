import { AlertTriangle, ArrowUpRight, TrendingUp, Wallet } from "lucide-react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import { formatCurrency } from "@/lib/currency";
import { financeToneTextClass } from "@/lib/finance-status";
import type {
	FinanceAging,
	FinanceCurrencyTotals,
	FinancePortfolio,
	FinanceProject,
} from "@/services/finance.service";
import {
	countLabel,
	FinanceLoading,
	FinanceSectionHeading,
	FinanceStatusBadge,
	formatFinanceDate,
	NoFinanceData,
} from "./FinancePrimitives";

const AGING_BANDS: Array<{ key: keyof FinanceAging; label: string }> = [
	{ key: "current", label: "Not due" },
	{ key: "d1_30", label: "1–30 days" },
	{ key: "d31_60", label: "31–60 days" },
	{ key: "d61_plus", label: "60+ days" },
];

export function PortfolioOverview({
	loading,
	portfolio,
	onOpen,
}: {
	loading: boolean;
	portfolio?: FinancePortfolio;
	onOpen: (projectId: string) => void;
}) {
	if (loading) return <FinanceLoading />;
	if (!portfolio) return <NoFinanceData />;

	const overdueTotals = portfolio.totals_by_currency.filter(
		(total) => total.overdue_amount > 0,
	);

	/*
	 * An empty portfolio keeps the overview scaffold. Collapsing the whole
	 * section to a bare empty state made the page look broken next to the
	 * Contracts and Invoices tabs, which keep their headings; only the slots
	 * that cannot render without data get a placeholder.
	 */
	return (
		<div className="space-y-5 pb-8">
			<FinanceSectionHeading
				eyebrow="Portfolio overview"
				title="Project performance"
				description="Compare billed revenue, delivery cost, and margin without mixing currencies."
			/>

			{overdueTotals.length > 0 && <OverdueBanner totals={overdueTotals} />}

			{portfolio.totals_by_currency.length > 0 ? (
				<div className="grid gap-4 lg:grid-cols-2">
					{portfolio.totals_by_currency.map((total) => (
						<CurrencyCard key={total.currency} total={total} />
					))}
				</div>
			) : (
				<NoFinanceData
					title="No billing activity yet"
					description="Margin, receivables ageing, and currency totals appear here once a contract or invoice exists. If you expected records, try clearing the filters."
				/>
			)}

			<ReceivablesCard
				totals={portfolio.totals_by_currency}
				asOf={portfolio.as_of}
			/>

			<ProjectTable projects={portfolio.projects} onOpen={onOpen} />
		</div>
	);
}

function OverdueBanner({ totals }: { totals: FinanceCurrencyTotals[] }) {
	const count = totals.reduce((sum, total) => sum + total.overdue_count, 0);
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
			<AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
			<p className="text-sm font-semibold text-destructive">
				{countLabel(count, "invoice")} past due
			</p>
			<p className="text-sm text-muted-foreground tabular-nums">
				{totals
					.map((total) => formatCurrency(total.overdue_amount, total.currency))
					.join(" · ")}
			</p>
		</div>
	);
}

function CurrencyCard({ total }: { total: FinanceCurrencyTotals }) {
	// Team-finance payloads carry margin/cost as null — the owner's economics
	// are withheld — so the card leads with billed revenue instead.
	const hasMargin = total.margin !== null;
	const marginTone =
		total.margin === null
			? "neutral"
			: total.margin > 0
				? "success"
				: total.margin < 0
					? "danger"
					: "neutral";
	const collectionRate =
		total.revenue > 0 ? Math.round((total.collected / total.revenue) * 100) : 0;

	return (
		<AppSurfaceCard className="overflow-hidden p-5">
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
						{total.currency} {hasMargin ? "portfolio margin" : "billed revenue"}
					</p>
					<p
						className={`mt-2 text-2xl font-bold tracking-tight tabular-nums ${financeToneTextClass(marginTone)}`}
					>
						{formatCurrency(
							hasMargin ? (total.margin ?? 0) : total.revenue,
							total.currency,
						)}
					</p>
					{hasMargin && total.margin_percent !== null && (
						<p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
							{total.margin_percent}% of billed revenue
						</p>
					)}
				</div>
				<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
					<TrendingUp className="h-5 w-5" />
				</span>
			</div>

			<div className="mt-5 grid grid-cols-2 gap-4 border-t border-border/70 pt-4 sm:grid-cols-4">
				<Metric
					label="Billed"
					value={total.revenue}
					currency={total.currency}
				/>
				<Metric
					label="Collected"
					value={total.collected}
					currency={total.currency}
				/>
				<Metric
					label="Outstanding"
					value={total.outstanding}
					currency={total.currency}
					tone={total.overdue_amount > 0 ? "danger" : "neutral"}
				/>
				{total.cost !== null && (
					<Metric
						label="Delivery cost"
						value={total.cost}
						currency={total.currency}
					/>
				)}
			</div>

			{/* Collection rate reads faster as a bar than as a fifth number. */}
			<div className="mt-4">
				<div
					className="h-1.5 overflow-hidden rounded-full bg-muted"
					role="img"
					aria-label={`${collectionRate}% of billed revenue collected`}
				>
					<div
						className="h-full rounded-full bg-success transition-[width]"
						style={{ width: `${Math.min(100, collectionRate)}%` }}
					/>
				</div>
				<p className="mt-2 text-xs text-muted-foreground">
					{collectionRate}% collected ·{" "}
					{countLabel(total.project_count, "project")} ·{" "}
					{countLabel(total.invoice_count, "invoice")}
				</p>
			</div>
		</AppSurfaceCard>
	);
}

function Metric({
	label,
	value,
	currency,
	tone = "neutral",
}: {
	label: string;
	value: number;
	currency: string;
	tone?: "neutral" | "danger";
}) {
	return (
		<div className="min-w-0">
			<p className="text-xs text-muted-foreground">{label}</p>
			<p
				className={`mt-1 truncate font-semibold tabular-nums ${tone === "danger" ? "text-destructive" : "text-foreground"}`}
			>
				{formatCurrency(value, currency)}
			</p>
		</div>
	);
}

/**
 * Receivables ageing — the question every consultant actually opens a finance
 * page to answer, and the one this surface could not answer at all: nothing
 * outside a single open invoice knew whether money was late.
 */
function ReceivablesCard({
	totals,
	asOf,
}: {
	totals: FinanceCurrencyTotals[];
	asOf: string;
}) {
	const withBalance = totals.filter((total) => total.outstanding > 0);
	if (withBalance.length === 0) return null;

	return (
		<AppSurfaceCard className="overflow-hidden">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-4">
				<div className="flex items-center gap-2.5">
					<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<Wallet className="h-4 w-4" />
					</span>
					<div>
						<h3 className="font-semibold text-foreground">Receivables</h3>
						<p className="mt-0.5 text-xs text-muted-foreground">
							Unpaid balance by how far past due it is
						</p>
					</div>
				</div>
				<span className="text-xs text-muted-foreground">
					As of {formatFinanceDate(asOf)}
				</span>
			</div>

			<div className="divide-y divide-border">
				{withBalance.map((total) => (
					<div key={total.currency} className="px-4 py-4">
						<div className="flex items-baseline justify-between gap-3">
							<p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
								{total.currency}
							</p>
							<p className="text-sm font-bold text-foreground tabular-nums">
								{formatCurrency(total.outstanding, total.currency)}
							</p>
						</div>
						<AgingBar total={total} />
						<div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
							{AGING_BANDS.map((band) => (
								<div key={band.key}>
									<p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
										<span
											aria-hidden
											className={`h-1.5 w-1.5 rounded-full ${BAND_DOT[band.key]}`}
										/>
										{band.label}
									</p>
									<p className="mt-0.5 text-sm font-semibold text-foreground tabular-nums">
										{formatCurrency(total.aging[band.key], total.currency)}
									</p>
								</div>
							))}
						</div>
					</div>
				))}
			</div>
		</AppSurfaceCard>
	);
}

const BAND_DOT: Record<keyof FinanceAging, string> = {
	current: "bg-muted-foreground/50",
	d1_30: "bg-warning",
	d31_60: "bg-warning",
	d61_plus: "bg-destructive",
};

const BAND_FILL: Record<keyof FinanceAging, string> = {
	current: "bg-muted-foreground/40",
	d1_30: "bg-warning/70",
	d31_60: "bg-warning",
	d61_plus: "bg-destructive",
};

function AgingBar({ total }: { total: FinanceCurrencyTotals }) {
	const sum = AGING_BANDS.reduce((acc, band) => acc + total.aging[band.key], 0);
	if (sum <= 0) return null;
	return (
		<div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted">
			{AGING_BANDS.map((band) => {
				const value = total.aging[band.key];
				if (value <= 0) return null;
				return (
					<div
						key={band.key}
						title={`${band.label}: ${formatCurrency(value, total.currency)}`}
						className={BAND_FILL[band.key]}
						style={{ width: `${(value / sum) * 100}%` }}
					/>
				);
			})}
		</div>
	);
}

function ProjectTable({
	projects,
	onOpen,
}: {
	projects: FinanceProject[];
	onOpen: (projectId: string) => void;
}) {
	return (
		<AppSurfaceCard className="overflow-hidden">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-4">
				<div>
					<h3 className="font-semibold text-foreground">Projects</h3>
					<p className="mt-0.5 text-xs text-muted-foreground">
						Select a row to open its financial workspace
					</p>
				</div>
				<span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
					{countLabel(projects.length, "project")}
				</span>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full text-left text-sm">
					<thead className="border-b border-border bg-muted/50 text-xs uppercase text-muted-foreground">
						<tr>
							<th scope="col" className="px-4 py-3">
								Project
							</th>
							<th scope="col" className="px-4 py-3 text-right">
								Revenue
							</th>
							<th scope="col" className="px-4 py-3 text-right">
								Cost
							</th>
							<th scope="col" className="px-4 py-3 text-right">
								Margin
							</th>
							<th scope="col" className="px-4 py-3 text-right">
								Outstanding
							</th>
							<th scope="col" className="px-4 py-3">
								Contract
							</th>
						</tr>
					</thead>
					<tbody>
						{projects.length === 0 && (
							<tr>
								<td
									colSpan={6}
									className="px-4 py-8 text-center text-sm text-muted-foreground"
								>
									Projects appear here once they have a contract or an invoice.
								</td>
							</tr>
						)}
						{projects.map((project) => (
							<tr
								key={project.id}
								className="border-b border-border/70 last:border-0 hover:bg-muted/40 focus-within:bg-muted/40"
							>
								<td className="px-4 py-3">
									{/*
									 * The whole row used to be a <tr onClick>, which no keyboard
									 * or screen reader could reach. One real button per row keeps
									 * the click target while restoring tab order.
									 */}
									<button
										type="button"
										onClick={() => onOpen(project.id)}
										className="group text-left outline-none"
									>
										<span className="flex items-center gap-1 font-semibold text-foreground group-hover:text-primary group-focus-visible:underline">
											{project.title}
											<ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
										</span>
										<span className="block text-xs capitalize text-muted-foreground">
											{project.status}
										</span>
									</button>
								</td>
								<td className="px-4 py-3 text-right tabular-nums">
									{formatCurrency(project.revenue, project.currency)}
								</td>
								<td className="px-4 py-3 text-right tabular-nums">
									{project.cost === null ? (
										<span className="text-muted-foreground">—</span>
									) : (
										formatCurrency(project.cost, project.currency)
									)}
								</td>
								<td
									className={`px-4 py-3 text-right font-semibold tabular-nums ${(project.margin ?? 0) < 0 ? "text-destructive" : "text-foreground"}`}
								>
									{project.margin === null ? (
										<span className="font-normal text-muted-foreground">—</span>
									) : (
										formatCurrency(project.margin, project.currency)
									)}
								</td>
								<td className="px-4 py-3 text-right tabular-nums">
									<span
										className={
											project.overdue_amount > 0
												? "font-semibold text-destructive"
												: "text-muted-foreground"
										}
									>
										{formatCurrency(project.outstanding, project.currency)}
									</span>
									{project.overdue_count > 0 && (
										<span className="mt-0.5 block text-[11px] text-destructive">
											{countLabel(project.overdue_count, "invoice")} overdue
										</span>
									)}
								</td>
								<td className="px-4 py-3">
									{project.latest_contract ? (
										<FinanceStatusBadge
											status={project.latest_contract.status}
										/>
									) : (
										<span className="text-xs text-muted-foreground">
											Not created
										</span>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</AppSurfaceCard>
	);
}
