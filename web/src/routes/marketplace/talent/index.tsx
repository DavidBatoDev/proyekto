import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The talent storefront moved into the combined /start-selling page (one door
 * for everyone earning on Proyekto, talent side preselected). This redirect
 * keeps every inbound link working — the marketplace footer, emails, and
 * anything else that learned the old address.
 */
export const Route = createFileRoute("/marketplace/talent/")({
	beforeLoad: () => {
		// Top of the page, not the #sell-your-work anchor: the talent story
		// opens the combined page, so the shared hero IS its landing.
		throw redirect({ to: "/start-selling" });
	},
});
