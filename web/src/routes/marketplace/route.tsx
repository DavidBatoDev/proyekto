import { createFileRoute, Outlet } from "@tanstack/react-router";
import { NotFoundRoute } from "@/components/layout/NotFoundRoute";
import { MarketplaceSurveyGate } from "@/components/marketplace/survey/MarketplaceSurveyGate";

/**
 * The `/marketplace` layout.
 *
 * It cannot own `MarketplaceShell`, because the shell includes `ProtectedRoute`
 * and this subtree holds genuinely public pages — the consultant landing at
 * `/marketplace/consultant` and the public profile at
 * `/marketplace/consultant/$profileId`, both of which must render for anonymous
 * visitors and stay indexable. Authenticated pages opt into the shell
 * themselves.
 *
 * Besides the `Outlet` it mounts exactly one thing: `MarketplaceSurveyGate`,
 * the first-visit intake survey. It lives here rather than on the storefront
 * route so it also covers `/talent` and the category pages, and it is safe on a
 * public layout because it renders null for anonymous visitors, while auth is
 * still hydrating, and on every route outside its own browse allowlist — which
 * excludes the public profile, where a modal over somebody's shared link would
 * be an ambush. Nothing it reads decides access; see
 * `scripts/check_survey_is_not_authz.mjs`.
 *
 * `_execution` stays pathless by contrast: execution is the surface every user
 * lands on after signup, so `/dashboard` should not become
 * `/execution/dashboard`. The asymmetry is intentional.
 */
export const Route = createFileRoute("/marketplace")({
	component: MarketplaceLayout,
	/**
	 * Without this, an unmatched `/marketplace/*` path renders this layout with
	 * an empty Outlet -- a blank page -- instead of bubbling to the root's
	 * handler. That matters because `NotFoundRoute` is what forwards legacy
	 * paths: `/freelancer/go-live` redirected correctly while
	 * `/marketplace/freelancer/go-live` sat on a blank screen, purely because
	 * one of them reached the root handler and the other did not.
	 */
	notFoundComponent: NotFoundRoute,
});

function MarketplaceLayout() {
	return (
		<>
			<Outlet />
			<MarketplaceSurveyGate />
		</>
	);
}
