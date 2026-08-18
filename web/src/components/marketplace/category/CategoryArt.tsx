/**
 * Tile illustrations for the category browse grid.
 *
 * Hand-built rather than stock art or library glyphs, for the same reason the
 * capability icons are: a photo would claim something about who works here, and
 * an icon set would give eleven categories eleven unrelated pictograms. These
 * are flat abstract scenes of a workspace — a panel, a board, a chart, a device
 * — sharing one grammar so the grid reads as a designed set:
 *
 *   • a tinted ground filling the tile
 *   • one raised "surface" in the card colour
 *   • content bars in the category's own ink at low opacity
 *   • exactly one saturated accent per tile, never two
 *
 * Colour is derived from the slug, so a category keeps its palette for as long
 * as its URL exists. Composition comes from the tile's position instead, which
 * is the only way to guarantee an even spread of scenes across the grid —
 * hashing the slug for both left four of eleven tiles drawing the same scene,
 * which reads as a bug rather than as variety. Neither is random.
 *
 * Every colour is a Tailwind palette utility with a dark counterpart, the same
 * approach the status badges take, so the tiles hold up in both themes without
 * a second set of drawings.
 */

interface Palette {
	ground: string;
	surface: string;
	ink: string;
	accent: string;
}

const PALETTES: Palette[] = [
	{
		ground: "fill-rose-100 dark:fill-rose-950/60",
		surface: "fill-white dark:fill-slate-900",
		ink: "fill-rose-950/20 dark:fill-rose-200/20",
		accent: "fill-rose-500",
	},
	{
		ground: "fill-emerald-100 dark:fill-emerald-950/60",
		surface: "fill-white dark:fill-slate-900",
		ink: "fill-emerald-950/20 dark:fill-emerald-200/20",
		accent: "fill-emerald-500",
	},
	{
		ground: "fill-indigo-100 dark:fill-indigo-950/60",
		surface: "fill-white dark:fill-slate-900",
		ink: "fill-indigo-950/20 dark:fill-indigo-200/20",
		accent: "fill-indigo-500",
	},
	{
		ground: "fill-amber-100 dark:fill-amber-950/60",
		surface: "fill-white dark:fill-slate-900",
		ink: "fill-amber-950/20 dark:fill-amber-200/20",
		accent: "fill-amber-500",
	},
	{
		ground: "fill-sky-100 dark:fill-sky-950/60",
		surface: "fill-white dark:fill-slate-900",
		ink: "fill-sky-950/20 dark:fill-sky-200/20",
		accent: "fill-sky-500",
	},
	{
		ground: "fill-fuchsia-100 dark:fill-fuchsia-950/60",
		surface: "fill-white dark:fill-slate-900",
		ink: "fill-fuchsia-950/20 dark:fill-fuchsia-200/20",
		accent: "fill-fuchsia-500",
	},
	{
		ground: "fill-teal-100 dark:fill-teal-950/60",
		surface: "fill-white dark:fill-slate-900",
		ink: "fill-teal-950/20 dark:fill-teal-200/20",
		accent: "fill-teal-500",
	},
];

/**
 * A stable, order-independent hash. `slug` is the only input because it is the
 * one part of a category that cannot change without the URL changing too.
 */
function hashSlug(slug: string): number {
	let hash = 17;
	for (let index = 0; index < slug.length; index += 1) {
		hash = (hash * 131 + slug.charCodeAt(index) * (index + 7)) | 0;
	}
	return Math.abs(hash);
}

export const CATEGORY_ART_VARIANT_COUNT = 5;
export const CATEGORY_ART_PALETTE_COUNT = PALETTES.length;

/**
 * Which palette and scene a tile draws. Exported so the promises this makes —
 * colour stable per slug, scenes evenly spread across a grid — are testable
 * without rendering SVG.
 */
export function selectCategoryArt(slug: string, index?: number) {
	const hash = hashSlug(slug);
	return {
		paletteIndex: hash % PALETTES.length,
		variant: (index ?? hash) % CATEGORY_ART_VARIANT_COUNT,
	};
}

export function CategoryArt({
	slug,
	index,
	className,
}: {
	slug: string;
	/**
	 * Position in the grid, which selects the scene. Omit it outside a grid —
	 * a lone illustration has nothing to be even with, so it falls back to the
	 * slug.
	 */
	index?: number;
	className?: string;
}) {
	const { paletteIndex, variant } = selectCategoryArt(slug, index);
	const palette = PALETTES[paletteIndex];

	return (
		<svg
			viewBox="0 0 320 180"
			className={className}
			role="presentation"
			aria-hidden="true"
			focusable="false"
			preserveAspectRatio="xMidYMid slice"
		>
			<rect width="320" height="180" className={palette.ground} />
			{variant === 0 && <PanelScene palette={palette} />}
			{variant === 1 && <BoardScene palette={palette} />}
			{variant === 2 && <ChartScene palette={palette} />}
			{variant === 3 && <DeviceScene palette={palette} />}
			{variant === 4 && <LayersScene palette={palette} />}
		</svg>
	);
}

