import type { LucideIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Card-free building blocks for the workspace settings pages.
 *
 * Every page is one column of sections separated by hairline rules, with the
 * section's title and explanation in a narrow left column on wide screens —
 * the layout settings pages in Linear, Vercel and GitHub share. Nothing here
 * draws a box, a background or a shadow: structure comes from whitespace,
 * rules and type weight, so the pages read as one document rather than a
 * stack of tiles.
 */

export function SettingsPageHeader({
	title,
	description,
	actions,
}: {
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<header className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
			<div className="min-w-0">
				<h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[28px] sm:leading-9">
					{title}
				</h1>
				{description ? (
					<p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
						{description}
					</p>
				) : null}
			</div>
			{/* Buttons are as tall as the title's line, so on wide screens the
			    actions sit level with the title instead of drifting to the
			    description. */}
			{actions ? (
				<div className="flex shrink-0 flex-wrap items-center gap-2">
					{actions}
				</div>
			) : null}
		</header>
	);
}

/**
 * One titled band of a settings page. The title column collapses above the
 * content on narrow screens.
 */
export function SettingsSection({
	title,
	description,
	children,
	tone = "default",
	id,
	className,
}: {
	title: ReactNode;
	description?: ReactNode;
	children: ReactNode;
	tone?: "default" | "danger";
	id?: string;
	className?: string;
}) {
	const headingId = id ? `${id}-heading` : undefined;
	return (
		<section
			id={id}
			aria-labelledby={headingId}
			className={cn(
				"grid gap-x-10 gap-y-5 border-b border-border py-8 last:border-b-0 lg:grid-cols-[220px_minmax(0,1fr)]",
				className,
			)}
		>
			<div className="min-w-0">
				<h2
					id={headingId}
					className={cn(
						"text-sm font-semibold leading-5",
						tone === "danger" ? "text-destructive" : "text-foreground",
					)}
				>
					{title}
				</h2>
				{description ? (
					<p className="mt-1 text-sm leading-relaxed text-muted-foreground">
						{description}
					</p>
				) : null}
			</div>
			<div className="min-w-0">{children}</div>
		</section>
	);
}

/** A ruled list of rows inside a section. */
export function SettingsRows({
	children,
	className,
	as: Tag = "div",
}: {
	children: ReactNode;
	className?: string;
	as?: "div" | "ul";
}) {
	return (
		<Tag className={cn("divide-y divide-border", className)}>{children}</Tag>
	);
}

/**
 * A label (and optional description) on the left, a value or control on the
 * right.
 *
 * The row is a grid: an optional `leading` column (an icon or avatar), the
 * text column, and the value column. On narrow screens the value drops under
 * the text — still in the text column, so it lines up with the label rather
 * than with the icon — unless the row is `inline`, which keeps a short value
 * (a count, a duration) beside its label at every width. `below` renders
 * under the row from the text column to the right edge: a meter bar, a
 * caption, an inline form.
 *
 * `align="start"` (the default) sets the value on the label's line, so a row
 * with a description reads the same as one without. `align="center"` centres
 * everything on the row instead, for rows led by an avatar and ending in
 * controls.
 *
 * `wrap` is for a row whose value is a wide cluster of controls (a role
 * picker and a Remove button). Screen width says little about the room such
 * a row really has: the settings rail and the section-title column both eat
 * into it. So instead of switching at a breakpoint, the text keeps at least
 * 12rem and the controls drop under it, still in the text column, whenever
 * the two no longer fit side by side; the text only truncates past that.
 */
export function SettingsRow({
	label,
	description,
	children,
	below,
	leading,
	align = "start",
	inline = false,
	wrap = false,
	as: Tag = "div",
	className,
}: {
	label: ReactNode;
	description?: ReactNode;
	children?: ReactNode;
	below?: ReactNode;
	leading?: ReactNode;
	align?: "start" | "center";
	inline?: boolean;
	wrap?: boolean;
	as?: "div" | "li";
	className?: string;
}) {
	const hasValue =
		children !== undefined && children !== null && children !== false;
	const hasLeading = Boolean(leading);

	const text = (
		<>
			<div className="text-sm font-medium leading-5 text-foreground">
				{label}
			</div>
			{description ? (
				<div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
					{description}
				</div>
			) : null}
		</>
	);

	if (wrap) {
		return (
			<Tag className={cn("py-4 first:pt-0 last:pb-0", className)}>
				<div className="flex items-start gap-3">
					{hasLeading ? (
						// Nudged down so an avatar centres on a label with a
						// description under it, whether or not the controls wrap.
						<div className="flex shrink-0 items-center justify-center pt-0.5">
							{leading}
						</div>
					) : null}
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
							<div className="min-w-0 grow basis-48">{text}</div>
							{hasValue ? (
								<div className="flex min-h-5 shrink-0 items-center gap-3 text-sm leading-5">
									{children}
								</div>
							) : null}
						</div>
						{below ? <div className="mt-2.5 min-w-0">{below}</div> : null}
					</div>
				</div>
			</Tag>
		);
	}
	const valueColumns = hasLeading
		? "grid-cols-[auto_minmax(0,1fr)_auto]"
		: "grid-cols-[minmax(0,1fr)_auto]";
	const stackedColumns = hasLeading
		? "grid-cols-[auto_minmax(0,1fr)]"
		: "grid-cols-[minmax(0,1fr)]";
	const wideColumns = hasLeading
		? "sm:grid-cols-[auto_minmax(0,1fr)_auto]"
		: "sm:grid-cols-[minmax(0,1fr)_auto]";

	return (
		<Tag className={cn("py-4 first:pt-0 last:pb-0", className)}>
			<div
				className={cn(
					"grid gap-x-3 gap-y-2",
					align === "center" ? "items-center" : "items-start",
					hasValue && inline ? valueColumns : stackedColumns,
					hasValue ? wideColumns : undefined,
				)}
			>
				{hasLeading ? (
					<div
						className={cn(
							"flex shrink-0 items-center justify-center",
							// Centres a small icon on the label's 20px line.
							align === "start" ? "min-h-5" : undefined,
						)}
					>
						{leading}
					</div>
				) : null}
				<div className="min-w-0">{text}</div>
				{hasValue ? (
					<div
						className={cn(
							"flex min-h-5 min-w-0 flex-wrap items-center gap-2 text-sm leading-5",
							inline
								? "justify-end pl-3 text-right"
								: cn(
										hasLeading ? "col-start-2 sm:col-start-auto" : undefined,
										"justify-start sm:justify-end sm:pl-3 sm:text-right",
									),
						)}
					>
						{children}
					</div>
				) : null}
				{below ? (
					<div
						className={cn(
							"mt-0.5 min-w-0",
							hasLeading ? "col-[2/-1]" : "col-[1/-1]",
						)}
					>
						{below}
					</div>
				) : null}
			</div>
		</Tag>
	);
}

/** Big-number readouts laid out on a grid, with no boxes around them. */
export function SettingsStats({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<dl
			className={cn(
				"grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3",
				className,
			)}
		>
			{children}
		</dl>
	);
}

export function SettingsStat({
	label,
	value,
	hint,
}: {
	label: ReactNode;
	value: ReactNode;
	hint?: ReactNode;
}) {
	return (
		<div className="min-w-0">
			<dt className="text-xs font-medium text-muted-foreground">{label}</dt>
			<dd className="mt-1.5 text-2xl font-semibold leading-8 tabular-nums tracking-tight text-foreground">
				{value}
			</dd>
			{hint ? (
				<dd className="mt-1 text-xs leading-relaxed text-muted-foreground">
					{hint}
				</dd>
			) : null}
		</div>
	);
}

/**
 * The one large value a section leads with — a plan's name — with an
 * optional badge beside it and a supporting line under it. Billing and Usage
 * both open on it, so the two Plan bands read the same.
 */
export function SettingsHeadline({
	value,
	aside,
	badge,
	children,
}: {
	value: ReactNode;
	/** Quiet text on the value's baseline, e.g. "billed monthly". */
	aside?: ReactNode;
	badge?: ReactNode;
	/** The supporting line(s) under the value. */
	children?: ReactNode;
}) {
	return (
		<div>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
				<p className="text-2xl font-semibold leading-8 tracking-tight text-foreground">
					{value}
					{aside ? (
						<span className="ml-2 text-sm font-normal tracking-normal text-muted-foreground">
							{aside}
						</span>
					) : null}
				</p>
				{badge}
			</div>
			{children ? (
				<div className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
					{children}
				</div>
			) : null}
		</div>
	);
}

const NOTICE_TONE = {
	info: "border-primary text-foreground [&_svg]:text-primary",
	success: "border-success text-foreground [&_svg]:text-success",
	warning: "border-warning text-foreground [&_svg]:text-warning-foreground",
	danger: "border-destructive text-foreground [&_svg]:text-destructive",
} as const;

/**
 * An inline notice marked by a coloured rule on its leading edge rather than
 * a filled box, so it sits in the page instead of floating over it.
 */
export function SettingsNotice({
	tone = "info",
	icon: Icon,
	title,
	children,
	action,
	className,
	role,
}: {
	tone?: keyof typeof NOTICE_TONE;
	icon?: LucideIcon;
	title?: ReactNode;
	children?: ReactNode;
	action?: ReactNode;
	className?: string;
	role?: "status" | "alert";
}) {
	return (
		<div
			role={role}
			className={cn(
				"flex gap-3 border-l-2 py-1 pl-4 text-sm",
				NOTICE_TONE[tone],
				className,
			)}
		>
			{Icon ? (
				<Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
			) : null}
			<div className="min-w-0 flex-1">
				{title ? <p className="font-medium text-foreground">{title}</p> : null}
				{children ? (
					<div
						className={cn(
							"leading-relaxed text-muted-foreground",
							title ? "mt-0.5" : undefined,
						)}
					>
						{children}
					</div>
				) : null}
				{action ? <div className="mt-3">{action}</div> : null}
			</div>
		</div>
	);
}

const FOCUS =
	"outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * Button styles shared by every settings page. Every filled or outlined
 * button carries a 1px border (transparent on the primary) and a fixed
 * height, so a primary and a secondary side by side are the same size.
 */
export const settingsButton = {
	primary: cn(
		"inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-transparent bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-60",
		FOCUS,
	),
	secondary: cn(
		"inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-border bg-background px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-60",
		FOCUS,
	),
	danger: cn(
		"inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-destructive/40 bg-background px-3.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-60",
		FOCUS,
	),
	link: cn(
		"inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-primary hover:underline",
		FOCUS,
	),
} as const;

/**
 * Input styles for settings forms: flat, full-width up to a readable measure.
 * The border is the theme's `input` token, a step stronger than the section
 * hairlines, so a field reads as a field rather than as another rule.
 */
export const settingsInput =
	"w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60";

/** Up to two initials: the first and last word of a display name. */
export function initialsOf(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	const first = words[0]?.charAt(0) ?? "";
	const last =
		words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? "") : "";
	return (first + last).toUpperCase() || "?";
}

