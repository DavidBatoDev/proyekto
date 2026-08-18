import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/marketplace` has no page of its own yet.
 *
 * It redirects to the public consultant directory rather than to Finance:
 * Finance is gated on a verified consultant enrolment, so sending everyone
 * there would bounce anonymous visitors and non-consultants straight to the
 * login screen — a poor result for a namespace that now contains the public
 * storefront. `browse` renders for everyone, signed in or not.
 *
 * When the marketplace home is designed this becomes a real dashboard.
 */
export const Route = createFileRoute("/marketplace/")({
	beforeLoad: () => {
		throw redirect({ to: "/marketplace/consultant/browse", replace: true });
	},
});
