/**
 * Renders a registered tour on the current surface.
 *
 * Colours come from the theme's CSS custom properties rather than literals, so
 * the tooltip follows light/dark and any future palette change automatically —
 * hardcoded hex is a repo-wide no.
 */

import { useEffect, useState } from "react";
import { Joyride } from "react-joyride";
import { useTourDemoActive } from "@/lib/tours/demo/TourDemoContext";
import { GLOBAL_TOUR_SCOPE, type TourScope } from "@/types";
import { TourLauncher } from "./TourLauncher";
import {
	EXIT_TOUR_EVENT,
	REPLAY_TOUR_EVENT,
	type ReplayTourDetail,
} from "./tourEvents";
import { useTour } from "./useTour";

/** Reads a theme token off :root, with a literal fallback for SSR/tests. */
function cssVar(name: string, fallback: string): string {
	if (typeof window === "undefined") return fallback;
	const value = getComputedStyle(document.documentElement)
		.getPropertyValue(name)
		.trim();
	return value || fallback;
}

export interface TourRunnerProps {
	tourKey: string;
	scope?: TourScope;
}

export function TourRunner({
	tourKey,
	scope = GLOBAL_TOUR_SCOPE,
}: TourRunnerProps) {
	const { run, steps, handleEvent, start, stop, hasSeen } = useTour(
		tourKey,
		scope,
	);
	const isDemo = useTourDemoActive();
	const [theme, setTheme] = useState(() => readTheme());

	// Re-read the tokens when the tour opens: the user may have switched theme
	// since mount, and Joyride snapshots these into inline styles.
	useEffect(() => {
		if (run) setTheme(readTheme());
	}, [run]);

	// Replay always runs with fixtures: the user asking to re-watch the tour is
	// usually the user whose dashboard has nothing on it to point at.
	useEffect(() => {
		const onReplay = (event: Event) => {
			const detail = (event as CustomEvent<ReplayTourDetail>).detail;
			if (detail?.tourKey && detail.tourKey !== tourKey) return;
			start();
		};
		window.addEventListener(REPLAY_TOUR_EVENT, onReplay);
		return () => window.removeEventListener(REPLAY_TOUR_EVENT, onReplay);
	}, [start, tourKey]);

	// Unconditional escape hatch. ESC maps to Joyride's "close", which in
	// continuous mode only hides the tooltip and leaves a beacon behind — no
	// terminal status, so nothing would otherwise take the surface back off
	// fixture data.
	useEffect(() => {
		const onExit = () => stop();
		window.addEventListener(EXIT_TOUR_EVENT, onExit);
		return () => window.removeEventListener(EXIT_TOUR_EVENT, onExit);
	}, [stop]);

	if (steps.length === 0) return null;

	return (
		<>
			{!run && <TourLauncher hasSeen={hasSeen} onStart={start} />}
			<Joyride
				steps={steps}
				run={run}
				continuous
				onEvent={handleEvent}
				options={{
					zIndex: 10_000,
					showProgress: true,
					// Back / Next / Skip. Omitting "close" keeps the only exits
					// deliberate, so a stray click can't silently mark the tour seen.
					buttons: ["back", "primary", "skip"],
					overlayClickAction: false,
					// Clears the fixed app header so a spotlit element never scrolls
					// underneath it — plus the demo bar, which is pinned above the
					// header while a replay is running.
					scrollOffset: isDemo ? 148 : 96,
					primaryColor: theme.primary,
					backgroundColor: theme.background,
					textColor: theme.text,
					arrowColor: theme.background,
					overlayColor: "rgba(15, 23, 42, 0.55)",
				}}
				locale={{
					back: "Back",
					close: "Close",
					last: "Done",
					next: "Next",
					skip: "Skip tour",
				}}
				styles={{
					tooltip: { borderRadius: 12, padding: 20 },
					tooltipTitle: { fontSize: 16, fontWeight: 600, marginBottom: 8 },
					tooltipContent: { fontSize: 14, lineHeight: 1.6, padding: 0 },
					buttonPrimary: {
						borderRadius: 999,
						padding: "8px 16px",
						fontSize: 13,
						fontWeight: 600,
					},
					buttonBack: { fontSize: 13, fontWeight: 600, marginRight: 8 },
					buttonSkip: { fontSize: 13, color: theme.muted },
				}}
			/>
		</>
	);
}

function readTheme() {
	return {
		primary: cssVar("--primary", "#2563eb"),
		background: cssVar("--popover", "#ffffff"),
		text: cssVar("--popover-foreground", "#0f172a"),
		muted: cssVar("--muted-foreground", "#64748b"),
	};
}
