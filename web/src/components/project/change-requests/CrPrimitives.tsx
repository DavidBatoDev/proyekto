import { CircleAlert, Loader2, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { ChangeRequest } from "@/services/delivery.service";

/**
 * Atoms for the Change Requests queue.
 *
 * These are deliberately not the delivery primitives. A change request is a
 * ledger entry awaiting a ruling, so the surface reads like a console: square
 * corners, hairline rules instead of shadows, `tabular-nums` everywhere a signed
 * day count appears, and status as an inline dot rather than a badge — a wall of
 * pills in a dense queue is noise, and the queue's grouping already carries the
 * status.
 *
 * If any of these ever collapse back into looking like `DeliveryPrimitives`, the
 * fork stopped paying for itself and they should be re-merged.
 */

// ─── Status ─────────────────────────────────────────────────────────────────

const STATUS_DOT: Record<ChangeRequest["status"], string> = {
	draft: "bg-muted-foreground/50",
	submitted: "bg-warning",
	approved: "bg-info",
	applied: "bg-success",
	rejected: "bg-destructive",
	changes_requested: "bg-warning",
	withdrawn: "bg-muted-foreground/40",
};

/** Status as a dot and a word — no pill, no border, no background. */
export function CrStatusDot({
	status,
	label,
	className = "",
}: {
	status: ChangeRequest["status"];
	label: string;
	className?: string;
}) {
	return (
		<span
			className={`inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground ${className}`}
		>
			<span
				aria-hidden
				className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[status]}`}
			/>
			{label}
		</span>
	);
}

/**
 * A signed day count.
 *
 * `tabular-nums` so a column of these lines up, and the sign is always shown —
 * "+5d" and "-3d" mean opposite things and a bare "5d" is ambiguous.
 */
export function CrDays({
	days,
	className = "",
}: {
	days: number | null;
	className?: string;
}) {
	const chip =
		"inline-flex min-w-[3.25rem] justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums";

	// Nobody stated an impact.
	if (days === null) {
		return (
			<span
				className={`${chip} text-muted-foreground/50 ${className}`}
				title="No schedule impact stated"
			>
				—
			</span>
		);
	}
	// Someone stated explicitly that it costs nothing — a different claim from
	// "not stated", and the one an approver is most likely to want to trust.
	if (days === 0) {
		return (
			<span
				className={`${chip} bg-muted text-muted-foreground ${className}`}
				title="Stated as no change to the schedule"
			>
				0d
			</span>
		);
	}
	return (
		<span
			className={`${chip} ${
				days > 0 ? "bg-warning/15 text-warning" : "bg-success/15 text-success"
			} ${className}`}
			title={
				days > 0
					? `Pushes the schedule out by ${days} days`
					: `Pulls the schedule in by ${Math.abs(days)} days`
			}
		>
			{days > 0 ? `+${days}` : days}d
		</span>
	);
}

// ─── Page chrome ────────────────────────────────────────────────────────────

/**
 * The queue's page frame: a ledger bar, not the delivery icon-tile header.
 *
 * The two schedule figures live in the bar because they are the page's running
 * totals — the thing a ledger puts at the top and keeps visible while you scroll.
 */
export function CrPageShell({
	title,
	subtitle,
	ledger,
	action,
	children,
}: {
	title: string;
	subtitle: string;
	ledger?: ReactNode;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="app-shell-bg h-full w-full overflow-y-auto">
			<header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
				<div className="flex w-full flex-wrap items-center justify-between gap-x-8 gap-y-3 px-6 py-3 md:px-8">
					<div className="min-w-0">
						<h1 className="text-base font-semibold tracking-tight text-foreground">
							{title}
						</h1>
						<p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
					</div>
					<div className="flex flex-wrap items-center gap-3">
						{ledger}
						{action}
					</div>
				</div>
			</header>
			{/* Full-bleed. The row's own column grid is what stops a wide screen from
			    becoming a void — see `CrRow`, which promotes requester, affected work
			    and status into real columns from `lg` up. */}
			<div className="w-full px-6 py-6 md:px-8">{children}</div>
		</div>
	);
}

/**
 * A block of the request record.
 *
 * A labelled panel with a hairline top rule — squarer and tighter than the
 * Decisions record, which is a document. This one is a form you are auditing.
 */
export function CrSection({
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
		<section className="border-t border-border py-4 first:border-t-0 first:pt-0">
			<div className="mb-2 flex items-baseline justify-between gap-4">
				<h2 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
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

/** A label/value pair inside a record section. */
export function CrFact({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="flex items-baseline gap-3 py-1 text-sm">
			<span className="w-28 shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground">
				{label}
			</span>
			<span className="min-w-0 flex-1 text-foreground">{children}</span>
		</div>
	);
}

/**
 * One figure in the header ledger, as a chip.
 *
 * Two bare numbers side by side read as "0d 0d" — a pair of nothings with tiny
 * captions. A chip with its own icon and tint gives each figure an edge to sit
 * in, and lets a live number carry colour while a zero stays quiet.
 */
export function CrLedgerFigure({
	value,
	label,
	icon: Icon,
	tone = "neutral",
	hint,
}: {
	value: ReactNode;
	label: string;
	icon: LucideIcon;
	/** `neutral` when the figure is zero — nothing is pending, so nothing shouts. */
	tone?: "neutral" | "pending" | "committed";
	hint?: string;
}) {
	const tones: Record<string, string> = {
		neutral: "border-border bg-muted/40 text-muted-foreground",
		pending: "border-warning/30 bg-warning/10 text-warning",
		committed: "border-success/30 bg-success/10 text-success",
	};
	return (
		<span
			className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${tones[tone]}`}
			title={hint}
		>
			<Icon className="h-3.5 w-3.5 shrink-0" />
			<span className="leading-none">
				<span className="block text-sm font-semibold tabular-nums">
					{value}
				</span>
				<span className="mt-0.5 block text-[10px] font-medium uppercase tracking-wider opacity-70">
					{label}
				</span>
			</span>
		</span>
	);
}

