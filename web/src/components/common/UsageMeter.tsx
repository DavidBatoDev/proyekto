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

/**
 * The track colour for usage meters. They sit straight on the page rather
 * than on a card, and the page background is already about as light as
 * `bg-muted`, so the unfilled part of the bar would vanish; a faint wash of
 * the foreground stays visible in every theme.
 */
export const USAGE_TRACK = "bg-foreground/10";

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
					"h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
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
 * The line under a meter, coloured by how close the count is to its limit so
 * "at the limit" reads as urgent without a filled box around it.
 */
export function MeterCaption({
	tone = "default",
	children,
	className,
}: {
	tone?: MeterBarTone;
	children: ReactNode;
	className?: string;
}) {
	return (
		<p className={cn("text-xs leading-relaxed", CAPTION_TONE[tone], className)}>
			{children}
		</p>
	);
}

const READING_SIZE = {
	sm: { number: "text-xs", qualifier: "text-xs" },
	md: { number: "text-sm", qualifier: "text-sm" },
	lg: { number: "text-base leading-5", qualifier: "text-sm" },
} as const;

export type ReadingSize = keyof typeof READING_SIZE;

/**
 * The one rule every value on the usage and billing pages follows: the
 * figure is strong (semibold, foreground, tabular), the words around it are
 * quiet. "2 of 10", "242 nodes", "90 days", "3 · Unlimited" all read as a
 * number first. `data-reading` marks the whole value, whose text is still the
 * plain phrase ("2 of 10") for anyone reading it as one string.
 */
export function Reading({
	figure,
	qualifier,
	size = "md",
	className,
}: {
	figure: ReactNode;
	qualifier?: ReactNode;
	size?: ReadingSize;
	className?: string;
}) {
	const scale = READING_SIZE[size];
	return (
		<span
			data-reading=""
			className={cn(
				"inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap",
				className,
			)}
		>
			<span
				className={cn(
					"font-semibold tabular-nums text-foreground",
					scale.number,
				)}
			>
				{figure}
			</span>
			{qualifier ? (
				<>
					{" "}
					<span
						className={cn(
							"inline-flex items-center gap-1 text-muted-foreground",
							scale.qualifier,
						)}
					>
						{qualifier}
					</span>
				</>
			) : null}
		</span>
	);
}

/**
 * A count against its limit: "2 of 10", or "3 · Unlimited" when there is no
 * ceiling. The figure is the one strong value; the limit, or "Unlimited", is
 * the quieter qualifier beside it. "Unlimited" is spelled out alone, with no
 * ∞ glyph beside it: the glyph only said the same word a second time.
 */
export function UsageReading({
	used,
	limit,
	size = "md",
	className,
}: {
	used: number;
	/** Null = unlimited. */
	limit: number | null;
	size?: ReadingSize;
	className?: string;
}) {
	const meter = computeMeter(used, limit);
	if (meter.limit === null) {
		return (
			<Reading
				size={size}
				className={className}
				figure={formatCount(meter.used)}
				qualifier={
					<>
						<span aria-hidden="true">·</span>
						<span>Unlimited</span>
					</>
				}
			/>
		);
	}
	return (
		<Reading
			size={size}
			className={className}
			figure={formatCount(meter.used)}
			qualifier={`of ${formatCount(meter.limit)}`}
		/>
	);
}

/**
 * What sits under a count's reading: the bar (only against a finite limit —
 * an empty track against an infinite one would imply a ceiling that does not
 * exist) and the caption. Renders nothing when there is neither.
 */
export function UsageMeterDetail({
	label,
	used,
	limit,
	caption,
	size = "md",
	className,
}: {
	/** Names the bar for assistive tech: "Projects: 2 of 10". */
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
	if (meter.limit === null && !caption) return null;
	return (
		<div className={className}>
			{meter.limit !== null ? (
				<MeterBar
					className={USAGE_TRACK}
					percent={meter.percent}
					tone={tone}
					label={`${label}: ${formatCount(meter.used)} of ${formatCount(meter.limit)}`}
				/>
			) : null}
			{caption ? (
				<MeterCaption
					tone={tone}
					className={
						meter.limit !== null
							? size === "sm"
								? "mt-1.5"
								: "mt-2"
							: undefined
					}
				>
					{caption}
				</MeterCaption>
			) : null}
		</div>
	);
}

/**
 * A labelled count on its own: the label and reading on one line, the bar and
 * caption under them. Settings rows that already draw their own label compose
 * `UsageReading` and `UsageMeterDetail` directly instead.
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
				<UsageReading used={used} limit={limit} size={small ? "sm" : "md"} />
			</div>
			<UsageMeterDetail
				className={small ? "mt-1.5" : "mt-2"}
				label={label}
				used={used}
				limit={limit}
				caption={caption}
				size={size}
			/>
		</div>
	);
}
