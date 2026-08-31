import { usePinch } from "@use-gesture/react";
import { type RefObject, useRef } from "react";
import type { Granularity } from "../../milestones/model/types";
import { resolvePinch } from "./mobileZoom";

export interface PinchAnchor {
	/** The date under the pinch midpoint at the moment the scale stepped. */
	date: Date;
	/** That midpoint's distance from the grid's left edge, in viewport px. */
	offsetX: number;
}

interface UseTimelinePinchParams {
	targetRef: RefObject<HTMLDivElement | null>;
	granularity: Granularity;
	taskColWidth: number;
	/** Timeline px -> Date at the *current* granularity. */
	pxToDate: (px: number) => Date;
	onGranularityChange: (granularity: Granularity, anchor: PinchAnchor) => void;
	enabled?: boolean;
}

/**
 * Two-finger pinch over the timeline grid, mapped onto the discrete day / week
 * / month / year scale.
 *
 * The viewport carries `touch-action: pan-x pan-y`, which leaves one-finger
 * scrolling to the browser (composited, and therefore smooth) while denying it
 * the pinch — so this hook is the only thing reacting to two fingers.
 *
 * Every step reports the date under the user's fingers so the caller can put
 * that date back under them after the rescale. Without it the chart lurches:
 * changing granularity changes every bar's x while scrollLeft stays put.
 *
 * `@use-gesture/react` is deliberately confined to this folder. The canvas
 * engine in `lib/flow/` hand-rolls its pinch because `importBoundary.test.ts`
 * forbids it any dependency beyond react/react-dom; that constraint does not
 * reach here.
 */
export function useTimelinePinch({
	targetRef,
	granularity,
	taskColWidth,
	pxToDate,
	onGranularityChange,
	enabled = true,
}: UseTimelinePinchParams) {
	// The gesture reads these imperatively, so a stale closure cannot pin it to
	// the granularity the component had when the gesture began.
	const granularityRef = useRef(granularity);
	granularityRef.current = granularity;
	const pxToDateRef = useRef(pxToDate);
	pxToDateRef.current = pxToDate;
	const onChangeRef = useRef(onGranularityChange);
	onChangeRef.current = onGranularityChange;
	const taskColWidthRef = useRef(taskColWidth);
	taskColWidthRef.current = taskColWidth;

	/** The offset value at which the last step fired; the ratio is measured from here. */
	const baselineRef = useRef(1);

	usePinch(
		({ first, offset: [scale], origin: [originX] }) => {
			const el = targetRef.current;
			if (!el) return;

			if (first) {
				baselineRef.current = scale;
				return;
			}

			const ratio = scale / baselineRef.current;
			const current = granularityRef.current;
			const { granularity: next, consumed } = resolvePinch(current, ratio);
			if (consumed === 1) return;

			// Bank only what the step used, so a long continuous pinch keeps
			// stepping instead of stalling after the first notch.
			baselineRef.current *= consumed;
			if (next === current) return;

			const rect = el.getBoundingClientRect();
			const offsetX = originX - rect.left - taskColWidthRef.current;
			const date = pxToDateRef.current(offsetX + el.scrollLeft);
			onChangeRef.current(next, { date, offsetX });
		},
		{
			target: targetRef,
			enabled,
			// The gesture has to be cancellable, and a passive listener cannot
			// preventDefault the browser's own zoom.
			eventOptions: { passive: false },
			scaleBounds: { min: 0.2, max: 6 },
		},
	);
}
