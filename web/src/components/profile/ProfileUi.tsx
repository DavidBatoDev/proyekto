import { ImagePlus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/brand/BrandMark";

/**
 * The profile page's presentation kit.
 *
 * Pulled out of the 2,000-line route for two reasons. The obvious one is that
 * twelve sections were each hand-rolling their own header, empty state and
 * chrome, so they drifted — different paddings, different heading weights, four
 * shades of grey for the same "muted" text. The second is that every one of
 * those was written in literal palette classes (`bg-white`, `text-gray-900`),
 * which means the page only ever worked in one theme. Everything here speaks in
 * tokens instead.
 */

export function ProfileCard({
	children,
	className = "",
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<section
			className={`rounded-2xl border border-border bg-card shadow-[0_1px_2px_0_rgb(0_0_0/0.03)] ${className}`}
		>
			{children}
		</section>
	);
}

/**
 * One section's header: an icon in a tinted square, the title, an optional
 * count, and the owner's action on the right.
 *
 * The count is deliberately part of the header rather than a line of prose
 * underneath — on a profile with eleven roles and nine certifications, "how
 * much is in here" is the first thing somebody scanning wants to know.
 */
export function ProfileSectionHeader({
	title,
	icon: Icon,
	count,
	action,
	className = "",
}: {
	title: string;
	icon?: React.ElementType;
	count?: number;
	action?: ReactNode;
	className?: string;
}) {
	return (
		<div className={`flex items-start justify-between gap-3 ${className}`}>
			<div className="flex items-center gap-2.5">
				{Icon && (
					<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<Icon className="h-4 w-4" strokeWidth={2.2} />
					</span>
				)}
				<h2 className="text-[15px] font-semibold tracking-tight text-foreground">
					{title}
					{count !== undefined && count > 0 && (
						<span className="ml-1.5 text-[13px] font-normal text-muted-foreground">
							{count}
						</span>
					)}
				</h2>
			</div>
			{action && (
				<div className="flex shrink-0 items-center gap-1">{action}</div>
			)}
		</div>
	);
}

/** The circular icon button every section uses for add/edit/delete. */
export function IconButton({
	label,
	onClick,
	disabled,
	tone = "default",
	children,
}: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	tone?: "default" | "danger";
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={label}
			aria-label={label}
			className={`flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors disabled:opacity-50 ${
				tone === "danger"
					? "hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
					: "hover:bg-muted hover:text-foreground"
			}`}
		>
			{children}
		</button>
	);
}

/**
 * The owner's "add the first one" affordance, and the visitor's "there is
 * nothing here" line — the same box, because they describe the same state and
 * splitting them is how the two drift apart.
 */
export function ProfileEmptyState({
	message,
	actionLabel,
	onAction,
}: {
	message: string;
	actionLabel?: string;
	onAction?: () => void;
}) {
	return (
		<div className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
			<p className="text-[13px] text-muted-foreground">{message}</p>
			{actionLabel && onAction && (
				<button
					type="button"
					onClick={onAction}
					className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline"
				>
					<Plus className="h-3.5 w-3.5" />
					{actionLabel}
				</button>
			)}
		</div>
	);
}

/**
 * Long prose, clamped until asked.
 *
 * Written against the rendered height rather than a character count: a bio and
 * an eleven-line job description are both "text", and counting characters gets
 * one of them wrong. The toggle only appears when the text actually overflows,
 * so a two-line summary never grows a pointless "Show more".
 */
export function ExpandableText({
	text,
	lines = 4,
	className = "",
}: {
	text: string;
	lines?: number;
	className?: string;
}) {
	const [expanded, setExpanded] = useState(false);
	const [overflows, setOverflows] = useState(false);
	const ref = useRef<HTMLParagraphElement>(null);

	// Layout effect, not effect: measuring after paint makes the button flash in
	// on first render of every long description on the page.
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		setOverflows(element.scrollHeight - element.clientHeight > 4);
	}, []);

	return (
		<div>
			<p
				ref={ref}
				style={
					expanded
						? undefined
						: {
								display: "-webkit-box",
								WebkitLineClamp: lines,
								WebkitBoxOrient: "vertical",
								overflow: "hidden",
							}
				}
				className={`whitespace-pre-line text-[13.5px] leading-relaxed text-muted-foreground ${className}`}
			>
				{text}
			</p>
			{overflows && (
				<button
					type="button"
					onClick={() => setExpanded((current) => !current)}
					className="mt-1 text-[12.5px] font-semibold text-primary hover:underline"
				>
					{expanded ? "Show less" : "Show more"}
				</button>
			)}
		</div>
	);
}

/** An icon-and-value row, as the contact and rate cards render them. */
export function MetaRow({
	icon: Icon,
	children,
}: {
	icon: React.ElementType;
	children: ReactNode;
}) {
	return (
		<div className="flex items-start gap-2.5">
			<Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
			<div className="min-w-0 text-[13px] text-foreground">{children}</div>
		</div>
	);
}

const PROFICIENCY = {
	beginner: { dot: "bg-muted-foreground/40", label: "Beginner" },
	intermediate: { dot: "bg-amber-400", label: "Intermediate" },
	advanced: { dot: "bg-orange-500", label: "Advanced" },
	expert: { dot: "bg-emerald-500", label: "Expert" },
} as const;

