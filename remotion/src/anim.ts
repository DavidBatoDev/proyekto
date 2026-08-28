import { Easing, interpolate, spring } from "remotion";

/**
 * `interpolate` with both extrapolations clamped.
 *
 * Remotion's default is `extrapolate: "extend"`, which is a reliable way to
 * ship an opacity above 1 or a negative scale the moment a frame falls outside
 * the input range. Every animated value in this project goes through here, so
 * that default is never in play.
 */
export function lerp(
	frame: number,
	inputRange: readonly [number, number],
	outputRange: readonly [number, number],
	easing?: (input: number) => number,
): number {
	return interpolate(
		frame,
		inputRange as unknown as number[],
		outputRange as unknown as number[],
		{
			extrapolateLeft: "clamp",
			extrapolateRight: "clamp",
			easing,
		},
	);
}

/** The house easing for anything settling into place. */
export const EASE_OUT = Easing.out(Easing.cubic);
/** For a value travelling between two resting states. */
export const EASE_IN_OUT = Easing.inOut(Easing.cubic);

/**
 * The entrance spring: 0 → 1, overshoot-free.
 *
 * Entrances only. A spring never converges to *exactly* its target, so using
 * one for a return-to-seed move would leave a sub-pixel offset at the loop
 * seam. Returns are `lerp` + `EASE_OUT`, which lands exactly.
 */
export function springIn(
	frame: number,
	fps: number,
	delay = 0,
	durationInFrames = 24,
): number {
	return spring({
		frame: frame - delay,
		fps,
		config: { damping: 200 },
		durationInFrames,
	});
}

/**
 * A beat's own fade envelope: rises over `inFrames`, falls over `outFrames`.
 * Multiply any beat-scoped opacity by this so overlapping beats crossfade.
 */
export function envelope(
	local: number,
	duration: number,
	inFrames = 14,
	outFrames = 12,
): number {
	return Math.min(
		lerp(local, [0, inFrames], [0, 1]),
		lerp(local, [duration - outFrames, duration], [1, 0]),
	);
}

/**
 * Position along a quadratic bezier — used wherever something flies from one
 * anchor to another (an avatar docking onto a task row).
 */
export function bezier(
	t: number,
	from: readonly [number, number],
	ctrl: readonly [number, number],
	to: readonly [number, number],
): [number, number] {
	const u = 1 - t;
	return [
		u * u * from[0] + 2 * u * t * ctrl[0] + t * t * to[0],
		u * u * from[1] + 2 * u * t * ctrl[1] + t * t * to[1],
	];
}
