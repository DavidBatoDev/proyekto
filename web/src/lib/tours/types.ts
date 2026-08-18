/**
 * Product tour definitions.
 *
 * A tour is a list of react-joyride steps plus, optionally, a demo dataset.
 * The demo dataset is what makes replay work: a user re-watching the dashboard
 * tour on an empty account still needs Teams/Projects/Roadmaps cards to exist
 * for the spotlights to land on.
 */

import type { Step } from "react-joyride";
import type { TourScopeType } from "@/types";

/**
 * Fixture data a surface swaps in while a tour replays. Keys are read by the
 * consuming components through `useTourDemo(key, realData)`.
 */
export type TourDemoDataset = Record<string, unknown>;

export interface TourDefinition {
	key: string;
	scopeType: TourScopeType;
	/** Steps used on desktop. */
	steps: Step[];
	/**
	 * Steps used below the mobile breakpoint. Some anchors (the sidebar nav)
	 * are collapsed out of the DOM there, and Joyride silently stalls on a
	 * target it cannot find.
	 */
	mobileSteps: Step[];
	demoDataset?: TourDemoDataset;
}
