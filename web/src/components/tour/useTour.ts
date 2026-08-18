/**
 * Product tour runtime.
 *
 * Owns three things: whether a tour should auto-run, the demo-mode swap that
 * makes replay meaningful on an empty account, and persisting the outcome.
 *
 * The tour runs in react-joyride's *uncontrolled* mode — Joyride owns the step
 * index and the Next/Back wiring, and we only listen for the terminal status.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EVENTS, type EventData, STATUS, type Step } from "react-joyride";
import { useTourDemoControls } from "@/lib/tours/demo/TourDemoContext";
import { getTourDefinition } from "@/lib/tours/registry";
import {
	fetchTourProgress,
	hasSeenTourLocally,
	markTourSeenLocally,
	recordTourProgress,
	recordTourReplay,
	tourKeys,
} from "@/queries/tours";
import { useAuthStore } from "@/stores/authStore";
import { GLOBAL_TOUR_SCOPE, type TourScope, type TourStatus } from "@/types";

/** Matches the `sm` breakpoint the dashboard layout switches on. */
const MOBILE_QUERY = "(max-width: 640px)";

function useIsMobile(): boolean {
	const [isMobile, setIsMobile] = useState(() =>
		typeof window === "undefined"
			? false
			: window.matchMedia(MOBILE_QUERY).matches,
	);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const mql = window.matchMedia(MOBILE_QUERY);
		const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
		mql.addEventListener("change", onChange);
		return () => mql.removeEventListener("change", onChange);
	}, []);

	return isMobile;
}

export interface UseTourResult {
	run: boolean;
	steps: Step[];
	handleEvent: (data: EventData) => void;
	/** Start the tour. Always swaps the surface to fixture data. */
	start: () => void;
	stop: () => void;
	/**
	 * Whether this user has already been through this tour. `null` while the
	 * lookup is in flight — callers should render nothing rather than guess,
	 * since guessing wrong makes the launcher glow at someone who has already
	 * taken the tour.
	 */
	hasSeen: boolean | null;
}

export function useTour(
	tourKey: string,
	scope: TourScope = GLOBAL_TOUR_SCOPE,
): UseTourResult {
	const user = useAuthStore((state) => state.user);
	const queryClient = useQueryClient();
	const isMobile = useIsMobile();
	const demo = useTourDemoControls();

	const [run, setRun] = useState(false);
	const [autoRunConsumed, setAutoRunConsumed] = useState(false);

	const definition = getTourDefinition(tourKey);

	// Completion is permanent, so once it is known locally we never ask again —
	// not on this mount, and not after a reload.
	const seenLocally = user?.id
		? hasSeenTourLocally(user.id, tourKey, scope)
		: false;

	const progressQuery = useQuery({
		queryKey: tourKeys.progress(user?.id ?? "", tourKey, scope),
		queryFn: () => fetchTourProgress(user!.id, tourKey, scope),
		enabled: Boolean(user?.id) && definition !== null && !seenLocally,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		refetchOnMount: false,
		retry: 1,
	});

	const steps = useMemo(() => {
		if (!definition) return [];
		return isMobile ? definition.mobileSteps : definition.steps;
	}, [definition, isMobile]);

	const stop = useCallback(() => {
		setRun(false);
		demo.exit();
	}, [demo]);

	// Every run — first-time or replay — uses fixtures. The whole point of the
	// demo dataset is that the tour can point at the same elements every time,
	// and a first-time user is precisely the person whose workspace is empty.
	const start = useCallback(() => {
		if (!definition || steps.length === 0) return;
		if (definition.demoDataset) demo.enter(definition.demoDataset);
		setRun(true);
	}, [definition, demo, steps.length]);

	// Auto-run: only for a user we know has never been through this tour, only
	// once per mount, and never on mobile (the sidebar step's target isn't in
	// the DOM there, and a half-tour is worse than none). The row written on
	// finish/skip is what stops this from firing a second time.
	useEffect(() => {
		if (autoRunConsumed || run) return;
		if (seenLocally) return;
		if (isMobile) return;
		if (!user?.id || !definition) return;
		if (progressQuery.isPending || progressQuery.isError) return;
		if (progressQuery.data !== null) return;

		setAutoRunConsumed(true);
		start();
	}, [
		autoRunConsumed,
		definition,
		isMobile,
		seenLocally,
		progressQuery.data,
		progressQuery.isError,
		progressQuery.isPending,
		run,
		start,
		user?.id,
	]);

	const persist = useCallback(
		async (status: TourStatus, lastStep: number) => {
			if (!user?.id) return;
			// The local cache disables the query, so `data` is undefined for a
			// returning user — without this the replay would be recorded as a
			// fresh completion and overwrite the original row.
			const alreadySeen = seenLocally || progressQuery.data != null;
			try {
				if (alreadySeen) {
					await recordTourReplay(user.id, tourKey, scope);
				} else {
					await recordTourProgress({
						userId: user.id,
						tourKey,
						scope,
						status,
						lastStep,
					});
				}
				markTourSeenLocally(user.id, tourKey, scope);
				// Seed rather than invalidate: invalidating would immediately
				// re-fetch the row we just wrote, which is the request this cache
				// exists to avoid.
				queryClient.setQueryData(
					tourKeys.progress(user.id, tourKey, scope),
					(current: unknown) => current ?? { tour_key: tourKey },
				);
			} catch (error) {
				// Non-fatal, same posture as the /welcome completion backstop: the
				// worst case is the tour offers itself once more next visit.
				console.error("Failed to record tour progress:", error);
			}
		},
		[progressQuery.data, queryClient, scope, seenLocally, tourKey, user?.id],
	);

	const handleEvent = useCallback(
		(data: EventData) => {
			// TOUR_END is the only terminal event: Joyride emits it exactly when
			// status changes to FINISHED or SKIPPED. TOUR_STATUS is NOT a
			// substitute — it fires only on the STOP and RESET actions, so
			// listening for it means a completed tour is never recorded.
			if (data.type !== EVENTS.TOUR_END) return;

			void persist(
				data.status === STATUS.SKIPPED ? "skipped" : "completed",
				data.index,
			);
			stop();
		},
		[persist, stop],
	);

	const hasSeen = seenLocally
		? true
		: progressQuery.isPending || progressQuery.isError
			? null
			: progressQuery.data != null;

	return { run, steps, handleEvent, start, stop, hasSeen };
}
