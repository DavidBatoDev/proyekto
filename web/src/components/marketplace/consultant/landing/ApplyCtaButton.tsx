import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { isActiveConsultant } from "@/lib/auth-utils";
import { cn } from "@/lib/utils";
import { applicationService } from "@/services/profile.service";
import { useAuthStore } from "@/stores/authStore";

const APPLY = "/marketplace/consultant/apply";

/**
 * The page's only call to action, status-aware.
 *
 * An approved consultant should never be told to "continue an application",
 * and someone in review should know they are in review — so the label follows
 * the application lifecycle. `isActiveConsultant(profile)` covers consultants
 * verified without an application row (seeded/legacy enrollments).
 *
 * Anonymous visitors route through signup with `search={{ redirect }}` for the
 * same reason StartSellingCtaButton does: the apply route's own login redirect
 * carries no return-to, so sending someone straight there loses the thing they
 * clicked.
 */
export function ApplyCtaButton({
	tone = "default",
	className,
}: {
	/** `onPhoto` sits over a dimmed photo, where the primary blue loses contrast. */
	tone?: "default" | "onPhoto";
	className?: string;
}) {
	const { isAuthenticated } = useAuthStore();
	const { data: profile } = useProfileQuery();

	const applicationQuery = useQuery({
		queryKey: ["consultant-application", "me"],
		queryFn: () => applicationService.getMyApplication(),
		enabled: isAuthenticated,
		staleTime: 60 * 1000,
	});
	const status = applicationQuery.data?.status;
	const isVerified = status === "approved" || isActiveConsultant(profile);

	const classes = cn(
		"inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-opacity hover:opacity-90",
		tone === "onPhoto"
			? "bg-background text-foreground shadow-lg"
			: "bg-primary text-primary-foreground shadow-sm",
		className,
	);

	if (!isAuthenticated) {
		return (
			<Link to="/auth/signup" search={{ redirect: APPLY }} className={classes}>
				Lead projects
				<ArrowRight className="h-4 w-4" />
			</Link>
		);
	}

	if (isVerified) {
		return (
			<Link to="/marketplace" className={classes}>
				You're verified — go to the marketplace
				<ArrowRight className="h-4 w-4" />
			</Link>
		);
	}

	const label =
		status === "submitted" || status === "under_review"
			? "Your application is in review"
			: status === "rejected"
				? "Revise your application"
				: status === "draft"
					? "Continue your application"
					: "Lead projects";

	return (
		<Link to={APPLY} className={classes}>
			{label}
			<ArrowRight className="h-4 w-4" />
		</Link>
	);
}
