/**
 * The shared grammar behind every hand-built illustration in the app.
 *
 * Three sets now speak it — the marketplace capability cards
 * (`marketplace/home/CapabilityIcons.tsx`), the three ways to start a roadmap
 * (`roadmap/roadmapStartIllustrations.tsx`), and the sidebar's empty sections
 * (`layout/sidebar/SidebarEmptyState.tsx`) — so the pieces they share live
 * here instead of being copied a fourth time:
 *
 *   • a muted `Sheet` as the base surface
 *   • content bars in muted-foreground, at low opacity
 *   • one primary-coloured block carrying the emphasis
 *   • a filled primary `Badge` in the top-right holding the verb
 *
 * Deliberately not library glyphs. A line icon from a set says "document" or
 * "people"; these are small flat scenes that say what the thing *is*.
 * Everything is theme tokens, so they invert correctly in dark mode, and every
 * shape is flat — no gradients, no shadows, nothing to go muddy at 40px.
 */

export const ILLUSTRATION_SVG_PROPS = {
	viewBox: "0 0 48 48",
	fill: "none",
	xmlns: "http://www.w3.org/2000/svg",
	"aria-hidden": true,
	focusable: false,
} as const;

/** The shared base: a sheet with a soft edge. */
export function Sheet({ x = 6, y = 8, w = 28, h = 32 }) {
	return (
		<>
			<rect x={x} y={y} width={w} height={h} rx="3" className="fill-muted" />
			<rect
				x={x}
				y={y}
				width={w}
				height={h}
				rx="3"
				className="stroke-border"
				strokeWidth="1"
			/>
		</>
	);
}

/** The badge that carries each illustration's verb. */
export function Badge({
	cx = 36,
	cy = 15,
	children,
}: {
	cx?: number;
	cy?: number;
	children: React.ReactNode;
}) {
	return (
		<>
			<circle cx={cx} cy={cy} r="9" className="fill-background" />
			<circle cx={cx} cy={cy} r="7.5" className="fill-primary" />
			{children}
		</>
	);
}

/** The most common verb: add one of these. */
export function PlusBadge({ cx = 36, cy = 15 }: { cx?: number; cy?: number }) {
	return (
		<Badge cx={cx} cy={cy}>
			<path
				d={`M${cx} ${cy - 3.4}v6.8M${cx - 3.4} ${cy}h6.8`}
				className="stroke-primary-foreground"
				strokeWidth="1.8"
				strokeLinecap="round"
			/>
		</Badge>
	);
}
