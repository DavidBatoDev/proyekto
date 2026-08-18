import { useId, useState } from "react";
import { formatCurrency } from "@/lib/currency";
import type { MonthPoint } from "@/services/financials.service";

/**
 * Hand-rolled SVG charts for the Financials view (no charting dependency).
 *
 * Colors are the dataviz reference palette's validated categorical slots — blue
 * (revenue) and orange (cost). Re-validated for this app's own surfaces (#ffffff
 * light, #252629 / #171717 dark): all six checks pass in both modes. Revenue and
 * cost share ONE money axis (same unit); margin % is a separate chart, never a
 * second y-axis.
 *
 * The dark steps key off `html[data-ui-theme=...]`, which is how this app
 * actually switches theme. They previously keyed off `[data-theme]` and
 * `prefers-color-scheme`, neither of which this app sets — so the dark values
 * never once applied and the light marks were carried onto the dark surface.
 */

const VIZ_STYLE = `
.viz-root {
  --rev: #2a78d6;
  --cost: #eb6834;
  --grid: #e7e7e3;
  --axis: #52514e;
}
html[data-ui-theme="dark"] .viz-root,
html[data-ui-theme="classic-dark"] .viz-root,
html[data-ui-theme="magic-blue"] .viz-root {
  --rev: #3987e5;
  --cost: #d95926;
  --grid: #33332f;
  --axis: #c3c2b7;
}
`;

/**
 * The viz vars, injected once for the whole document rather than once per chart.
 * Two charts on a page used to mean two identical <style> elements.
 */
export function VizStyle() {
	return (
		// biome-ignore lint/security/noDangerouslySetInnerHtml: static, no interpolation
		<style data-viz-style dangerouslySetInnerHTML={{ __html: VIZ_STYLE }} />
	);
}

function shortMonth(month: string): string {
	const [y, m] = month.split("-");
	const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1, 12));
	return d.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
}

function longMonth(month: string): string {
	const [y, m] = month.split("-");
	const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1, 12));
	return d.toLocaleDateString(undefined, {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});
}

/**
 * Axis ticks a person would actually write down: 1 / 2 / 2.5 / 5 × 10ⁿ, so the
 * gridlines land on round money instead of an arbitrary quarter of the maximum.
 */
function niceTicks(max: number, count = 4): number[] {
	if (!(max > 0)) return [0];
	const rough = max / count;
	const magnitude = 10 ** Math.floor(Math.log10(rough));
	const normalized = rough / magnitude;
	const step =
		(normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : 5) *
		magnitude;
	const ticks: number[] = [];
	for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
	return ticks;
}

