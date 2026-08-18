/**
 * Cross-tree trigger for "replay this tour".
 *
 * The menu entry lives in the header's UserMenu, which sits outside the
 * surface's TourDemoProvider, so it can't reach the runner's `start` through
 * React state. Same window-event pattern as projectInviteModalEvents.
 */

export const REPLAY_TOUR_EVENT = "replay-product-tour";

export type ReplayTourDetail = {
	/** Omitted means "whatever tour the current surface registers". */
	tourKey?: string;
};

export function replayProductTour(tourKey?: string) {
	if (typeof window === "undefined") return;
	window.dispatchEvent(
		new CustomEvent<ReplayTourDetail>(REPLAY_TOUR_EVENT, {
			detail: tourKey ? { tourKey } : {},
		}),
	);
}

export const EXIT_TOUR_EVENT = "exit-product-tour";

/**
 * Hard exit from a running tour, used by the demo banner's "Exit tour" button.
 *
 * This is the escape hatch that does not depend on Joyride's own state: ESC
 * only *closes* a step in continuous mode (it leaves a beacon and fires no
 * terminal status), so without this a replay could strand the user looking at
 * fixture data.
 */
export function exitProductTour() {
	if (typeof window === "undefined") return;
	window.dispatchEvent(new CustomEvent(EXIT_TOUR_EVENT));
}
