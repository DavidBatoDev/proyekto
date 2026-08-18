import { Flag } from "lucide-react";

/**
 * Epic / Feature / Task glyphs — the same artwork as
 * `web/public/svgs/nodes/{epic,feature,task}.svg`, inlined so the epic tile can
 * be tinted with the epic's own colour instead of the fixed purple.
 */

/**
 * The kinds of roadmap node anything can point at.
 *
 * Lives here rather than in a feature's model file because every surface that
 * links to roadmap work needs it. It used to sit in `delivery/deliveryModel.ts`,
 * which made the shared glyph component depend on the Deliverables model.
 */
export type RoadmapNodeKind = "epic" | "feature" | "task" | "milestone";

type NodeGlyphProps = {
	/** Rendered size in px. The artwork is authored on a 64px grid. */
	size?: number;
	className?: string;
};

const box = (size: number) => ({ width: size, height: size });

export const EpicGlyph = ({
	color = "#5E6AD2",
	size = 16,
	className,
}: NodeGlyphProps & { color?: string }) => (
	<svg
		viewBox="0 0 64 64"
		{...box(size)}
		className={`shrink-0 ${className ?? ""}`}
		role="img"
		aria-label="Epic"
	>
		<rect width="64" height="64" rx="16" fill={color} />
		{/* Back peak sits behind so the flagged peak reads as the goal. */}
		<path d="M32 18 46 46H18Z" fill="#FFFFFF" fillOpacity="0.32" />
		<path d="M26 26 40 46H12Z" fill="#FFFFFF" fillOpacity="0.9" />
		<path
			d="M32 16v13"
			stroke="#FFFFFF"
			strokeWidth="2.5"
			strokeLinecap="round"
		/>
		<path d="M33.5 16h9l-3 4 3 4h-9z" fill="#FFFFFF" />
	</svg>
);

export const FeatureGlyph = ({ size = 16, className }: NodeGlyphProps) => (
	<svg
		viewBox="0 0 64 64"
		{...box(size)}
		className={`shrink-0 ${className ?? ""}`}
		role="img"
		aria-label="Feature"
	>
		<rect width="64" height="64" rx="16" fill="#3B82F6" />
		{/* Knob on top, socket on the right — it plugs into something larger. */}
		<path
			d="M24 18h4a4 4 0 1 1 8 0h4a2 2 0 0 1 2 2v4a4 4 0 1 1 0 8v10a2 2 0 0 1-2 2H24a2 2 0 0 1-2-2V20a2 2 0 0 1 2-2Z"
			fill="#FFFFFF"
		/>
	</svg>
);

export const TaskGlyph = ({ size = 16, className }: NodeGlyphProps) => (
	<svg
		viewBox="0 0 64 64"
		{...box(size)}
		className={`shrink-0 ${className ?? ""}`}
		role="img"
		aria-label="Task"
	>
		<rect width="64" height="64" rx="16" fill="#34D399" />
		<rect x="16" y="14" width="32" height="36" rx="5" fill="#FFFFFF" />
		<g
			stroke="#34D399"
			strokeWidth="2.6"
			strokeLinecap="round"
			strokeLinejoin="round"
			fill="none"
		>
			<path d="M22 24.5l2.4 2.4 4.2-4.4" />
			<path d="M22 33l2.4 2.4 4.2-4.4" />
			<path d="M22 41.5l2.4 2.4 4.2-4.4" />
		</g>
		<g fill="#A7F3D0">
			<rect x="32" y="24" width="11" height="2.8" rx="1.4" />
			<rect x="32" y="32.5" width="11" height="2.8" rx="1.4" />
			<rect x="32" y="41" width="11" height="2.8" rx="1.4" />
		</g>
	</svg>
);

/**
 * A node of any kind, so a link trail renders exactly as it does on the canvas,
 * the board and the left panel.
 *
 * There is no milestone artwork above — `Flag` is the only milestone icon
 * anywhere in the app — so that level is a lucide icon boxed to match the tiles.
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
