import { CircleAlert, Loader2, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Decision } from "@/services/delivery.service";

/**
 * Atoms for the Decisions log.
 *
 * A decision is a record, not a task, so this surface reads like something
 * printed: generous leading, rules instead of boxes, quiet text-first buttons,
 * and status carried by a dot on the timeline rail rather than a badge beside
 * every title. Nothing here has a shadow.
 *
 * Contrast with `change-requests/CrPrimitives` — that surface is a console, tight
 * and utilitarian. If these two ever converge, one of them stopped earning its
 * own file.
 */

// ─── Status on the rail ─────────────────────────────────────────────────────

/**
 * The dot the timeline hangs each entry from.
 *
 * Filled = settled, ringed = still being argued, hollow = replaced. The three
 * read as different weights of the same mark, so the rail scans as one line
 * rather than a column of icons.
 */
export function DecisionRailDot({ status }: { status: Decision["status"] }) {
	if (status === "proposed") {
		return (
			<span
				aria-hidden
				className="block h-2.5 w-2.5 rounded-full border-2 border-dashed border-warning bg-background"
			/>
		);
	}
	if (status === "superseded") {
		return (
			<span
				aria-hidden
				className="block h-2.5 w-2.5 rounded-full border border-muted-foreground/50 bg-background"
			/>
		);
	}
	return (
		<span aria-hidden className="block h-2.5 w-2.5 rounded-full bg-success" />
	);
}

/** A quiet status word. No pill, no background — the rail already says it. */
export function DecisionStatusText({
	status,
	label,
}: {
	status: Decision["status"];
	label: string;
}) {
	const tone =
		status === "proposed"
			? "text-warning"
			: status === "superseded"
				? "text-muted-foreground"
				: "text-success";
	return <span className={`text-[11px] font-medium ${tone}`}>{label}</span>;
}

// ─── Page chrome ────────────────────────────────────────────────────────────

/**
 * The log's frame: a filter rail on the left, the feed scrolling on the right.
 *
 * Two independent scrollers, modelled on the project Activity page. The page
 * itself never scrolls, so the rail stays put while a long history runs past it.
 */
export function DecisionPageShell({
	rail,
	mobileRail,
	title,
	subtitle,
	ledger,
	action,
	children,
}: {
	rail: ReactNode;
	/** The same filters as a slide-over, for widths where the rail is hidden. */
	mobileRail?: ReactNode;
	title: string;
	subtitle: string;
	ledger?: ReactNode;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="app-shell-bg flex h-full w-full overflow-hidden">
			<aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-border bg-card/40 md:block">
				{rail}
			</aside>
			{mobileRail}

			<main className="flex min-w-0 flex-1 flex-col overflow-hidden">
				<header className="border-b border-border px-5 py-3 md:px-8">
					<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
						<div className="min-w-0">
							<h1 className="text-sm font-semibold tracking-tight text-foreground">
								{title}
							</h1>
							<p className="mt-0.5 text-[11px] text-muted-foreground">
								{subtitle}
							</p>
						</div>
						<div className="flex flex-wrap items-center gap-x-5 gap-y-2">
							{ledger}
							{action}
						</div>
					</div>
				</header>
				<div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
			</main>
		</div>
	);
}

/**
 * The header's running counts, as a sentence rather than a stat grid.
 *
 * The old page led with "84% of live decisions are settled". A percentage is a
 * progress metric, and a decision log is not work in progress — nobody is trying
 * to drive this number anywhere.
 */
export function DecisionLedger({ children }: { children: ReactNode }) {
	return (
		<p className="text-[11px] tabular-nums text-muted-foreground">{children}</p>
	);
}

/**
 * A section of the record page.
 *
 * A rule and a small caption, not a bordered box. The detail pages for all three
 * governance surfaces used to be two `ListBox`es side by side, which is why they
 * were indistinguishable; a record reads top to bottom in one column, the way a
 * document does.
 */
export function RecordSection({
	title,
	meta,
	action,
	children,
}: {
	title: string;
	meta?: ReactNode;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="border-t border-border py-5 first:border-t-0 first:pt-0">
			<div className="mb-2.5 flex items-baseline justify-between gap-4">
				<h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
					{title}
					{meta && (
						<span className="ml-2 tabular-nums text-muted-foreground/70">
							{meta}
						</span>
					)}
				</h2>
				{action}
			</div>
			{children}
		</section>
	);
}

