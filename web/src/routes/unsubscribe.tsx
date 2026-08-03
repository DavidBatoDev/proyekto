import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, Loader2, MailX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { notificationsService } from "@/services/notifications.service";

/**
 * Human-facing unsubscribe landing, reached from the footer link in a
 * notification email.
 *
 * Deliberately public and session-free: the whole point is that it works from an
 * inbox, on whatever device happened to open the mail. The token in the query
 * string is the only input.
 *
 * Distinct from the one-click header target, which mail clients POST silently in
 * the background — that one never renders anything.
 */
export const Route = createFileRoute("/unsubscribe")({
	validateSearch: (search: Record<string, unknown>) => ({
		token: typeof search.token === "string" ? search.token : undefined,
		scope: typeof search.scope === "string" ? search.scope : undefined,
	}),
	component: UnsubscribePage,
});

const SCOPE_COPY: Record<string, string> = {
	task_comment_mention: "task comment mentions",
	feature_comment_mention: "feature comment mentions",
	epic_comment_mention: "epic comment mentions",
	chat_mention: "chat mentions",
	chat_dm_received: "direct messages",
};

function UnsubscribePage() {
	const { token, scope } = Route.useSearch();
	const [state, setState] = useState<"working" | "done" | "invalid">(
		token ? "working" : "invalid",
	);
	// StrictMode double-invokes effects in dev; unsubscribing twice is harmless
	// but the flicker is not.
	const sent = useRef(false);

	useEffect(() => {
		if (!token || sent.current) return;
		sent.current = true;
		notificationsService
			.unsubscribe(token, scope)
			// The API answers 200 even for an unknown token, on purpose — it must
			// not become a way to test whether a token is real. So a network error
			// is the only failure we can distinguish.
			.then(() => setState("done"))
			.catch(() => setState("invalid"));
	}, [token, scope]);

	const what = scope && scope !== "all" ? SCOPE_COPY[scope] : null;

	return (
		<div className="flex min-h-screen items-center justify-center bg-background px-4">
			<div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center">
				{state === "working" ? (
					<>
						<Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
						<p className="mt-4 text-sm text-muted-foreground">
							Updating your preferences…
						</p>
					</>
				) : state === "done" ? (
					<>
						<CheckCircle2 className="mx-auto h-10 w-10 text-success" />
						<h1 className="mt-4 text-lg font-semibold text-foreground">
							You are unsubscribed
						</h1>
						<p className="mt-2 text-sm text-muted-foreground">
							{what
								? `We will stop emailing you about ${what}.`
								: "We will stop sending you notification email."}{" "}
							You will still see everything in the app.
						</p>
						<Link
							to="/settings/notifications"
							className="mt-6 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
						>
							Manage all notification settings
						</Link>
					</>
				) : (
					<>
						<MailX className="mx-auto h-10 w-10 text-muted-foreground" />
						<h1 className="mt-4 text-lg font-semibold text-foreground">
							This link did not work
						</h1>
						<p className="mt-2 text-sm text-muted-foreground">
							It may be incomplete. You can change what Proyekto emails you from
							your notification settings.
						</p>
						<Link
							to="/settings/notifications"
							className="mt-6 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
						>
							Open notification settings
						</Link>
					</>
				)}
			</div>
		</div>
	);
}
