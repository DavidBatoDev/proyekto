import {
	AlertTriangle,
	Ban,
	Info,
	type LucideIcon,
	SearchX,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The card a Time surface shows instead of content it cannot show.
 *
 * ux.md › Chrome: "Every refusal on these pages renders a reason card, so a
 * refusal never looks like an empty page." A 404 ("This timesheet doesn't
 * exist or you can't open it."), a viewer who cannot log, a plan that lacks
 * timesheets, a page whose real home is elsewhere ("Your time on this project
 * lives in Time. [Open →]") all render through this one card, so they look
 * alike and none of them reads as a blank screen or a spinner that never ends.
 *
 * The card carries no copy of its own. Callers pass the words from
 * `lib/timeErrors.ts` / `lib/timeFormat.ts`, which keeps every sentence in
 * the one place the native copy rules are tested.
 */

export type TimeReasonTone =
	/** Nothing is wrong; the content simply lives elsewhere or is not there. */
	| "neutral"
	/** Something the reader may want to act on. */
	| "info"
	/** A limit or a state that blocks the action (plan, lock, policy). */
	| "warning"
	/** A refusal: no access, or the thing does not exist for this reader. */
	| "danger"
	/** A 404: "… doesn't exist or you can't open it." */
	| "not-found";

const TONE: Record<TimeReasonTone, { icon: LucideIcon; medallion: string }> = {
	neutral: { icon: Info, medallion: "bg-muted text-muted-foreground" },
	info: { icon: Info, medallion: "bg-info/10 text-info" },
	warning: { icon: AlertTriangle, medallion: "bg-warning/10 text-warning" },
	danger: { icon: Ban, medallion: "bg-destructive/10 text-destructive" },
	"not-found": { icon: SearchX, medallion: "bg-muted text-muted-foreground" },
};

export interface TimeReasonCardProps {
	/** The one sentence that says what happened. */
	title: ReactNode;
	/** Optional detail under the title: why, or what to do next. */
	children?: ReactNode;
	tone?: TimeReasonTone;
	/** Overrides the tone's icon; `null` hides the medallion. */
	icon?: LucideIcon | null;
	/** Buttons or links under the text ("Open →", "← Time", "Withdraw"). */
	action?: ReactNode;
	/**
	 * `page` centres the card in the content column, for a route that has
	 * nothing else to render. `inline` sits inside a section, left-aligned.
	 */
	variant?: "page" | "inline";
	/**
	 * `alert` for a refusal that just happened (a failed action); the default
	 * `status` for a state the page was opened into.
	 */
	role?: "status" | "alert";
	className?: string;
}

export function TimeReasonCard({
	title,
	children,
	tone = "neutral",
	icon,
	action,
	variant = "page",
	role = "status",
	className,
}: TimeReasonCardProps) {
	const toneStyle = TONE[tone];
	const Icon = icon === null ? null : (icon ?? toneStyle.icon);
	const page = variant === "page";

	return (
		<section
			role={role}
			data-tone={tone}
			className={cn(
				"rounded-2xl border border-border bg-card text-card-foreground shadow-sm",
				page
					? "mx-auto w-full max-w-xl px-6 py-10 text-center"
					: "flex gap-4 px-5 py-4 text-left",
				className,
			)}
		>
			{Icon ? (
				<div
					aria-hidden="true"
					className={cn(
						"inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
						page ? "mx-auto mb-4" : "",
						toneStyle.medallion,
					)}
				>
					<Icon className="h-5 w-5" />
				</div>
			) : null}
			<div className="min-w-0 flex-1">
				<h2
					className={cn(
						"font-semibold text-foreground",
						page ? "text-base" : "text-sm",
					)}
				>
					{title}
				</h2>
				{children ? (
					<div
						className={cn(
							"mt-1 text-sm leading-relaxed text-muted-foreground",
							page ? "mx-auto max-w-md" : undefined,
						)}
					>
						{children}
					</div>
				) : null}
				{action ? (
					<div
						className={cn(
							"mt-4 flex flex-wrap items-center gap-2",
							page ? "justify-center" : undefined,
						)}
					>
						{action}
					</div>
				) : null}
			</div>
		</section>
	);
}
