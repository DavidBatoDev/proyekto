import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import {
	PlusBadge,
	Sheet,
	ILLUSTRATION_SVG_PROPS as SVG_PROPS,
} from "@/components/common/illustrationPrimitives";

/**
 * Compact empty-state for sidebar sections (Projects, Teams).
 * Shows a soft outlined icon, a short label, and a CTA button that
 * routes the user to the creation flow.
 */
export function SidebarEmptyState({
	icon,
	label,
	ctaLabel,
	ctaTo,
	onCtaClick,
}: {
	icon: ReactNode;
	label: string;
	ctaLabel: string;
	ctaTo?: string;
	onCtaClick?: () => void;
}) {
	const cta = (
		<span className="inline-flex items-center gap-1.5 rounded-lg border border-sidebar-border bg-sidebar px-2.5 py-1.5 text-[11px] font-semibold text-sidebar-foreground shadow-sm transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
			<Plus className="h-3 w-3" />
			{ctaLabel}
		</span>
	);

	return (
		<div className="flex flex-col items-center px-3 py-4 text-center">
			<div className="mb-2">{icon}</div>
			<p className="mb-3 text-[11px] text-sidebar-foreground/60">{label}</p>
			{ctaTo ? (
				// Plain anchor so generic ctaTo strings don't have to satisfy
				// each target route's typed search params. Full navigation is
				// fine here since the sidebar empty-state CTA always routes
				// the user away from their current page anyway.
				<a href={ctaTo}>{cta}</a>
			) : (
				<button type="button" onClick={onCtaClick}>
					{cta}
				</button>
			)}
		</div>
	);
}

/**
 * A team waiting to be made: a card with two faces on it and the add badge.
 *
 * Replaces a generic outlined "stacked papers" glyph that both empty sections
 * shared — the same picture for teams and for projects said nothing about
 * either. These follow the app's illustration grammar
 * (`common/illustrationPrimitives.tsx`), so the sidebar, the marketplace cards
 * and the create-roadmap chooser read as one family.
 */
export function TeamsEmptyIllustration({
	className = "h-12 w-12",
}: {
	className?: string;
}) {
	return (
		<svg {...SVG_PROPS} className={className}>
			<Sheet y={10} h={28} />
			{/* Two members: the first filled, the second still an outline. */}
			<circle cx="15" cy="20" r="3.4" className="fill-primary" />
			<path
				d="M10.4 29.5c0-2.6 2.1-4.3 4.6-4.3s4.6 1.7 4.6 4.3"
				className="fill-primary"
				opacity="0.35"
			/>
			<circle
				cx="25.5"
				cy="20"
				r="3.4"
				className="stroke-muted-foreground"
				strokeWidth="1.2"
				opacity="0.55"
			/>
			<path
				d="M20.9 29.5c0-2.6 2.1-4.3 4.6-4.3s4.6 1.7 4.6 4.3"
				className="stroke-muted-foreground"
				strokeWidth="1.2"
				strokeLinecap="round"
				opacity="0.55"
			/>
			<PlusBadge cy={17} />
		</svg>
	);
}

/**
 * A project waiting to be made: a board with its first column filled and the
 * rest still to come.
 */
export function ProjectsEmptyIllustration({
	className = "h-12 w-12",
}: {
	className?: string;
}) {
	return (
		<svg {...SVG_PROPS} className={className}>
			<Sheet y={10} h={28} />
			<rect
				x="10.5"
				y="15"
				width="7"
				height="17"
				rx="1.6"
				className="fill-primary"
				opacity="0.9"
			/>
			<rect
				x="19.5"
				y="15"
				width="7"
				height="11"
				rx="1.6"
				className="fill-muted-foreground"
				opacity="0.28"
			/>
			<rect
				x="19.5"
				y="27.5"
				width="7"
				height="4.5"
				rx="1.6"
				className="stroke-muted-foreground"
				strokeWidth="1.1"
				strokeDasharray="2.2 2.2"
				opacity="0.55"
			/>
			<PlusBadge cy={17} />
		</svg>
	);
}
