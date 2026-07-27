import { formatCurrency } from "@/lib/currency";
import type { MonthPoint } from "@/services/financials.service";

/**
 * Hand-rolled SVG charts for the Financials view (no charting dependency).
 *
 * Colors are the dataviz reference palette's validated categorical slots — blue
 * (revenue) and orange (cost) — which pass CVD + contrast in BOTH light and dark
 * (validated via the skill's validator). They're wired as CSS vars that flip by
 * theme, so the marks re-step for the dark surface rather than being an automatic
 * flip. Revenue and cost share ONE money axis (same unit); margin % is a separate
 * chart, never a second y-axis.
 */

const VIZ_STYLE = `
.viz-root {
  --rev: #2a78d6;
  --cost: #eb6834;
  --pos: #0ca30c;
  --neg: #e34948;
  --grid: #e7e7e3;
  --axis: #52514e;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .viz-root {
    --rev: #3987e5;
    --cost: #d95926;
    --pos: #2ea62e;
    --neg: #e66767;
    --grid: #33332f;
    --axis: #c3c2b7;
  }
}
:root[data-theme="dark"] .viz-root {
  --rev: #3987e5;
  --cost: #d95926;
  --pos: #2ea62e;
  --neg: #e66767;
  --grid: #33332f;
  --axis: #c3c2b7;
}
`;

function shortMonth(month: string): string {
	const [y, m] = month.split("-");
	const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1, 12));
	return d.toLocaleDateString(undefined, {
		month: "short",
		timeZone: "UTC",
	});
}

/** Injects the viz CSS vars once per mount point. */
export function VizStyle() {
	// biome-ignore lint/security/noDangerouslySetInnerHtml: static, no interpolation
	return <style dangerouslySetInnerHTML={{ __html: VIZ_STYLE }} />;
}

/* ── Revenue vs cost, grouped bars ────────────────────────────────────────── */

export function RevenueCostChart({
	months,
	currency,
}: {
	months: MonthPoint[];
	currency: string;
}) {
	if (months.length === 0) {
		return <EmptyChart label="No revenue or cost in this range yet." />;
	}

	const W = 640;
	const H = 240;
	const padL = 8;
	const padR = 8;
	const padT = 16;
	const padB = 28;
	const plotW = W - padL - padR;
	const plotH = H - padT - padB;

	const max = Math.max(1, ...months.map((m) => Math.max(m.revenue, m.cost)));
	const groupW = plotW / months.length;
	const barW = Math.min(28, (groupW - 6) / 2 - 1);
	const y = (v: number) => padT + plotH - (v / max) * plotH;

	// Three recessive gridlines.
	const ticks = [0.25, 0.5, 0.75, 1].map((t) => t * max);

	return (
		<figure className="viz-root m-0">
			<VizStyle />
			<Legend
				items={[
					{ label: "Revenue", color: "var(--rev)" },
					{ label: "Cost", color: "var(--cost)" },
				]}
			/>
			<svg
				viewBox={`0 0 ${W} ${H}`}
				className="w-full"
				role="img"
				aria-label="Revenue versus cost per month"
			>
				<title>Revenue versus cost per month</title>
				{ticks.map((t) => (
					<line
						key={t}
						x1={padL}
						x2={W - padR}
						y1={y(t)}
						y2={y(t)}
						stroke="var(--grid)"
						strokeWidth={1}
					/>
				))}
				{months.map((m, i) => {
					const gx = padL + i * groupW + (groupW - barW * 2 - 2) / 2;
					return (
						<g key={m.month}>
							<Bar
								x={gx}
								y={y(m.revenue)}
								w={barW}
								h={padT + plotH - y(m.revenue)}
								color="var(--rev)"
								title={`${shortMonth(m.month)} revenue ${formatCurrency(m.revenue, currency)}`}
							/>
							<Bar
								x={gx + barW + 2}
								y={y(m.cost)}
								w={barW}
								h={padT + plotH - y(m.cost)}
								color="var(--cost)"
								title={`${shortMonth(m.month)} cost ${formatCurrency(m.cost, currency)}`}
							/>
							<text
								x={gx + barW + 1}
								y={H - 10}
								textAnchor="middle"
								className="fill-muted-foreground text-[10px]"
							>
								{shortMonth(m.month)}
							</text>
						</g>
					);
				})}
			</svg>
		</figure>
	);
}

function Bar({
	x,
	y,
	w,
	h,
	color,
	title,
}: {
	x: number;
	y: number;
	w: number;
	h: number;
	color: string;
	title: string;
}) {
	return (
		<rect x={x} y={y} width={w} height={Math.max(0, h)} rx={3} fill={color}>
			<title>{title}</title>
		</rect>
	);
}

/* ── Margin % trend, single line ──────────────────────────────────────────── */

export function MarginTrendChart({ months }: { months: MonthPoint[] }) {
	const points = months.filter((m) => m.margin_percent != null);
	if (points.length < 2) {
		return <EmptyChart label="Not enough data for a margin trend yet." />;
	}

	const W = 640;
	const H = 200;
	const padL = 8;
	const padR = 28;
	const padT = 16;
	const padB = 28;
	const plotW = W - padL - padR;
	const plotH = H - padT - padB;

	const values = points.map((p) => p.margin_percent as number);
	const lo = Math.min(0, ...values);
	const hi = Math.max(0, ...values);
	const span = Math.max(1, hi - lo);
	const x = (i: number) =>
		padL +
		(points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
	const y = (v: number) => padT + plotH - ((v - lo) / span) * plotH;

	const path = points
		.map(
			(p, i) =>
				`${i === 0 ? "M" : "L"} ${x(i)} ${y(p.margin_percent as number)}`,
		)
		.join(" ");
	const last = points[points.length - 1];

	return (
		<figure className="viz-root m-0">
			<VizStyle />
			<svg
				viewBox={`0 0 ${W} ${H}`}
				className="w-full"
				role="img"
				aria-label="Margin percent trend"
			>
				<title>Margin percent trend</title>
				{/* Zero baseline */}
				<line
					x1={padL}
					x2={W - padR}
					y1={y(0)}
					y2={y(0)}
					stroke="var(--grid)"
					strokeWidth={1}
				/>
				<path d={path} fill="none" stroke="var(--rev)" strokeWidth={2} />
				{points.map((p, i) => (
					<circle
						key={p.month}
						cx={x(i)}
						cy={y(p.margin_percent as number)}
						r={3.5}
						fill="var(--rev)"
					>
						<title>
							{shortMonth(p.month)}: {p.margin_percent}%
						</title>
					</circle>
				))}
				{/* Direct end-label instead of a legend (single series). */}
				<text
					x={x(points.length - 1) + 6}
					y={y(last.margin_percent as number) + 3}
					className="fill-foreground text-[11px] font-semibold"
				>
					{last.margin_percent}%
				</text>
				{points.map((p, i) => (
					<text
						key={p.month}
						x={x(i)}
						y={H - 10}
						textAnchor="middle"
						className="fill-muted-foreground text-[10px]"
					>
						{shortMonth(p.month)}
					</text>
				))}
			</svg>
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
		<div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
			{label}
		</div>
	);
}
