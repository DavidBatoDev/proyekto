import { GRANULARITIES } from "../../milestones/model/constants";
import type { Granularity } from "../../milestones/model/types";

/**
 * How far a pinch must travel before the time scale steps one notch.
 *
 * Generous on purpose: the scale is discrete (day/week/month/year), so a
 * hair-trigger threshold makes the chart flip scales while the fingers are
 * still settling. 1.45 is roughly "grow the gap by half again".
 */
export const PINCH_STEP_IN = 1.45;
export const PINCH_STEP_OUT = 1 / PINCH_STEP_IN;

/**
 * Walk the scale one notch. `GRANULARITIES` runs fine -> coarse
 * (day, week, month, year), and `direction: 1` means "zoom in" — a spreading
 * pinch shows less time in more detail — so zooming in walks the array
 * backwards. Both ends clamp.
 */
export function stepGranularity(
	current: Granularity,
	direction: 1 | -1,
): Granularity {
	const index = GRANULARITIES.indexOf(current);
	if (index < 0) return current;
	const next = Math.max(
		0,
		Math.min(GRANULARITIES.length - 1, index - direction),
	);
	return GRANULARITIES[next] ?? current;
}

export interface PinchResolution {
	granularity: Granularity;
	/**
	 * The portion of the accumulated scale this resolution used up. The caller
	 * divides its running accumulator by this, so leftover travel carries into
	 * the next step instead of being discarded.
	 */
	consumed: number;
}

/**
 * Map an accumulated pinch ratio onto the discrete time scale.
 *
 * Pure so the thresholds can be tested without a DOM, in the spirit of
 * `lib/flow/usePanZoom.ts`'s `decideWheel`.
 */
export function resolvePinch(
	base: Granularity,
	accumulatedScale: number,
): PinchResolution {
	if (!Number.isFinite(accumulatedScale) || accumulatedScale <= 0) {
		return { granularity: base, consumed: 1 };
	}

	if (accumulatedScale >= PINCH_STEP_IN) {
		const granularity = stepGranularity(base, 1);
		return granularity === base
			? // Already at the finest scale. Swallow the excess rather than let it
				// wind up, so an outward pinch responds on its own merits instead of
				// first having to unwind however far the user kept spreading.
				{ granularity: base, consumed: accumulatedScale }
			: { granularity, consumed: PINCH_STEP_IN };
	}

	if (accumulatedScale <= PINCH_STEP_OUT) {
		const granularity = stepGranularity(base, -1);
		return granularity === base
			? { granularity: base, consumed: accumulatedScale }
			: { granularity, consumed: PINCH_STEP_OUT };
	}

	return { granularity: base, consumed: 1 };
}
