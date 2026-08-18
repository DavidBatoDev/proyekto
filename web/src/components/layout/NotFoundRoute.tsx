import { Link, useRouter } from "@tanstack/react-router";
import { Compass } from "lucide-react";
import { useEffect, useState } from "react";
import { mapLegacyPath } from "@/lib/legacyRoutePaths";

/**
 * The app's only not-found surface, and the backstop for every URL that moved
 * under `/marketplace`.
 *
 * Old paths keep arriving from places that cannot be rewritten: `link_url` rows
 * persisted on notifications, FCM payloads already sitting in device trays,
 * `signup_redirect` values in sessionStorage, and third-party links. There is no
 * edge redirect layer — wrangler serves index.html with a 200 for any unmatched
 * path — so this component is where a legacy URL is recognised and forwarded.
 *
 * Doing it here rather than in a shim file per moved route means one
 * implementation reading one map, instead of a dozen files each restating it.
 */
export function NotFoundRoute() {
	const router = useRouter();
	// Held so the "not found" copy never flashes before a legacy redirect fires.
	const [redirecting, setRedirecting] = useState(true);

	useEffect(() => {
		const current =
			window.location.pathname + window.location.search + window.location.hash;
		const mapped = mapLegacyPath(current);
		if (mapped !== current) {
			router.history.replace(mapped);
			return;
		}
		setRedirecting(false);
	}, [router]);

	if (redirecting) return null;

	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
			<span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
				<Compass className="h-6 w-6" />
			</span>
			<h1 className="text-xl font-semibold">This page does not exist</h1>
			<p className="max-w-md text-sm text-muted-foreground">
				The link may be out of date, or the page may have moved.
			</p>
			<Link
				to="/dashboard"
				className="app-cta mt-2 rounded-lg px-4 py-2 text-sm font-semibold text-white"
			>
				Go to your workspace
			</Link>
		</div>
	);
}