/**
 * Skeleton shaped like the queue: a couple of group headers with rows under
 * them, not a stack of cards.
 */
export function CrSkeleton({ groups = 2 }: { groups?: number }) {
	return (
		<div className="app-shell-bg h-full w-full animate-pulse overflow-y-auto">
			<div className="border-b border-border bg-card/95 px-6 pb-2.5 pt-3 md:px-10">
				<div className="h-4 w-36 rounded bg-muted" />
				<div className="mt-1.5 h-3 w-56 rounded bg-muted" />
			</div>
			<div className="w-full px-6 py-5 md:px-10 md:py-7">
				{Array.from({ length: groups }, (_, index) => `group-${index}`).map(
					(key) => (
						<div key={key} className="mb-6">
							<div className="mb-2 h-3 w-40 rounded bg-muted" />
							<div className="overflow-hidden rounded-md border border-border">
								{["a", "b", "c"].map((row) => (
									<div
										key={row}
										className="flex items-center gap-3 border-b border-border/60 px-3 py-2.5 last:border-b-0"
									>
										<div className="h-3 w-14 rounded bg-muted" />
										<div className="h-3 flex-1 max-w-sm rounded bg-muted" />
										<div className="h-3 w-8 rounded bg-muted" />
									</div>
								))}
							</div>
						</div>
					),
				)}
			</div>
		</div>
	);
}

/** The blank queue. Squared off and rule-bound, matching the rows it replaces. */
export function CrEmpty({
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
		<div className="rounded-md border border-dashed border-border px-6 py-16 text-center">
			<Icon className="mx-auto h-6 w-6 text-muted-foreground/60" />
			<p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
			<p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
				{description}
			</p>
			{action && <div className="mt-5">{action}</div>}
		</div>
	);
}

// ─── Buttons ────────────────────────────────────────────────────────────────

/**
 * Compact and square, sized to sit inside a table row without changing its
 * height — the delivery pill button is 36px tall and would set the row height on
 * its own.
 */
export function CrButton({
	children,
	onClick,
	disabled,
	loading = false,
	tone = "default",
	type = "button",
	form,
	title,
}: {
	children: ReactNode;
	onClick?: () => void;
	disabled?: boolean;
	loading?: boolean;
	tone?: "default" | "primary" | "positive" | "danger";
	type?: "button" | "submit";
	form?: string;
	title?: string;
}) {
	const tones: Record<string, string> = {
		default: "border-border text-foreground hover:bg-muted",
		primary:
			"border-primary bg-primary text-primary-foreground hover:opacity-90",
		positive: "border-success/40 text-success hover:bg-success/10",
		danger: "border-destructive/40 text-destructive hover:bg-destructive/10",
	};
	return (
		<button
			type={type === "submit" ? "submit" : "button"}
			form={form}
			onClick={onClick}
			disabled={disabled || loading}
			title={title}
			className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]}`}
		>
			{loading && <Loader2 className="h-3 w-3 animate-spin" />}
			{children}
		</button>
	);
}

/** An icon-only action for the row's trailing cluster. */
export function CrIconButton({
	icon: Icon,
	label,
	onClick,
	disabled,
	tone = "default",
}: {
	icon: LucideIcon;
	label: string;
	onClick?: () => void;
	disabled?: boolean;
	tone?: "default" | "positive" | "danger";
}) {
	const tones: Record<string, string> = {
		default: "text-muted-foreground hover:bg-muted hover:text-foreground",
		positive: "text-muted-foreground hover:bg-success/10 hover:text-success",
		danger:
			"text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
	};
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-label={label}
			title={label}
			className={`rounded-md p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]}`}
		>
			<Icon className="h-3.5 w-3.5" />
		</button>
	);
}

// ─── Form atoms ─────────────────────────────────────────────────────────────

export function CrLabel({ children }: { children: ReactNode }) {
	return (
		<span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
			{children}
		</span>
	);
}

export const crInputClass =
	"w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm text-card-foreground outline-none transition focus:border-primary focus:ring-1 focus:ring-primary/30 disabled:opacity-70";

export function crInputClassFor(invalid?: boolean | string | null): string {
	return invalid
		? `${crInputClass} border-destructive focus:border-destructive focus:ring-destructive/30`
		: crInputClass;
}

export function CrFieldError({
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
