import type React from "react";
import { PALETTE } from "../brand/palette";
import { FONT_BODY } from "../brand/fonts";

/**
 * The shape vocabulary, lifted from the grammar documented in
 * `web/src/components/marketplace/home/CapabilityIcons.tsx` and scaled from a
 * 48px icon to a 1920x1080 stage:
 *
 *   a muted SHEET as the base surface · content BARS in muted-foreground at low
 *   opacity · ONE primary-coloured block carrying the emphasis · a filled
 *   primary BADGE holding the verb · everything flat, no gradients
 *
 * Everything is absolutely positioned in literal stage pixels. Flex would fight
 * per-frame interpolation, and there is no reflow to gain from here.
 */

type Box = { x: number; y: number; w: number; h: number };

/** A raised surface: the sheet everything else sits on. */
export const Card: React.FC<
	Box & {
		radius?: number;
		opacity?: number;
		scale?: number;
		tone?: "surface" | "surfaceHi" | "primary";
		glow?: number;
		borderColor?: string;
		children?: React.ReactNode;
	}
> = ({
	x,
	y,
	w,
	h,
	radius = 20,
	opacity = 1,
	scale = 1,
	tone = "surface",
	glow = 0,
	borderColor,
	children,
}) => (
	<div
		style={{
			position: "absolute",
			left: x,
			top: y,
			width: w,
			height: h,
			borderRadius: radius,
			backgroundColor:
				tone === "primary"
					? PALETTE.blue600
					: tone === "surfaceHi"
						? PALETTE.surfaceHi
						: PALETTE.surface,
			border: `1px solid ${borderColor ?? PALETTE.hairline}`,
			boxShadow: glow > 0 ? `0 0 ${44 * glow}px rgba(37,99,235,${0.5 * glow})` : undefined,
			opacity,
			transform: `scale(${scale})`,
			transformOrigin: "center center",
		}}
	>
		{children}
	</div>
);

/**
 * A content bar. `reveal` masks it left→right rather than fading it, so text
 * reads as being written rather than dissolving in.
 */
export const Bar: React.FC<{
	x: number;
	y: number;
	w: number;
	h?: number;
	reveal?: number;
	tone?: "muted" | "primary" | "ink";
	opacity?: number;
	radius?: number;
}> = ({
	x,
	y,
	w,
	h = 12,
	reveal = 1,
	tone = "muted",
	opacity = 1,
	radius,
}) => (
	<div
		style={{
			position: "absolute",
			left: x,
			top: y,
			width: w * Math.max(0, Math.min(1, reveal)),
			height: h,
			borderRadius: radius ?? h / 2,
			backgroundColor:
				tone === "primary"
					? PALETTE.blue600
					: tone === "ink"
						? PALETTE.ink
						: PALETTE.bar,
			opacity,
		}}
	/>
);

/** A labelled pill. Only ever carries verified product vocabulary — see NOTE in the stories. */
export const Chip: React.FC<{
	x: number;
	y: number;
	label: string;
	tone?: "muted" | "primary" | "outline";
	scale?: number;
	opacity?: number;
}> = ({ x, y, label, tone = "muted", scale = 1, opacity = 1 }) => (
	<div
		style={{
			position: "absolute",
			left: x,
			top: y,
			display: "flex",
			alignItems: "center",
			height: 44,
			padding: "0 20px",
			borderRadius: 22,
			fontFamily: FONT_BODY,
			fontSize: 22,
			fontWeight: 600,
			letterSpacing: "0.02em",
			whiteSpace: "nowrap",
			backgroundColor:
				tone === "primary"
					? PALETTE.blue600
					: tone === "outline"
						? "transparent"
						: "rgba(148,163,184,0.14)",
			border:
				tone === "outline"
					? `1px solid ${PALETTE.rim}`
					: "1px solid transparent",
			color: tone === "primary" ? "#ffffff" : PALETTE.inkMuted,
			opacity,
			transform: `scale(${scale})`,
			transformOrigin: "left center",
		}}
	>
		{label}
	</div>
);

/**
 * An abstract person mark. No faces and no photographs — the real marketplace
 * shows real people, and a synthesised one here would be a small lie.
 */
