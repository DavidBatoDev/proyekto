import {
	Circle,
	CircleAlert,
	CircleCheck,
	CircleDashed,
	CircleDot,
	CircleX,
	Clock3,
	Flag,
	Loader2,
	type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { SemanticBadge } from "@/components/common/SemanticBadge";
import {
	EpicGlyph,
	FeatureGlyph,
	TaskGlyph,
} from "@/components/roadmap/shared/NodeGlyph";
import type { RoadmapNodeKind } from "./deliveryModel";

/**
 * Shared chrome for the four delivery-governance pages so they read as one
 * product area rather than four separately-invented screens.
 */

/**
 * Semantic meaning of a status, mapped to an icon and a token-based colour.
 *
 * Built on `SemanticBadge` rather than hand-rolled classes: the earlier version
 * hardcoded light-mode palettes (`bg-emerald-50 text-emerald-700`), which broke
 * in dark mode and duplicated the canonical badge system. `text-success` and
 * friends are theme tokens that resolve correctly in both themes.
 */
const TONE_CONFIG: Record<string, { icon: LucideIcon; iconClassName: string }> =
	{
		neutral: { icon: CircleDashed, iconClassName: "text-muted-foreground" },
		progress: { icon: CircleDot, iconClassName: "text-info" },
		review: { icon: Clock3, iconClassName: "text-warning" },
		good: { icon: CircleCheck, iconClassName: "text-success" },
		bad: { icon: CircleX, iconClassName: "text-destructive" },
	};

export type StatusTone = keyof typeof TONE_CONFIG;

export function StatusPill({
	label,
	tone = "neutral",
}: {
	label: string;
	tone?: StatusTone;
}) {
	const config = TONE_CONFIG[tone] ?? {
		icon: Circle,
		iconClassName: "text-muted-foreground",
	};
	return (
		<SemanticBadge
			icon={config.icon}
			iconClassName={config.iconClassName}
			className="uppercase tracking-wide"
		>
			{label}
		</SemanticBadge>
	);
}

/**
 * Completion meter. No shared ProgressBar exists — this mirrors the epic meter
 * in `roadmap/widgets/EpicWidget.tsx`, kept local rather than promoted to an
 * app-wide primitive until a third caller needs it.
 */
export function ProgressMeter({
	percent,
	caption,
	className = "",
}: {
	percent: number | null;
	caption?: string;
	className?: string;
}) {
	// Null means nothing is linked yet — an honest "not tracked" beats a 0% bar
	// that implies no work has happened.
	const tracked = percent !== null;
	return (
		<div className={className}>
			<div className="mb-1 flex items-center justify-between text-xs">
				<span className="text-muted-foreground">{caption ?? "Completion"}</span>
				<span className="font-semibold text-foreground">
					{tracked ? `${percent}%` : "Not tracked"}
				</span>
			</div>
			<div className="h-1.5 overflow-hidden rounded-full bg-muted">
				<div
					className="h-full bg-primary transition-all duration-300"
					style={{ width: `${tracked ? percent : 0}%` }}
				/>
			</div>
		</div>
	);
}

/** Turn a snake_case status into something a person would read. */
export function humanize(value: string): string {
	return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function DeliveryPageShell({
	icon: Icon,
	title,
	subtitle,
	action,
	children,
}: {
	icon: LucideIcon;
	title: string;
	subtitle: string;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="app-shell-bg h-full w-full overflow-y-auto">
			{/* A top bar, not a card: this is page chrome, so it runs edge to edge
			    and stays put while the list scrolls under it. Icon tile + title +
			    subtitle matches the Board and Roadmap headers. */}
			<header className="sticky top-0 z-10 border-b border-border bg-card/90 px-6 py-3 backdrop-blur md:px-10">
				<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
					<div className="flex min-w-0 items-center gap-2.5">
						<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
							<Icon className="h-4 w-4 text-foreground" />
						</div>
						<div className="min-w-0 leading-tight">
							<h1 className="truncate text-sm font-semibold text-foreground">
								{title}
							</h1>
							<p className="truncate text-[11px] text-muted-foreground">
								{subtitle}
							</p>
						</div>
					</div>
					{action}
				</div>
			</header>

			{/* Full-bleed body, like Overview and Resources — the pipeline board
			    wants the whole viewport. */}
			<div className="w-full px-6 py-7 md:px-10 md:py-9">{children}</div>
		</div>
	);
}

/**
 * Placeholder shaped like the page it replaces — header card, then a stack of
 * entry cards.
 *
 * Used for BOTH gates on these routes: `RequireProjectAccess` while permissions
 * resolve, and the page itself while its list loads. Passing it as
 * `loadingFallback` matters — the default is a centred spinner, so without it
 * the user watches a spinner swap to a skeleton and the page reads as two
 * separate waits instead of one.
 */
export function DeliverySkeleton({ rows = 3 }: { rows?: number }) {
	return (
		<div className="app-shell-bg h-full w-full animate-pulse overflow-y-auto">
			<div className="flex items-center gap-2.5 border-b border-border bg-card/90 px-6 py-3 md:px-10">
				<div className="h-8 w-8 shrink-0 rounded-lg bg-muted" />
				<div>
					<div className="h-4 w-40 rounded-md bg-muted" />
					<div className="mt-1.5 h-3 w-64 rounded bg-muted" />
				</div>
			</div>
			<div className="w-full px-6 py-7 md:px-10 md:py-9">
				<div className="flex flex-col gap-3">
					{Array.from({ length: rows }, (_, index) => `row-${index}`).map(
						(key) => (
							<div key={key} className="app-surface-card rounded-xl p-5">
								<div className="flex items-center gap-2">
									<div className="h-4 w-48 rounded bg-muted" />
									<div className="h-4 w-16 rounded-full bg-muted" />
								</div>
								<div className="mt-3 h-3 w-full max-w-md rounded bg-muted" />
								<div className="mt-4 grid gap-3 sm:grid-cols-2">
									<div className="h-14 rounded-lg bg-muted/60" />
									<div className="h-14 rounded-lg bg-muted/60" />
								</div>
							</div>
						),
					)}
				</div>
			</div>
		</div>
	);
}

/**
 * The flat bordered list — GitHub's file-list shape rather than an elevated
 * card: a hairline box, a muted header strip carrying a title and one action,
 * and rows divided by rules that highlight on hover.
 *
 * Deliberately NOT `AppSurfaceCard`. These panels are lists of things you act
 * on, and a shadowed, rounded surface makes each one read as a separate object
 * competing with the deliverable itself.
 */
export function ListBox({
	title,
	meta,
	action,
	children,
	className = "",
	bodyClassName = "",
}: {
	title: ReactNode;
	/** Right-aligned count or status, before the action. */
	meta?: ReactNode;
	action?: ReactNode;
	children: ReactNode;
	className?: string;
	/**
	 * Applied to the content area, not the box — a `min-h` here floors the rows
	 * while leaving the header and any footer strip their natural height, so
	 * panels sitting side by side line up whether or not they have content.
	 */
	bodyClassName?: string;
}) {
	return (
		<div
			className={`overflow-hidden rounded-lg border border-border bg-card ${className}`}
		>
			<div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-2">
				<span className="truncate text-xs font-semibold text-foreground">
					{title}
				</span>
				<span className="flex shrink-0 items-center gap-3">
					{meta && (
						<span className="text-[11px] font-medium text-muted-foreground">
							{meta}
						</span>
					)}
					{action}
				</span>
			</div>
			<div className={bodyClassName}>{children}</div>
		</div>
	);
}

/** One row in a `ListBox`. Rules between rows, highlight on hover. */
export function ListRow({
	children,
	className = "",
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={`flex items-center gap-3 border-b border-border/60 px-4 py-2 text-sm transition-colors last:border-b-0 hover:bg-muted/40 ${className}`}
		>
			{children}
		</div>
	);
}

/** The "nothing here yet" line inside a `ListBox`, matching row padding. */
export function ListEmpty({ children }: { children: ReactNode }) {
	return (
		<p className="px-4 py-6 text-center text-sm text-muted-foreground">
			{children}
		</p>
	);
}

/**
 * The roadmap's own glyphs, so a trail rendered here reads exactly as it does
 * on the canvas, the kanban cards and the left panel. `NodeGlyph.tsx` has no
 * milestone artwork — `Flag` is the only milestone icon anywhere in the app —
 * so that level is a lucide icon boxed to match the tiles.
 */
export function RoadmapNodeGlyph({
	kind,
	size = 14,
}: {
	kind: RoadmapNodeKind;
	size?: number;
}) {
	if (kind === "epic") return <EpicGlyph size={size} />;
	if (kind === "feature") return <FeatureGlyph size={size} />;
	if (kind === "task") return <TaskGlyph size={size} />;
	return (
		<span
			className="flex shrink-0 items-center justify-center rounded-[4px] bg-amber-500"
			style={{ width: size, height: size }}
		>
			<Flag className="h-2.5 w-2.5 text-white" />
		</span>
	);
}

/**
 * The blank slate for a whole page.
 *
 * Unboxed on purpose: a card here draws a hard edge around nothing, which is
 * exactly the wrong emphasis. The glyph sits on a soft ring instead, and the
 * copy is centred in the page rather than in a container.
 */
export function DeliveryEmpty({
	icon: Icon,
	title,
	description,
	action,
	/** Optional "here's what you'd get" lines under the copy. */
	hints,
}: {
	icon: LucideIcon;
	title: string;
	description: string;
	action?: ReactNode;
	hints?: readonly string[];
}) {
	return (
		<div className="flex flex-col items-center px-6 py-20 text-center">
			<span className="relative mb-6 flex h-16 w-16 items-center justify-center">
				{/* Two rings, so the glyph reads as an illustration rather than a
				    lonely icon on a flat background. */}
				<span className="absolute inset-0 rounded-2xl bg-primary/10" />
				<span className="absolute inset-2 rounded-xl bg-primary/15" />
				<Icon className="relative h-7 w-7 text-primary" />
			</span>

			<h2 className="text-lg font-semibold tracking-tight text-foreground">
				{title}
			</h2>
			<p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
				{description}
			</p>

			{hints && hints.length > 0 && (
				<ul className="mt-6 flex flex-wrap items-center justify-center gap-2">
					{hints.map((hint) => (
						<li
							key={hint}
							className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground"
						>
							<CircleCheck className="h-3.5 w-3.5 text-success" />
							{hint}
						</li>
					))}
				</ul>
			)}

			{action && <div className="mt-7">{action}</div>}
		</div>
	);
}

export function PrimaryButton({
	children,
	onClick,
	disabled,
	loading = false,
	type = "button",
	form,
}: {
	children: ReactNode;
	onClick?: () => void;
	disabled?: boolean;
	/** Swaps the leading icon for a spinner and blocks a second submit. */
	loading?: boolean;
	type?: "button" | "submit";
	/** Submits a form by id — lets the button live in a dialog footer, outside the <form>. */
	form?: string;
}) {
	return (
		<button
			type={type === "submit" ? "submit" : "button"}
			form={form}
			onClick={onClick}
			disabled={disabled || loading}
			className="app-cta inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
		>
			{loading && <Loader2 className="h-4 w-4 animate-spin" />}
			{children}
		</button>
	);
}

export function SecondaryButton({
	children,
	onClick,
	disabled,
	tone = "neutral",
}: {
	children: ReactNode;
	onClick?: () => void;
	disabled?: boolean;
	tone?: "neutral" | "danger";
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
				tone === "danger"
					? "border-destructive/30 text-destructive hover:bg-destructive/10"
					: "border-border text-foreground hover:bg-muted"
			}`}
		>
			{children}
		</button>
	);
}

export function FieldLabel({ children }: { children: ReactNode }) {
	return (
		<span className="mb-1 block text-xs font-semibold text-muted-foreground">
			{children}
		</span>
	);
}

export const inputClass =
	"w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-card-foreground shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-70";

/**
 * The same input, ringed in the destructive token when its field has failed
 * validation — the message alone is easy to miss on a form with eight rows.
 */
export function inputClassFor(invalid?: boolean | string | null): string {
	return invalid
		? `${inputClass} border-destructive focus:border-destructive focus:ring-destructive/25`
		: inputClass;
}

/**
 * Inline validation message.
 *
 * `role="alert"` so a screen reader announces it when it appears; pair it with
 * `aria-invalid` and `aria-describedby` on the field itself.
 */
export function FieldError({
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