/** Body copy inside a record section, or a muted line when there is none. */
export function RecordProse({ children }: { children?: string | null }) {
	if (!children) {
		return (
			<p className="text-sm text-muted-foreground/70">Nothing recorded.</p>
		);
	}
	return (
		<p className="max-w-2xl whitespace-pre-wrap text-sm leading-relaxed text-foreground">
			{children}
		</p>
	);
}

/** Sticky month band, borrowed from the activity feed's day bands. */
export function MonthBand({ label }: { label: string }) {
	return (
		<div className="sticky top-0 z-10 border-y border-border bg-muted/60 px-5 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground backdrop-blur md:px-8">
			{label}
		</div>
	);
}

export function DecisionSkeleton() {
	return (
		<div className="app-shell-bg flex h-full w-full animate-pulse overflow-hidden">
			<div className="hidden w-60 shrink-0 border-r border-border bg-card/40 p-4 md:block">
				<div className="h-3 w-20 rounded bg-muted" />
				<div className="mt-3 space-y-2">
					{["a", "b", "c", "d"].map((key) => (
						<div key={key} className="h-3 w-full rounded bg-muted" />
					))}
				</div>
			</div>
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="border-b border-border px-5 py-3 md:px-8">
					<div className="h-4 w-28 rounded bg-muted" />
					<div className="mt-1.5 h-3 w-64 rounded bg-muted" />
				</div>
				<div className="px-5 py-4 md:px-8">
					{["a", "b", "c", "d"].map((key) => (
						<div key={key} className="mb-6 flex gap-4">
							<div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-muted" />
							<div className="min-w-0 flex-1 space-y-2">
								<div className="h-3.5 w-64 rounded bg-muted" />
								<div className="h-3 w-full max-w-lg rounded bg-muted" />
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

/** The blank log. Centred, unboxed — nothing to draw a border around. */
export function DecisionEmpty({
	icon: Icon,
	title,
	description,
	action,
}: {
	icon: LucideIcon;
	title: string;
	description: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex flex-col items-center px-6 py-20 text-center">
			<Icon className="h-7 w-7 text-muted-foreground/50" />
			<p className="mt-4 text-base font-semibold text-foreground">{title}</p>
			<p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
				{description}
			</p>
			{action && <div className="mt-6">{action}</div>}
		</div>
	);
}

// ─── Buttons ────────────────────────────────────────────────────────────────

/**
 * Text-first and quiet. A record page should not be covered in call-to-action
 * buttons; the one thing you do here often is read.
 */
export function DecisionButton({
	children,
	onClick,
	disabled,
	loading = false,
	tone = "quiet",
	type = "button",
	form,
}: {
	children: ReactNode;
	onClick?: () => void;
	disabled?: boolean;
	loading?: boolean;
	tone?: "quiet" | "solid" | "danger";
	type?: "button" | "submit";
	form?: string;
}) {
	const tones: Record<string, string> = {
		quiet:
			"text-foreground underline-offset-4 hover:bg-muted hover:underline border-transparent",
		solid: "bg-foreground text-background border-transparent hover:opacity-90",
		danger:
			"text-destructive border-transparent hover:bg-destructive/10 hover:underline",
	};
	return (
		<button
			type={type === "submit" ? "submit" : "button"}
			form={form}
			onClick={onClick}
			disabled={disabled || loading}
			className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]}`}
		>
			{loading && <Loader2 className="h-3 w-3 animate-spin" />}
			{children}
		</button>
	);
}

// ─── Form atoms ─────────────────────────────────────────────────────────────

export function DecisionLabel({ children }: { children: ReactNode }) {
	return (
		<span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
			{children}
		</span>
	);
}

/**
 * Underlined rather than boxed — the create form reads as something you write
 * on, which suits a record better than a grid of input wells.
 */
export const decisionInputClass =
	"w-full rounded-none border-0 border-b border-input bg-transparent px-0 py-1.5 text-sm text-foreground outline-none transition focus:border-primary disabled:opacity-70";

export function decisionInputClassFor(
	invalid?: boolean | string | null,
): string {
	return invalid
		? `${decisionInputClass} border-destructive focus:border-destructive`
		: decisionInputClass;
}

export function DecisionFieldError({
	id,
	children,
}: {
	id?: string;
	children?: string | null;
}) {
	if (!children) return null;
	return (
		<span
			id={id}
			role="alert"
			className="mt-1 flex items-center gap-1 text-[11px] font-medium text-destructive"
		>
			<CircleAlert className="h-3 w-3 shrink-0" />
			{children}
		</span>
	);
}
