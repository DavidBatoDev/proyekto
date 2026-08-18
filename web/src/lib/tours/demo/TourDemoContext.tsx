/**
 * Tour demo mode.
 *
 * When a user *replays* a tour we swap the surface over to fixture data so the
 * spotlights have something to land on — an empty account has no project cards
 * to point at, and a tour that highlights three empty states teaches nothing.
 *
 * Why a context and not `queryClient.setQueryData`: the query cache is shared
 * with every other view and with mutations. Seeding fixtures into it would let
 * demo rows leak into real screens and, worse, become the optimistic base for a
 * real write. Components opt in explicitly instead, one line each.
 */

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import type { TourDemoDataset } from "../types";

interface TourDemoState {
	active: boolean;
	dataset: TourDemoDataset | null;
	enter: (dataset: TourDemoDataset) => void;
	exit: () => void;
}

const TourDemoContext = createContext<TourDemoState | null>(null);

export function TourDemoProvider({ children }: { children: ReactNode }) {
	const [dataset, setDataset] = useState<TourDemoDataset | null>(null);

	const enter = useCallback((next: TourDemoDataset) => setDataset(next), []);
	const exit = useCallback(() => setDataset(null), []);

	const value = useMemo<TourDemoState>(
		() => ({ active: dataset !== null, dataset, enter, exit }),
		[dataset, enter, exit],
	);

	return (
		<TourDemoContext.Provider value={value}>
			{children}
		</TourDemoContext.Provider>
	);
}

/**
 * Control handle for the tour runtime. Safe outside the provider (returns an
 * inert object) so a surface can host a tour without hosting demo mode.
 */
export function useTourDemoControls(): TourDemoState {
	const ctx = useContext(TourDemoContext);
	return (
		ctx ?? {
			active: false,
			dataset: null,
			enter: () => {},
			exit: () => {},
		}
	);
}

/**
 * Swap real data for fixtures while a replay is running.
 *
 * Returns `realData` untouched whenever demo mode is off or the dataset has no
 * entry for `key`, so wiring this into a component is a no-op in normal use.
 */
export function useTourDemo<T>(key: string, realData: T): T {
	const { active, dataset } = useTourDemoControls();
	if (!active || !dataset || !(key in dataset)) return realData;
	return dataset[key] as T;
}

/**
 * Whether a replay is currently showing fixtures. Consumers use it to force
 * their loading state off — fixtures are synchronous, so a skeleton would flash
 * over the very element the tour is about to spotlight.
 */
export function useTourDemoActive(): boolean {
	return useTourDemoControls().active;
}
