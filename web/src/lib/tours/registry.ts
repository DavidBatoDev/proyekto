/**
 * Tour registry.
 *
 * Adding a surface tour is one definition file plus one entry here — the
 * runtime, the persistence, and the replay menu all resolve through this map.
 */

import { DASHBOARD_TOUR, DASHBOARD_TOUR_KEY } from "./dashboardTour";
import type { TourDefinition } from "./types";

export const TOUR_REGISTRY: Record<string, TourDefinition> = {
	[DASHBOARD_TOUR_KEY]: DASHBOARD_TOUR,
};

export function getTourDefinition(key: string): TourDefinition | null {
	return TOUR_REGISTRY[key] ?? null;
}

/**
 * Which tour, if any, covers the given pathname. Drives the "Replay product
 * tour" menu entry, which lights up automatically once a new surface registers
 * a tour here.
 */
export function resolveTourForPath(pathname: string): TourDefinition | null {
	if (pathname === "/dashboard") return DASHBOARD_TOUR;
	return null;
}
