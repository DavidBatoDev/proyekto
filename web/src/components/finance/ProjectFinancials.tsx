import { useQuery } from "@tanstack/react-query";
import {
	AlertTriangle,
	ArrowDownRight,
	ArrowUpRight,
	Loader2,
	Minus,
} from "lucide-react";
import type { ReactNode } from "react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import { formatFinanceDate } from "@/components/finance/portfolio/FinancePrimitives";
import { BudgetSplitPanel } from "@/components/financials/BudgetSplitPanel";
import {
	MarginTrendChart,
	RevenueCostChart,
} from "@/components/financials/FinancialsCharts";
import { formatCurrency } from "@/lib/currency";
import {
	type FinanceAgingBands,
	financialsService,
	type MonthPoint,
	type ProjectFinancials,
	type ProjectReceivables,
} from "@/services/financials.service";

/**
 * Per-project financials.
 *
 * Rebuilt around the three questions a consultant actually opens this for, in
 * order: am I making money, has the money arrived, and where is the team pool
 * going. The previous layout spent its first full-width card on a title, printed
 * the four headline figures with no basis for comparison, and then rendered the
 * budget split TWICE — once as a summary strip and again as the editable panel
 * directly beneath it, with identical numbers.
 */
export function ProjectFinancials({ projectId }: { projectId: string }) {
	const financialsQuery = useQuery({
		queryKey: ["project", projectId, "financials"],
		queryFn: () => financialsService.getProjectFinancials(projectId),
	});
	const fin = financialsQuery.data;

	if (financialsQuery.isPending) {
		return (
			<div className="flex justify-center py-20">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}
	if (!fin) return null;

	// A trend card that can only ever say "not enough data" is worth less than the
	// screen it occupies; the KPI sparklines already carry direction.
	const hasTrend =
		fin.months.filter((m) => m.margin_percent !== null).length >= 2;

	return (
		<div className="w-full space-y-5 pb-10">
			<KpiRow fin={fin} />
			<div className="grid gap-5 lg:grid-cols-3">
				<div className="space-y-5 lg:col-span-2">
					<ChartCard
						title="Revenue vs cost"
						subtitle="Billed invoices against the internal cost of the time delivered."
					>
						<RevenueCostChart months={fin.months} currency={fin.currency} />
					</ChartCard>
					{hasTrend && (
						<ChartCard
							title="Margin trend"
							subtitle="What share of each month's revenue you kept."
						>
							<MarginTrendChart months={fin.months} />
						</ChartCard>
					)}
				</div>
				<div className="space-y-5">
					<CashCard receivables={fin.receivables} currency={fin.currency} />
					{fin.by_currency.length > 1 && <OtherCurrencies fin={fin} />}
				</div>
			</div>
			<BudgetSplitPanel projectId={projectId} />
		</div>
	);
}

/* ── KPI row ──────────────────────────────────────────────────────────────── */

/**
 * The four headline figures, each with the one thing the old cards lacked: a
 * basis for comparison. A number with no previous period is a number nobody can
 * act on.
 */
function KpiRow({ fin }: { fin: ProjectFinancials }) {
	const { totals, currency, months } = fin;
	/*
	 * Compare the last two BILLED months, not simply the last two rows.
	 *
	 * The trailing month usually carries delivery cost while its invoice is
	 * still a draft, so measuring against it reported "revenue down 100%" and
	 * "margin down 192%" on a project that was performing normally — it was
	 * reading an unbilled month as a collapse. All four tiles share one basis so
	 * the row is internally consistent.
	 */
	const billed = months.filter((month) => month.revenue > 0);
	const latest = billed.length >= 1 ? billed[billed.length - 1] : null;
	const previous = billed.length >= 2 ? billed[billed.length - 2] : null;
	const basis =
		latest && previous
			? `${monthLabel(previous.month)} → ${monthLabel(latest.month)}`
			: undefined;

	return (
		<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
			<Kpi
				label="Revenue"
				value={formatCurrency(totals.revenue, currency)}
				delta={delta(latest?.revenue, previous?.revenue)}
				deltaGood="up"
				basis={basis}
				spark={months.map((m) => m.revenue)}
			/>
			<Kpi
				label="Delivery cost"
				value={formatCurrency(totals.cost, currency)}
				delta={delta(latest?.cost, previous?.cost)}
				deltaGood="down"
				basis={basis}
				spark={months.map((m) => m.cost)}
			/>
			<Kpi
				label="Margin"
				value={formatCurrency(totals.margin, currency)}
				tone={totals.margin < 0 ? "danger" : undefined}
				delta={delta(latest?.margin, previous?.margin)}
				deltaGood="up"
				basis={basis}
				spark={months.map((m) => m.margin)}
			/>
			<Kpi
				label="Margin rate"
				value={
					totals.margin_percent === null ? "—" : `${totals.margin_percent}%`
				}
				tone={
					totals.margin_percent !== null && totals.margin_percent < 0
						? "danger"
						: undefined
				}
				hint={
					totals.margin_percent === null
						? "No billed revenue yet"
						: `on ${formatCurrency(totals.revenue, currency)} billed`
				}
			/>
		</div>
	);
}

function monthLabel(month: string): string {
	const [year, m] = month.split("-");
	return new Date(
		Date.UTC(Number(year), Number(m) - 1, 1, 12),
	).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
}

function delta(current?: number, previous?: number): number | null {
	if (current === undefined || previous === undefined) return null;
	if (!Number.isFinite(previous) || previous === 0) return null;
	return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

function Kpi({
	label,
	value,
	hint,
	delta: deltaPct,
	basis,
	deltaGood = "up",
	tone,
	spark,
}: {
	label: string;
	value: string;
	hint?: string;
	delta?: number | null;
	/** Which two months the delta compares, for the tooltip. */
	basis?: string;
	/** Which direction of movement is the good one for this measure. */
	deltaGood?: "up" | "down";
	tone?: "danger";
	spark?: number[];
}) {
	const good =
		deltaPct === null || deltaPct === undefined || deltaPct === 0
			? null
			: deltaGood === "up"
				? deltaPct > 0
				: deltaPct < 0;

	return (
		<AppSurfaceCard className="p-4">
			<p className="text-xs font-medium text-muted-foreground">{label}</p>
			<p
				className={`mt-1.5 text-xl font-bold tracking-tight tabular-nums ${tone === "danger" ? "text-destructive" : "text-foreground"}`}
			>
				{value}
			</p>
			<div className="mt-1 flex min-h-5 items-center justify-between gap-2">
				{deltaPct !== null && deltaPct !== undefined ? (
					<span
						title={
							basis
								? `Change ${basis}`
								: "Change against the previous billed month"
						}
						className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums ${
							good === null
								? "text-muted-foreground"
								: good
									? "text-success-foreground"
									: "text-destructive"
						}`}
					>
						{deltaPct === 0 ? (
							<Minus className="h-3 w-3" />
						) : deltaPct > 0 ? (
							<ArrowUpRight className="h-3 w-3" />
						) : (
							<ArrowDownRight className="h-3 w-3" />
						)}
						{Math.abs(deltaPct)}%
					</span>
				) : (
					<span className="truncate text-[11px] text-muted-foreground">
						{hint ?? ""}
					</span>
				)}
				{spark && spark.length >= 2 && <Sparkline values={spark} />}
			</div>
		</AppSurfaceCard>
	);
}

/** A shape, not a chart: no axes, no labels, no tooltip — trend at a glance. */
function Sparkline({ values }: { values: number[] }) {
	const W = 56;
	const H = 16;
	const lo = Math.min(0, ...values);
	const hi = Math.max(...values);
	const span = Math.max(1, hi - lo);
	const path = values
		.map((v, i) => {
			const x = (i / (values.length - 1)) * W;
			const y = H - ((v - lo) / span) * H;
			return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
		})
		.join(" ");
	return (
		<svg
			viewBox={`0 0 ${W} ${H}`}
			width={W}
			height={H}
			aria-hidden
			className="shrink-0 overflow-visible text-muted-foreground"
		>
			<path
				d={path}
				fill="none"
				stroke="currentColor"
				strokeWidth={1.5}
				strokeLinecap="round"
				strokeLinejoin="round"
				opacity={0.7}
			/>
		</svg>
	);
}

/* ── Cash ─────────────────────────────────────────────────────────────────── */

const AGING_BANDS: Array<{ key: keyof FinanceAgingBands; label: string }> = [
	{ key: "current", label: "Not due" },
	{ key: "d1_30", label: "1–30 days" },
	{ key: "d31_60", label: "31–60 days" },
	{ key: "d61_plus", label: "60+ days" },
];

const BAND_FILL: Record<keyof FinanceAgingBands, string> = {
	current: "bg-muted-foreground/40",
	d1_30: "bg-warning/70",
	d31_60: "bg-warning",
	d61_plus: "bg-destructive",
};

/**
 * Cash position. Margin says whether the work was worth doing; this says whether
 * the money actually arrived — and the project view had no answer for it at all.
 */
function CashCard({
	receivables,
	currency,
}: {
	receivables: ProjectReceivables;
	currency: string;
}) {
	const rate =
		receivables.billed > 0
			? Math.round((receivables.collected / receivables.billed) * 100)
			: 0;
	const banded = AGING_BANDS.map((band) => ({
		...band,
		value: receivables.aging[band.key],
	})).filter((band) => band.value > 0);

	return (
		<AppSurfaceCard className="p-5">
			<div className="flex items-baseline justify-between gap-2">
				<h3 className="text-sm font-semibold text-foreground">Cash position</h3>
				<span className="text-[11px] text-muted-foreground">
					{formatFinanceDate(receivables.as_of)}
				</span>
			</div>

			{receivables.invoice_count === 0 ? (
				<p className="mt-3 text-sm text-muted-foreground">
					Nothing billed on this project yet.
				</p>
			) : (
				<>
					<p className="mt-3 text-2xl font-bold tracking-tight tabular-nums text-foreground">
						{formatCurrency(receivables.outstanding, currency)}
					</p>
					<p className="text-xs text-muted-foreground">
						outstanding of {formatCurrency(receivables.billed, currency)} billed
					</p>

					<div
						className="mt-4 h-2 overflow-hidden rounded-full bg-muted"
						role="img"
						aria-label={`${rate}% of billed revenue collected`}
					>
						<div
							className="h-full rounded-full bg-success transition-[width]"
							style={{ width: `${Math.min(100, rate)}%` }}
						/>
					</div>
					<p className="mt-2 text-xs text-muted-foreground">
						{formatCurrency(receivables.collected, currency)} collected · {rate}
						%
					</p>

					{receivables.overdue_count > 0 && (
						<p className="mt-3 flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs font-semibold text-destructive">
							<AlertTriangle className="h-3.5 w-3.5 shrink-0" />
							{formatCurrency(receivables.overdue_amount, currency)} overdue
							across {receivables.overdue_count}{" "}
							{receivables.overdue_count === 1 ? "invoice" : "invoices"}
						</p>
					)}

					{banded.length > 0 && (
						<dl className="mt-4 space-y-1.5 border-t border-border pt-3">
							{banded.map((band) => (
								<div key={band.key} className="flex items-center gap-2 text-xs">
									<span
										aria-hidden
										className={`h-2 w-2 shrink-0 rounded-sm ${BAND_FILL[band.key]}`}
									/>
									<dt className="text-muted-foreground">{band.label}</dt>
									<dd className="ml-auto font-semibold tabular-nums text-foreground">
										{formatCurrency(band.value, currency)}
									</dd>
								</div>
							))}
						</dl>
					)}
				</>
			)}
		</AppSurfaceCard>
	);
}

function OtherCurrencies({ fin }: { fin: ProjectFinancials }) {
	return (
		<AppSurfaceCard className="p-5">
			<h3 className="text-sm font-semibold text-foreground">
				Other currencies
			</h3>
			<p className="mt-1 text-xs text-muted-foreground">
				Never converted. The headline above is in {fin.currency}.
			</p>
			<dl className="mt-3 space-y-2">
				{fin.by_currency
					.filter((c) => c.currency !== fin.currency)
					.map((c) => (
						<div
							key={c.currency}
							className="flex justify-between gap-3 text-sm"
						>
							<dt className="text-muted-foreground">{c.currency}</dt>
							<dd className="text-right tabular-nums text-foreground">
								{formatCurrency(c.revenue, c.currency)}
								<span className="block text-[11px] text-muted-foreground">
									{formatCurrency(c.margin, c.currency)} margin
								</span>
							</dd>
						</div>
					))}
			</dl>
		</AppSurfaceCard>
	);
}

function ChartCard({
	title,
	subtitle,
	children,
}: {
	title: string;
	subtitle: string;
	children: ReactNode;
}) {
	return (
		<AppSurfaceCard className="p-5">
			<h3 className="text-sm font-semibold text-foreground">{title}</h3>
			<p className="mt-0.5 mb-3 text-xs text-muted-foreground">{subtitle}</p>
			{children}
		</AppSurfaceCard>
	);
}

export type { MonthPoint };
