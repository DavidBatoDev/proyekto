import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand/BrandMark";
import { PlanArt } from "@/components/mobile/GetStartedArt";
import { useAuthStore } from "@/stores/authStore";

/**
 * The signed-out home of the mobile app.
 *
 * The marketing landing at `/` is a long, desktop-shaped scroll — eight
 * animated sections — which is the wrong first thing to hand someone who
 * opened a phone app. One illustration, one line about what this is, and the
 * two decisions they came to make.
 *
 * Web is untouched and keeps the landing page.
 */
export const Route = createFileRoute("/get-started")({
	beforeLoad: () => {
		// Signed in already: this screen has nothing to offer.
		const { isAuthenticated, isLoading } = useAuthStore.getState();
		if (!isLoading && isAuthenticated) {
			throw redirect({ to: "/dashboard", replace: true });
		}
	},
	component: GetStartedPage,
});

function GetStartedPage() {
	return (
		<div className="flex min-h-[100dvh] flex-col bg-background px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
			<header className="flex justify-center py-2">
				<BrandMark variant="lockup" className="h-9" />
			</header>

			<section className="flex flex-1 flex-col items-center justify-center">
				<div className="h-56 w-full max-w-[300px]">
					<PlanArt />
				</div>

				<h1 className="mt-8 text-center text-2xl font-bold text-foreground">
					Projects that actually ship
				</h1>
				<p className="mt-3 max-w-[320px] text-center text-sm leading-relaxed text-muted-foreground">
					Plan it with AI, bring in a vetted consultant, and run the delivery in
					one place.
				</p>
			</section>

			<footer className="flex flex-col gap-3 pt-8">
				<Link
					to="/auth/signup"
					className="flex h-13 items-center justify-center rounded-xl bg-primary text-base font-semibold text-primary-foreground active:opacity-90"
				>
					Create account
				</Link>
				<Link
					to="/auth/login"
					className="flex h-13 items-center justify-center rounded-xl border border-border text-base font-semibold text-foreground active:bg-muted"
				>
					Log in
				</Link>
			</footer>
		</div>
	);
}
