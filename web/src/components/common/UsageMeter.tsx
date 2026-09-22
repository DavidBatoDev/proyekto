import { InfinityIcon } from "lucide-react";
import type { ReactNode } from "react";
import { computeMeter, type MeterTone } from "@/lib/entitlements";
import { formatCount } from "@/lib/planLimits";
import { cn } from "@/lib/utils";

/**
 * The app's one progress bar.
 *
 * Deliverable completion (`ProgressMeter`) and plan usage both draw through
 * `MeterBar`, so a thin rounded track reads the same everywhere. Colours are
 * theme tokens only — the fill has to survive every theme, dark ones included.
 */

export type MeterBarTone = "default" | "warning" | "danger";

const FILL: Record<MeterBarTone, string> = {
	default: "bg-primary",
	warning: "bg-warning",
	danger: "bg-destructive",
};

/** Which bar colour a usage meter's tone draws with. */
export function meterBarTone(tone: MeterTone): MeterBarTone {
	if (tone === "limit" || tone === "over") return "danger";
	if (tone === "warning") return "warning";
	return "default";
}

export function MeterBar({
	percent,
	tone = "default",
	label,
	className,
}: {
	/** 0–100; clamped. `null` draws an empty, indeterminate track. */
	percent: number | null;
	tone?: MeterBarTone;
	/** Accessible name — the bar carries no visible text of its own. */
	label: string;
	className?: string;
}) {
	const value =
		percent === null || !Number.isFinite(percent)
			? null
			: Math.min(100, Math.max(0, Math.round(percent)));
	return (
		<div
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={value ?? undefined}
			className={cn("h-1.5 overflow-hidden rounded-full bg-muted", className)}
		>
			<div
				data-tone={tone}
				className={cn(
					"h-full rounded-full transition-all duration-300",
					FILL[tone],
				)}
				style={{ width: `${value ?? 0}%` }}
			/>
		</div>
	);
}

const CAPTION_TONE: Record<MeterBarTone, string> = {
	default: "text-muted-foreground",
	warning: "text-warning-foreground",
	danger: "text-destructive",
};

/**
 * "2 of 10" over a bar, or "3 · Unlimited" with no bar at all — an empty
 * track against an infinite limit would imply a ceiling that does not exist.
 */
export function UsageMeter({
	label,
	used,
	limit,
	caption,
	size = "md",
	className,
}: {
	label: string;
	used: number;
	/** Null = unlimited. */
	limit: number | null;
	caption?: ReactNode;
	size?: "sm" | "md";
	className?: string;
}) {
	const meter = computeMeter(used, limit);
	const tone = meterBarTone(meter.tone);
	const small = size === "sm";
	return (
		<div className={className}>
			<div
				className={cn(
					"flex items-baseline justify-between gap-3",
					small ? "text-xs" : "text-sm",
				)}
			>
				<span className="min-w-0 truncate font-medium text-foreground">
					{label}
				</span>
				{meter.limit === null ? (
					<span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
						<span className="font-semibold tabular-nums text-foreground">
							{formatCount(meter.used)}
						</span>
						<span aria-hidden="true">·</span>
						<InfinityIcon aria-hidden="true" className="h-3.5 w-3.5" />
						<span>Unlimited</span>
					</span>
				) : (
					<span className="shrink-0 font-semibold tabular-nums text-foreground">
						{`${formatCount(meter.used)} of ${formatCount(meter.limit)}`}
					</span>
				)}
			</div>
			{meter.limit !== null && (
				<MeterBar
					className={small ? "mt-1.5" : "mt-2"}
					percent={meter.percent}
					tone={tone}
					label={`${label}: ${formatCount(meter.used)} of ${formatCount(meter.limit)}`}
				/>
			)}
			{caption && (
				<p className={cn("mt-1.5 text-xs", CAPTION_TONE[tone])}>{caption}</p>
			)}
		</div>
	);
}
