import { type LinkProps, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

/**
 * "Back" that means the page you came from, not a fixed destination.
 *
 * The pages that carry their own header — brief creation, the brief editor and
 * reader, project creation — are reached from several places: the dashboard,
 * the marketplace board, a notification, a shared link. A hardcoded
 * "Back to dashboard" was wrong for most of those arrivals and silently threw
 * away where the reader actually was.
 *
 * `canGoBack()` is false only when this entry is the first in the session's
 * history — a pasted URL, a new tab, an external link — and that is the one
 * case where a destination has to be guessed, so it is the only case the
 * fallback covers.
 */
export function BackLink({
	fallback,
	label = "Back",
}: {
	/** Where to go when the page was opened directly, with nothing behind it. */
	fallback: LinkProps;
	label?: string;
}) {
	const router = useRouter();

	return (
		<button
			type="button"
			onClick={() => {
				if (router.history.canGoBack()) {
					router.history.back();
					return;
				}
				void router.navigate(fallback);
			}}
			className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
		>
			<ArrowLeft className="h-4 w-4" />
			{label}
		</button>
	);
}
