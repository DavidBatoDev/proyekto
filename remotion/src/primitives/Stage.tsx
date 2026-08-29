import type React from "react";
import { AbsoluteFill, random, useCurrentFrame } from "remotion";
import {
	DARK_PALETTE,
	type Palette,
	PaletteProvider,
	usePalette,
} from "../brand/palette";
import { GRID_CELL, GRID_PERIOD } from "../brand/timing";

/**
 * The panel ground: base fill, a very shallow bloom, a drifting dot grid, and
 * a baked rim.
 *
 * The rim matters more than it looks. No single baked colour can separate
 * itself by luminance from BOTH the light page ground (#F9FAFB) and the dark
 * one — anything dark enough to read as an inset on light sits within ~1.1:1
 * of the dark themes. So on light pages the ground does the work (~16:1), and
 * on dark pages this lit edge plus the navy hue does it instead, together with
 * the `border-border` on the page-side wrapper.
 *
 * Reads the GLOBAL frame — it is mounted outside every <Sequence>, where
 * `useCurrentFrame()` would otherwise return a beat-local frame.
 */
export const PanelGround: React.FC = () => {
	const frame = useCurrentFrame();
	const PALETTE = usePalette();
	// Drifts exactly one cell per GRID_PERIOD frames, which divides DURATION,
	// so the grid is in the same place at frame 0 and at the loop point.
	const drift = ((frame % GRID_PERIOD) / GRID_PERIOD) * GRID_CELL;

	return (
		<AbsoluteFill>
			<AbsoluteFill style={{ backgroundColor: PALETTE.ground }} />

			{/* Bloom, kept deliberately shallow (9 sRGB levels): a deeper gradient
			    bands into visible rings on flat navy once x264 gets to it. */}
			<AbsoluteFill
				style={{
					background: `radial-gradient(1200px 760px at 50% 38%, ${PALETTE.groundLift} 0%, ${PALETTE.ground} 70%)`,
				}}
			/>

			<AbsoluteFill
				style={{
					backgroundImage: `radial-gradient(circle at 1px 1px, rgba(${PALETTE.glowRgb},0.16) 1px, transparent 0)`,
					backgroundSize: `${GRID_CELL}px ${GRID_CELL}px`,
					backgroundPosition: `${drift}px ${drift}px`,
					maskImage:
						"radial-gradient(1100px 700px at 50% 45%, rgba(0,0,0,0.9), transparent 78%)",
					WebkitMaskImage:
						"radial-gradient(1100px 700px at 50% 45%, rgba(0,0,0,0.9), transparent 78%)",
				}}
			/>

			<Dither />

			{/* The lit edge. Inset so it survives the wrapper's own rounded clip. */}
			<AbsoluteFill
				style={{
					boxShadow: `inset 0 0 0 2px ${PALETTE.rim}, inset 0 2px 0 0 ${PALETTE.topHighlight}`,
				}}
			/>
		</AbsoluteFill>
	);
};

/**
 * A fixed grain overlay. Frame-independent on purpose: a moving grain would
 * cost bitrate on every P-frame, while a static one costs only the keyframe
 * and still breaks up the gradient banding that flat navy invites.
 */
const Dither: React.FC = () => {
	const seed = Math.round(random("dither-seed") * 1000);
	const PALETTE = usePalette();
	// The grain exists to break the banding flat navy invites. A light ground
	// has no such gradient to band, and overlay grain on near-white only reads
	// as dirt, so it is dialled right down there.
	const opacity = PALETTE.ground === DARK_PALETTE.ground ? 0.014 : 0.006;
	return (
		<AbsoluteFill style={{ opacity, mixBlendMode: "overlay" }}>
			<svg width="100%" height="100%">
				<title>grain</title>
				<filter id="grain">
					<feTurbulence
						type="fractalNoise"
						baseFrequency="0.8"
						numOctaves={3}
						seed={seed}
					/>
				</filter>
				<rect width="100%" height="100%" filter="url(#grain)" />
			</svg>
		</AbsoluteFill>
	);
};

/**
 * Ground + content. Every story's root, and the only place a palette is chosen:
 * everything below reads it from context, so a primitive cannot quietly keep a
 * dark value while the rest of a composition goes light.
 */
export const Stage: React.FC<{
	children: React.ReactNode;
	palette?: Palette;
}> = ({ children, palette = DARK_PALETTE }) => (
	<PaletteProvider value={palette}>
		<AbsoluteFill>
			<PanelGround />
			{children}
		</AbsoluteFill>
	</PaletteProvider>
);
