import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsAuthenticated } from "@/stores/authStore";

const GO_LIVE = "/marketplace/talent/go-live";

/**
 * The page's only call to action, in both places it appears.
 *
 * Auth-aware for a reason that is easy to miss: `go-live.tsx` gates on
 * `isAuthenticated` and redirects to `/auth/login` with NO return-to parameter,
 * so an anonymous visitor sent straight there signs in and lands wherever the
 * login page defaults to — having lost the thing they clicked. Routing them
 * through signup with `search={{ redirect }}` is what carries the destination
 * across, and it is the same shape `ApplyButton` uses on the consultant
 * landing page.
 *
 * Deliberately does not check `talent_profiles.status`: an already-live
 * talent sees the same button and re-enters the wizard. Saying "Manage your
 * listing" would need a status read this page does not otherwise make, and
 * guessing would be worse than being plain.
 */
export function StartSellingCtaButton({
	tone = "default",
	className,
}: {
	/** `onPhoto` sits over a dimmed photo, where the primary blue loses contrast. */
	tone?: "default" | "onPhoto";
	className?: string;
}) {
	const isAuthenticated = useIsAuthenticated();

	const classes = cn(
		"inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-opacity hover:opacity-90",
		tone === "onPhoto"
			? "bg-background text-foreground shadow-lg"
			: "bg-primary text-primary-foreground shadow-sm",
		className,
	);

	if (isAuthenticated) {
		return (
			<Link to={GO_LIVE} className={classes}>
				Start selling
				<ArrowRight className="h-4 w-4" />
			</Link>
		);
	}

	return (
		<Link to="/auth/signup" search={{ redirect: GO_LIVE }} className={classes}>
			Create your profile
			<ArrowRight className="h-4 w-4" />
		</Link>
	);
}
