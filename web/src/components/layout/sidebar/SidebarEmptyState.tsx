import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";

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
		<span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900">
			<Plus className="h-3 w-3" />
			{ctaLabel}
		</span>
	);

	return (
		<div className="flex flex-col items-center px-3 py-4 text-center">
			<div className="mb-2 text-slate-400">{icon}</div>
			<p className="mb-3 text-[11px] text-slate-500">{label}</p>
			{ctaTo ? (
				<Link to={ctaTo}>{cta}</Link>
			) : (
				<button type="button" onClick={onCtaClick}>
					{cta}
				</button>
			)}
		</div>
	);
}

/**
 * Outlined isometric "stacked papers" icon used as the visual cue for
 * empty sidebar sections. Matches the soft, sketched feel of the
 * reference design.
 */
export function StackedPapersIcon({
	className = "h-9 w-9",
}: {
	className?: string;
}) {
	return (
		<svg
			viewBox="0 0 48 48"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.25"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
			aria-hidden="true"
		>
			{/* bottom sheet */}
			<path d="M8 36 L20 41 L40 33 L28 28 Z" />
			{/* middle sheet */}
			<path d="M10 30 L22 35 L42 27 L30 22 Z" />
			{/* top sheet */}
			<path d="M12 24 L24 29 L44 21 L32 16 Z" />
		</svg>
	);
}