export function ProficiencyDot({ level }: { level: string }) {
	const entry = PROFICIENCY[level as keyof typeof PROFICIENCY] ?? {
		dot: "bg-muted-foreground/40",
		label: level,
	};
	return (
		<span className="flex items-center gap-1 text-[11px] text-muted-foreground">
			<span className={`h-1.5 w-1.5 rounded-full ${entry.dot}`} />
			{entry.label}
		</span>
	);
}

const AVAILABILITY = {
	available: {
		label: "Available",
		cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
	},
	partially_available: {
		label: "Partly available",
		cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
	},
	unavailable: {
		label: "Unavailable",
		cls: "bg-muted text-muted-foreground",
	},
} as const;

export function AvailabilityBadge({ status }: { status: string }) {
	const entry = AVAILABILITY[status as keyof typeof AVAILABILITY] ?? {
		label: status,
		cls: "bg-muted text-muted-foreground",
	};
	return (
		<span
			className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${entry.cls}`}
		>
			{entry.label}
		</span>
	);
}

/** The inline editor field used by the header, contact and rate sections. */
export function InlineField({
	label,
	name,
	value,
	onChange,
	multiline = false,
	readOnly = false,
}: {
	label: string;
	name: string;
	value: string;
	onChange?: (
		event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
	) => void;
	multiline?: boolean;
	readOnly?: boolean;
}) {
	const base =
		"w-full rounded-lg border px-3 py-2 text-[13.5px] outline-none transition-colors";
	const className = readOnly
		? `${base} cursor-not-allowed border-border bg-muted text-muted-foreground`
		: `${base} border-border bg-background text-foreground focus:border-primary`;

	return (
		<div>
			<label
				htmlFor={`profile-field-${name}`}
				className="mb-1 block text-[11.5px] font-medium text-muted-foreground"
			>
				{label}
				{readOnly && <span className="ml-1 font-normal">(read-only)</span>}
			</label>
			{multiline ? (
				<textarea
					id={`profile-field-${name}`}
					name={name}
					value={value}
					onChange={onChange}
					rows={4}
					className={className}
					readOnly={readOnly}
				/>
			) : (
				<input
					id={`profile-field-${name}`}
					type="text"
					name={name}
					value={value}
					onChange={onChange}
					className={className}
					readOnly={readOnly}
				/>
			)}
		</div>
	);
}

/** The pill buttons the header uses for save/cancel and marketplace actions. */
export function PillButton({
	children,
	onClick,
	variant = "secondary",
	disabled,
	type = "button",
}: {
	children: ReactNode;
	onClick?: () => void;
	variant?: "primary" | "secondary";
	disabled?: boolean;
	type?: "button" | "submit";
}) {
	return (
		<button
			type={type === "submit" ? "submit" : "button"}
			onClick={onClick}
			disabled={disabled}
			className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold transition-colors disabled:opacity-60 ${
				variant === "primary"
					? "bg-primary text-primary-foreground hover:bg-primary/90"
					: "border border-border text-foreground hover:bg-muted"
			}`}
		>
			{children}
		</button>
	);
}

/**
 * What the banner shows before anybody has uploaded one.
 *
 * A blank grey band reads as a page that failed to load an image; this reads as
 * a profile that is still being finished. It is built as a hero rather than a
 * placeholder card — the brand at full size, on a lit gradient, with the mark
 * bleeding softly into the background.
 *
 * It uses the real primary lockup rather than a re-typeset one — the artwork is
 * the brand, and a wordmark rebuilt out of a UI font is close enough to look
 * wrong. Its wordmark is baked at near-black, so on a dark theme the whole
 * lockup is knocked out to white with `brightness-0 invert`: that is the
 * reversed treatment a brand would use on a dark ground anyway, rather than a
 * light plate patched in behind it.
 */
export function EmptyProfileBanner({
	isOwner,
	onAdd,
}: {
	isOwner: boolean;
	onAdd: () => void;
}) {
	return (
		<div className="absolute inset-0 overflow-hidden bg-linear-to-br from-primary/25 via-primary/10 to-primary/5">
			{/* Texture, in three quiet layers: a grid for structure, and two soft
			    orbs so the panel has depth behind the lockup rather than sitting
			    flat under the avatar that overlaps it. */}
			<div
				aria-hidden="true"
				className="absolute inset-0 opacity-[0.16]"
				style={{
					backgroundImage:
						"linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
					backgroundSize: "32px 32px",
					color: "var(--primary)",
				}}
			/>
			<div
				aria-hidden="true"
				className="absolute -left-16 -top-24 h-64 w-64 rounded-full bg-primary/25 blur-3xl"
			/>
			<div
				aria-hidden="true"
				className="absolute -bottom-28 right-0 h-72 w-72 rounded-full bg-primary/20 blur-3xl"
			/>

			<div className="relative flex h-full flex-col items-center justify-center px-6 pb-4 text-center">
				<BrandMark
					variant="lockup"
					className="h-11 drop-shadow-sm sm:h-16 dark:brightness-0 dark:invert"
				/>
				<p className="mt-3 text-[12px] font-medium tracking-wide text-muted-foreground sm:text-[13px]">
					{isOwner
						? "Add a banner to finish your profile"
						: "Managed delivery for digital projects"}
				</p>
			</div>

			{isOwner && (
				<button
					type="button"
					onClick={onAdd}
					className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-1.5 text-[12px] font-semibold text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-card"
				>
					<ImagePlus className="h-3.5 w-3.5" />
					Add banner
				</button>
			)}
		</div>
	);
}
