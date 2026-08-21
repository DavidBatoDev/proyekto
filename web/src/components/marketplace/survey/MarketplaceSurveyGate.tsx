import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMarketplaceSurveyQuery } from "@/hooks/useMarketplaceSurvey";
import { surveyIsOutstanding } from "@/lib/marketplaceSurvey";
import { useIsAuthenticated, useIsLoading } from "@/stores/authStore";
import { MarketplaceSurveyModal } from "./MarketplaceSurveyModal";

/**
 * Decides whether the intake survey is offered at all.
 *
 * Mounted by the `/marketplace` layout, which is a PUBLIC subtree — the
 * storefront and the public consultant profile both render for anonymous
 * visitors. So every gate below is a reason to render nothing:
 *
 *   - anonymous, or auth still hydrating (`profile` arrives asynchronously via
 *     onAuthStateChange; deciding before it lands flashes the modal at someone
 *     who already answered — the same flicker /welcome documents)
 *   - not on a browse surface (see SURVEY_PATHS)
 *   - already answered, or skipped, or the answer hasn't loaded yet
 *
 * Nothing here reads survey answers to decide access. The survey is
 * personalization; `scripts/check_survey_is_not_authz.mjs` keeps it that way.
 */

/**
 * The surfaces worth interrupting: places somebody is browsing for work or for
 * people. Deliberately excludes `/marketplace/consultant/$profileId` — a shared
 * link to a real person's profile is the worst possible moment for a modal —
 * and the finance portfolio, which is task-focused, not browsing.
 */
export const SURVEY_PATHS = [
	"/marketplace",
	"/marketplace/talent/browse",
	"/marketplace/consultant/browse",
] as const;

const SURVEY_PATH_PREFIXES = ["/marketplace/category"] as const;

export function isSurveySurface(pathname: string): boolean {
	const normalized =
		pathname.length > 1 && pathname.endsWith("/")
			? pathname.slice(0, -1)
			: pathname;
	if ((SURVEY_PATHS as readonly string[]).includes(normalized)) return true;
	return SURVEY_PATH_PREFIXES.some(
		(prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
	);
}

export function MarketplaceSurveyGate() {
	const isAuthenticated = useIsAuthenticated();
	const isLoading = useIsLoading();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});

	const onSurface = isSurveySurface(pathname);
	const ready = isAuthenticated && !isLoading;

	const surveyQuery = useMarketplaceSurveyQuery({
		enabled: ready && onSurface,
	});

	// Latched so a mid-survey navigation (the modal is above the page, and the
	// router keeps running underneath) cannot yank the dialog away half-answered.
	const [open, setOpen] = useState(false);
	const [dismissed, setDismissed] = useState(false);

	useEffect(() => {
		if (dismissed || open) return;
		if (!ready || !onSurface) return;
		if (!surveyQuery.isSuccess) return;
		if (!surveyIsOutstanding(surveyQuery.data)) return;
		setOpen(true);
	}, [
		dismissed,
		open,
		ready,
		onSurface,
		surveyQuery.isSuccess,
		surveyQuery.data,
	]);

	if (!open) return null;

	return (
		<MarketplaceSurveyModal
			open={open}
			onClose={() => {
				setOpen(false);
				setDismissed(true);
			}}
		/>
	);
}