/** Compact axis money — "₱15k" reads at 10px where "PHP 15,000.00" does not. */
function compactAmount(value: number, currency: string): string {
	return new Intl.NumberFormat(undefined, {
		style: "currency",
		currency,
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(value);
}

/* ── Revenue vs cost, grouped bars ────────────────────────────────────────── */

export function RevenueCostChart({
	months,
	currency,
}: {
	months: MonthPoint[];
	currency: string;
}) {
	const [hover, setHover] = useState<number | null>(null);
	const titleId = useId();

	if (months.length === 0) {
		return <EmptyChart label="No revenue or cost in this range yet." />;
	}

	// One month is a comparison, not a trend. A lone pair of bars floating in a
	// 240px box says nothing a labelled pair of figures does not say better.
	if (months.length === 1) {
		return <SinglePeriodCompare point={months[0]} currency={currency} />;
	}

	const W = 640;
	const H = 260;
	const padL = 52;
	const padR = 12;
	const padT = 12;
	const padB = 30;
	const plotW = W - padL - padR;
	const plotH = H - padT - padB;

	const rawMax = Math.max(1, ...months.map((m) => Math.max(m.revenue, m.cost)));
	const ticks = niceTicks(rawMax);
	const max = Math.max(rawMax, ticks[ticks.length - 1]);
	const groupW = plotW / months.length;
	const barW = Math.min(26, (groupW - 10) / 2 - 1);
	const y = (v: number) => padT + plotH - (v / max) * plotH;
	const baseline = padT + plotH;

	return (
		<figure className="viz-root m-0">
			<VizStyle />
			<Legend
				items={[
					{ label: "Revenue", color: "var(--rev)" },
					{ label: "Cost", color: "var(--cost)" },
				]}
			/>
			<div className="relative">
				<svg
					viewBox={`0 0 ${W} ${H}`}
					className="w-full"
					role="img"
					aria-labelledby={titleId}
					onMouseLeave={() => setHover(null)}
				>
					<title id={titleId}>Revenue versus cost per month</title>

					{ticks.map((t) => (
						<g key={t}>
							<line
								x1={padL}
								x2={W - padR}
								y1={y(t)}
								y2={y(t)}
								stroke="var(--grid)"
								strokeWidth={1}
							/>
							<text
								x={padL - 8}
								y={y(t) + 3}
								textAnchor="end"
								className="fill-muted-foreground text-[10px] tabular-nums"
							>
								{compactAmount(t, currency)}
							</text>
						</g>
					))}

					{months.map((m, i) => {
						const gx = padL + i * groupW + (groupW - barW * 2 - 2) / 2;
						return (
							<g key={m.month}>
								{/* A full-height hit target: the bars themselves are too thin. */}
								<rect
									x={padL + i * groupW}
									y={padT}
									width={groupW}
									height={plotH}
									fill={hover === i ? "var(--grid)" : "transparent"}
									opacity={hover === i ? 0.45 : 1}
									onMouseEnter={() => setHover(i)}
								/>
								<Bar
									x={gx}
									baseline={baseline}
									w={barW}
									top={y(m.revenue)}
									color="var(--rev)"
								/>
								<Bar
									x={gx + barW + 2}
									baseline={baseline}
									w={barW}
									top={y(m.cost)}
									color="var(--cost)"
								/>
								<text
									x={gx + barW + 1}
									y={H - 10}
									textAnchor="middle"
									className={`text-[10px] ${hover === i ? "fill-foreground font-semibold" : "fill-muted-foreground"}`}
								>
									{shortMonth(m.month)}
								</text>
							</g>
						);
					})}
				</svg>

				{hover !== null && (
					<Tooltip
						leftPercent={((padL + hover * groupW + groupW / 2) / W) * 100}
						title={longMonth(months[hover].month)}
						rows={[
							{
								label: "Revenue",
								value: formatCurrency(months[hover].revenue, currency),
								color: "var(--rev)",
							},
							{
								label: "Cost",
								value: formatCurrency(months[hover].cost, currency),
								color: "var(--cost)",
							},
							{
								label: "Margin",
								value: formatCurrency(months[hover].margin, currency),
							},
						]}
					/>
				)}
			</div>
		</figure>
	);
}

/**
 * A bar with rounded data-ends anchored to the baseline: square where it meets
 * the axis, 4px radius at the value end.
 */
function Bar({
	x,
	baseline,
	w,
	top,
	color,
}: {
	x: number;
	baseline: number;
	w: number;
	top: number;
	color: string;
}) {
	const h = Math.max(0, baseline - top);
	if (h <= 0) return null;
	const r = Math.min(4, w / 2, h);
	const d = `M ${x} ${baseline} L ${x} ${top + r} Q ${x} ${top} ${x + r} ${top} L ${x + w - r} ${top} Q ${x + w} ${top} ${x + w} ${top + r} L ${x + w} ${baseline} Z`;
	return <path d={d} fill={color} />;
}

/* ── Margin % trend, single line ──────────────────────────────────────────── */

export function MarginTrendChart({ months }: { months: MonthPoint[] }) {
	const [hover, setHover] = useState<number | null>(null);
	const titleId = useId();
	const points = months.filter((m) => m.margin_percent != null);

	if (points.length < 2) {
		return (
			<EmptyChart label="A margin trend needs at least two billed months." />
		);
	}

	const W = 640;
	const H = 220;
	const padL = 40;
	// Room for the direct end-label. A negative percentage is the widest thing
	// that can sit here ("-64.8%"), and at padR 40 it ran off the card.
	const padR = 72;
	const padT = 14;
	const padB = 30;
	const plotW = W - padL - padR;
	const plotH = H - padT - padB;

	const values = points.map((p) => p.margin_percent as number);
	const lo = Math.min(0, ...values);
	const hi = Math.max(0, ...values);
	const span = Math.max(1, hi - lo);
	const x = (i: number) => padL + (i / (points.length - 1)) * plotW;
	const y = (v: number) => padT + plotH - ((v - lo) / span) * plotH;
	const last = points[points.length - 1];

	const path = points
		.map(
			(p, i) =>
				`${i === 0 ? "M" : "L"} ${x(i)} ${y(p.margin_percent as number)}`,
		)
		.join(" ");

	return (
		<figure className="viz-root m-0">
			<VizStyle />
			<div className="relative">
				<svg
					viewBox={`0 0 ${W} ${H}`}
					className="w-full"
					role="img"
					aria-labelledby={titleId}
					onMouseLeave={() => setHover(null)}
				>
					<title id={titleId}>Margin percent trend</title>

					{[lo, 0, hi]
						.filter((v, i, a) => a.indexOf(v) === i)
						.map((v) => (
							<g key={v}>
								<line
									x1={padL}
									x2={W - padR}
									y1={y(v)}
									y2={y(v)}
									stroke="var(--grid)"
									strokeWidth={v === 0 ? 1.5 : 1}
								/>
								<text
									x={padL - 8}
									y={y(v) + 3}
									textAnchor="end"
									className="fill-muted-foreground text-[10px] tabular-nums"
								>
									{Math.round(v)}%
								</text>
							</g>
						))}

					<path d={path} fill="none" stroke="var(--rev)" strokeWidth={2} />

					{points.map((p, i) => (
						<g key={p.month}>
							<rect
								x={x(i) - plotW / (points.length * 2)}
								y={padT}
								width={plotW / points.length}
								height={plotH}
								fill="transparent"
								onMouseEnter={() => setHover(i)}
							/>
							<circle
								cx={x(i)}
								cy={y(p.margin_percent as number)}
								r={hover === i ? 5 : 3.5}
								fill="var(--rev)"
								stroke="var(--card, #fff)"
								strokeWidth={2}
							/>
						</g>
					))}

					{/* Direct end-label instead of a legend (single series). */}
					<text
						x={x(points.length - 1) + 8}
						y={clampLabelY(
							y(last.margin_percent as number),
							padT,
							padT + plotH,
						)}
						className="fill-foreground text-[11px] font-semibold tabular-nums"
					>
						{last.margin_percent}%
					</text>

					{points.map((p, i) => (
						<text
							key={p.month}
							x={x(i)}
							y={H - 10}
							textAnchor="middle"
							className={`text-[10px] ${hover === i ? "fill-foreground font-semibold" : "fill-muted-foreground"}`}
						>
							{shortMonth(p.month)}
						</text>
					))}
				</svg>

				{hover !== null && (
					<Tooltip
						leftPercent={(x(hover) / W) * 100}
						title={longMonth(points[hover].month)}
						rows={[
							{
								label: "Margin",
								value: `${points[hover].margin_percent}%`,
								color: "var(--rev)",
							},
						]}
					/>
				)}
			</div>
		</figure>
	);
}

/** Keeps a direct label inside the plot when its point sits on an edge. */
function clampLabelY(y: number, top: number, bottom: number): number {
	return Math.min(bottom - 2, Math.max(top + 9, y + 3));
}

/* ── Shared pieces ────────────────────────────────────────────────────────── */

function Tooltip({
	leftPercent,
	title,
	rows,
}: {
	leftPercent: number;
	title: string;
	rows: Array<{ label: string; value: string; color?: string }>;
}) {
	// Clamped so a tooltip on the first or last mark cannot run off the card.
	const left = Math.min(88, Math.max(12, leftPercent));
	return (
		<div
			role="status"
			className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-lg border border-border bg-popover px-2.5 py-2 text-popover-foreground shadow-lg"
			style={{ left: `${left}%` }}
		>
			<p className="text-[11px] font-semibold text-foreground">{title}</p>
			<dl className="mt-1 space-y-0.5">
				{rows.map((row) => (
					<div key={row.label} className="flex items-center gap-2 text-[11px]">
						<span
							aria-hidden
							className="h-2 w-2 shrink-0 rounded-sm"
							style={{ background: row.color ?? "transparent" }}
						/>
						<dt className="text-muted-foreground">{row.label}</dt>
						<dd className="ml-auto font-semibold tabular-nums text-foreground">
							{row.value}
						</dd>
					</div>
				))}
			</dl>
		</div>
	);
}

/**
 * The one-month case. A single group of bars carries no comparison over time, so
 * this states the two figures and the gap between them directly.
 */
function SinglePeriodCompare({
	point,
	currency,
}: {
	point: MonthPoint;
	currency: string;
}) {
	const max = Math.max(point.revenue, point.cost, 1);
	const rows = [
		{ label: "Revenue", value: point.revenue, color: "var(--rev)" },
		{ label: "Cost", value: point.cost, color: "var(--cost)" },
	];
	return (
		<figure className="viz-root m-0">
			<VizStyle />
			<p className="text-xs text-muted-foreground">
				{longMonth(point.month)} · the only billed month so far
			</p>
			<dl className="mt-3 space-y-3">
				{rows.map((row) => (
					<div key={row.label}>
						<div className="flex items-baseline justify-between gap-3">
							<dt className="text-xs font-medium text-muted-foreground">
								{row.label}
							</dt>
							<dd className="text-sm font-semibold tabular-nums text-foreground">
								{formatCurrency(row.value, currency)}
							</dd>
						</div>
						<div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
							<div
								className="h-full rounded-full"
								style={{
									width: `${Math.max(0, (row.value / max) * 100)}%`,
									background: row.color,
								}}
							/>
						</div>
					</div>
				))}
			</dl>
			<p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
				Margin{" "}
				<span className="font-semibold tabular-nums text-foreground">
					{formatCurrency(point.margin, currency)}
				</span>
				{point.margin_percent !== null && ` · ${point.margin_percent}%`}
			</p>
		</figure>
	);
}

function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
	return (
		<div className="mb-2 flex items-center gap-4">
			{items.map((it) => (
				<span
					key={it.label}
					className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
				>
					<span
						className="inline-block h-2.5 w-2.5 rounded-sm"
						style={{ backgroundColor: it.color }}
					/>
					{it.label}
				</span>
			))}
		</div>
	);
}

function EmptyChart({ label }: { label: string }) {
	return (
		<div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
			{label}
		</div>
	);
}