/** A window with a title bar — the "working on something" scene. */
function PanelScene({ palette }: { palette: Palette }) {
	return (
		<>
			<rect
				x="34"
				y="30"
				width="252"
				height="128"
				rx="10"
				className={palette.surface}
			/>
			<rect
				x="34"
				y="30"
				width="252"
				height="22"
				rx="10"
				className={palette.ink}
			/>
			<rect x="34" y="46" width="252" height="6" className={palette.surface} />
			<circle cx="48" cy="41" r="3.5" className={palette.accent} />
			<rect
				x="52"
				y="68"
				width="120"
				height="9"
				rx="4"
				className={palette.ink}
			/>
			<rect
				x="52"
				y="86"
				width="176"
				height="7"
				rx="3.5"
				className={palette.ink}
			/>
			<rect
				x="52"
				y="100"
				width="150"
				height="7"
				rx="3.5"
				className={palette.ink}
			/>
			<rect
				x="52"
				y="122"
				width="74"
				height="20"
				rx="10"
				className={palette.accent}
			/>
		</>
	);
}

/** A board of cards — the "many pieces of work" scene. */
function BoardScene({ palette }: { palette: Palette }) {
	const columns = [40, 122, 204];
	return (
		<>
			{columns.map((x, column) => (
				<g key={x}>
					<rect
						x={x}
						y="26"
						width="76"
						height="128"
						rx="9"
						className={palette.surface}
					/>
					<rect
						x={x + 12}
						y="40"
						width="40"
						height="7"
						rx="3.5"
						className={column === 1 ? palette.accent : palette.ink}
					/>
					<rect
						x={x + 12}
						y="58"
						width="52"
						height="26"
						rx="6"
						className={palette.ink}
					/>
					<rect
						x={x + 12}
						y="92"
						width="52"
						height="26"
						rx="6"
						className={palette.ink}
					/>
				</g>
			))}
		</>
	);
}

/** Axis and bars — the "measured outcome" scene. */
function ChartScene({ palette }: { palette: Palette }) {
	const bars = [
		{ x: 70, h: 34 },
		{ x: 106, h: 56 },
		{ x: 142, h: 44 },
		{ x: 178, h: 74 },
		{ x: 214, h: 92 },
	];
	return (
		<>
			<rect
				x="40"
				y="26"
				width="240"
				height="128"
				rx="10"
				className={palette.surface}
			/>
			<rect
				x="58"
				y="132"
				width="204"
				height="4"
				rx="2"
				className={palette.ink}
			/>
			{bars.map((bar, index) => (
				<rect
					key={bar.x}
					x={bar.x}
					y={132 - bar.h}
					width="22"
					height={bar.h}
					rx="5"
					className={index === bars.length - 1 ? palette.accent : palette.ink}
				/>
			))}
			<rect
				x="58"
				y="44"
				width="64"
				height="7"
				rx="3.5"
				className={palette.ink}
			/>
		</>
	);
}

/** A phone beside a panel — the "two surfaces" scene. */
function DeviceScene({ palette }: { palette: Palette }) {
	return (
		<>
			<rect
				x="30"
				y="34"
				width="166"
				height="120"
				rx="10"
				className={palette.surface}
			/>
			<rect
				x="48"
				y="56"
				width="86"
				height="8"
				rx="4"
				className={palette.ink}
			/>
			<rect
				x="48"
				y="74"
				width="122"
				height="6"
				rx="3"
				className={palette.ink}
			/>
			<rect
				x="48"
				y="88"
				width="104"
				height="6"
				rx="3"
				className={palette.ink}
			/>
			<rect
				x="48"
				y="110"
				width="60"
				height="18"
				rx="9"
				className={palette.accent}
			/>
			<rect
				x="212"
				y="20"
				width="76"
				height="140"
				rx="14"
				className={palette.surface}
			/>
			<rect
				x="224"
				y="40"
				width="52"
				height="60"
				rx="7"
				className={palette.ink}
			/>
			<rect
				x="224"
				y="110"
				width="52"
				height="7"
				rx="3.5"
				className={palette.ink}
			/>
			<circle cx="250" cy="140" r="8" className={palette.accent} />
		</>
	);
}

/** Offset sheets — the "stack of options" scene. */
function LayersScene({ palette }: { palette: Palette }) {
	return (
		<>
			<rect
				x="58"
				y="20"
				width="200"
				height="110"
				rx="10"
				className={palette.ink}
			/>
			<rect
				x="44"
				y="38"
				width="212"
				height="118"
				rx="10"
				className={palette.surface}
			/>
			<rect
				x="64"
				y="60"
				width="96"
				height="9"
				rx="4.5"
				className={palette.ink}
			/>
			<rect
				x="64"
				y="80"
				width="152"
				height="7"
				rx="3.5"
				className={palette.ink}
			/>
			<rect
				x="64"
				y="94"
				width="128"
				height="7"
				rx="3.5"
				className={palette.ink}
			/>
			<rect
				x="64"
				y="116"
				width="46"
				height="18"
				rx="9"
				className={palette.accent}
			/>
			<circle cx="238" cy="132" r="14" className={palette.accent} />
		</>
	);
}