export const Avatar: React.FC<{
	x: number;
	y: number;
	size?: number;
	variant?: 0 | 1 | 2;
	ring?: number;
	scale?: number;
	opacity?: number;
}> = ({ x, y, size = 96, variant = 0, ring = 0, scale = 1, opacity = 1 }) => {
	const fill = [PALETTE.blue600, PALETTE.blue500, PALETTE.blue400][variant];
	return (
		<div
			style={{
				position: "absolute",
				left: x,
				top: y,
				width: size,
				height: size,
				borderRadius: size / 2,
				backgroundColor: "rgba(37,99,235,0.16)",
				border: `2px solid ${fill}`,
				boxShadow: ring > 0 ? `0 0 0 ${8 * ring}px rgba(59,130,246,0.18)` : undefined,
				opacity,
				transform: `scale(${scale})`,
				transformOrigin: "center center",
				overflow: "hidden",
			}}
		>
			{/* head + shoulders, as flat blocks */}
			<div
				style={{
					position: "absolute",
					left: "50%",
					top: size * 0.2,
					width: size * 0.28,
					height: size * 0.28,
					marginLeft: -(size * 0.14),
					borderRadius: "50%",
					backgroundColor: fill,
				}}
			/>
			<div
				style={{
					position: "absolute",
					left: "50%",
					top: size * 0.56,
					width: size * 0.56,
					height: size * 0.36,
					marginLeft: -(size * 0.28),
					borderRadius: `${size * 0.28}px ${size * 0.28}px 0 0`,
					backgroundColor: fill,
					opacity: 0.75,
				}}
			/>
		</div>
	);
};

/** The filled primary circle that carries a verb glyph. */
export const Badge: React.FC<{
	x: number;
	y: number;
	r?: number;
	scale?: number;
	opacity?: number;
	children?: React.ReactNode;
}> = ({ x, y, r = 34, scale = 1, opacity = 1, children }) => (
	<div
		style={{
			position: "absolute",
			left: x,
			top: y,
			width: r * 2,
			height: r * 2,
			borderRadius: r,
			backgroundColor: PALETTE.blue600,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			opacity,
			transform: `scale(${scale})`,
			transformOrigin: "center center",
			boxShadow: `0 0 0 6px ${PALETTE.ground}`,
		}}
	>
		{children}
	</div>
);

/** A tick that draws itself. */
export const CheckMark: React.FC<{
	x: number;
	y: number;
	size?: number;
	progress: number;
	tone?: "primary" | "ok";
}> = ({ x, y, size = 56, progress, tone = "primary" }) => (
	<svg
		style={{ position: "absolute", left: x, top: y }}
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
	>
		<title>accepted</title>
		<path
			d="M4 12.5l5 5L20 6.5"
			stroke={tone === "ok" ? PALETTE.ok : PALETTE.blue500}
			strokeWidth={3}
			strokeLinecap="round"
			strokeLinejoin="round"
			pathLength={1}
			strokeDasharray={1}
			strokeDashoffset={1 - Math.max(0, Math.min(1, progress))}
		/>
	</svg>
);

/**
 * A connector that draws itself.
 *
 * `pathLength={1}` normalises the dash maths so no `getTotalLength()` DOM
 * measurement is needed — that would cost a layout pass per frame and can
 * differ subtly between the Studio preview and the headless render.
 */
export const Connector: React.FC<{
	d: string;
	progress: number;
	width?: number;
	tone?: "muted" | "primary";
	opacity?: number;
}> = ({ d, progress, width = 3, tone = "muted", opacity = 1 }) => (
	<svg
		style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
		width={1920}
		height={1080}
		fill="none"
	>
		<title>connector</title>
		<path
			d={d}
			stroke={tone === "primary" ? PALETTE.blue500 : "rgba(148,163,184,0.42)"}
			strokeWidth={width}
			strokeLinecap="round"
			fill="none"
			opacity={opacity}
			pathLength={1}
			strokeDasharray={1}
			strokeDashoffset={1 - Math.max(0, Math.min(1, progress))}
		/>
	</svg>
);
