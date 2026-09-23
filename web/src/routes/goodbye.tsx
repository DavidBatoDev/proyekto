import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import { ACCOUNT_DELETED_FLAG } from "@/components/settings/delete-account/accountTeardown";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { deletionCopy } from "@/lib/accountDeletionCopy";
import { isNativeApp } from "@/lib/platform";
import { supabase } from "@/lib/supabase";

/**
 * Where a deleted account ends up.
 *
 * Reached by a hard navigation from the delete flow, so this is a fresh
 * document: no router cache, no Zustand state, no AI run controller. It draws
 * its own chrome and is deliberately absent from `Header.tsx` `validPaths` —
 * the app header would be wrong above a page for someone with no account.
 *
 * Static and stateless on purpose: safe to reload, safe to bookmark, and it
 * cannot 404 or bounce. The sign-out happens HERE rather than in the previous
 * document because `ProtectedRoute` reacts to `onAuthStateChange` by navigating
 * to the login page — doing it there means the user sees a login screen flash
 * instead of this.
 */
export const Route = createFileRoute("/goodbye")({
	component: GoodbyePage,
});

function GoodbyePage() {
	useDocumentTitle("Account deleted");
	const native = isNativeApp();

	useEffect(() => {
		try {
			sessionStorage.removeItem(ACCOUNT_DELETED_FLAG);
		} catch {
			/* storage unavailable */
		}
		// Clears the `sb-<ref>-auth-token` key without this page having to guess
		// its name. The session is already dead server-side, so a missing-session
		// error here is the expected case, not a failure.
		void supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
	}, []);

	return (
		<div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-16 text-center">
			<BrandMark variant="lockup" className="h-8" />

			<h1 className="mt-10 max-w-lg text-2xl font-semibold tracking-tight text-foreground">
				{deletionCopy.goodbyeTitle}
			</h1>

			<p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
				{deletionCopy.goodbyeBody}
			</p>

			<p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
				{deletionCopy.goodbyeKept}
			</p>

			<div className="mt-10 flex flex-wrap items-center justify-center gap-3">
				{/* On native "/" classifies `silent` and would bounce to the
				    dashboard and then straight back to login, so the app gets the
				    one destination that means anything to a signed-out person. */}
				{!native ? (
					<Link
						to="/"
						className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
					>
						Return to proyekto.tech
					</Link>
				) : null}
				<Link
					to="/auth/login"
					search={{ redirect: undefined }}
					className="inline-flex h-10 items-center justify-center rounded-xl border border-border px-5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
				>
					Sign in with another account
				</Link>
			</div>
		</div>
	);
}