/**
 * A person's photo on a settings row, or their initials on a muted disc when
 * they have none — or when the photo fails to load, so a broken link never
 * spills its alt text into the circle.
 */
export function SettingsAvatar({
	name,
	src,
}: {
	name: string;
	src?: string | null;
}) {
	const [failedSrc, setFailedSrc] = useState<string | null>(null);
	if (src && src !== failedSrc) {
		return (
			<img
				src={src}
				alt={name}
				onError={() => setFailedSrc(src)}
				className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-border"
			/>
		);
	}
	return (
		<span
			aria-hidden="true"
			className="flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground ring-1 ring-border"
		>
			{initialsOf(name)}
		</span>
	);
}

/** Loading placeholder shaped like a settings page: ruled bands of rows. */
export function SettingsSkeleton({
	bands = 3,
	label = "Loading",
}: {
	bands?: number;
	/** What assistive tech hears while the page loads. */
	label?: string;
}) {
	return (
		<div aria-busy="true">
			<p role="status" className="sr-only">
				{label}
			</p>
			<div aria-hidden="true" className="animate-pulse">
				{Array.from({ length: bands }, (_, index) => (
					<div
						key={index}
						className="grid gap-x-10 gap-y-5 border-b border-border py-8 last:border-b-0 lg:grid-cols-[220px_minmax(0,1fr)]"
					>
						<div>
							<div className="h-3.5 w-24 rounded bg-muted" />
							<div className="mt-2.5 h-3 w-40 max-w-full rounded bg-muted" />
						</div>
						<div className="space-y-4">
							<div className="flex items-center justify-between gap-6">
								<div className="h-3.5 w-1/3 rounded bg-muted" />
								<div className="h-3.5 w-16 rounded bg-muted" />
							</div>
							<div className="h-1.5 w-full rounded-full bg-muted" />
							<div className="flex items-center justify-between gap-6">
								<div className="h-3.5 w-1/2 rounded bg-muted" />
								<div className="h-3.5 w-12 rounded bg-muted" />
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
