import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The consultant storefront moved into the combined /start-selling page (one
 * door for everyone earning on Proyekto, consultant side preselected). This
 * redirect keeps every inbound link working — the marketplace footer, the
 * root marketing header, the welcome page, the survey CTA, and anything else
 * that learned the old address.
 */
export const Route = createFileRoute("/marketplace/consultant/")({
	beforeLoad: () => {
		throw redirect({ to: "/start-selling", hash: "lead-engagements" });
	},
});
