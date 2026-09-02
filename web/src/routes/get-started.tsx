import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import {
	ConsultantArt,
	ExecuteArt,
	PlanArt,
} from "@/components/mobile/GetStartedArt";
import { useAuthStore } from "@/stores/authStore";

const SLIDES = [
	{
		Art: PlanArt,
		title: "Plan it with AI",
		body: "Describe what you want to build. Proyekto drafts the epics, features, and tasks — then you shape them on the canvas.",
	},
	{
		Art: ConsultantArt,
		title: "Work with a vetted consultant",
		body: "Every consultant on Proyekto is verified before they can lead delivery, so you are not gambling on a stranger.",
	},
	{
		Art: ExecuteArt,
		title: "Watch it actually ship",
		body: "Tasks, deliverables, and decisions live in one place. You always know what moved this week and what it cost.",
	},
];

/**
 * The signed-out home of the mobile app.
 *
 * The marketing landing at `/` is a long, desktop-shaped scroll — eight
 * animated sections — which is the wrong first thing to hand someone who
 * opened a phone app. This gives them the pitch in three swipes and puts the
 * two decisions they actually came to make at the bottom of every slide, so
 * nobody has to sit through the deck to reach Log in.
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
	const [index, setIndex] = useState(0);
	const touchStartX = useRef<number | null>(null);

	const goTo = (next: number) =>
		setIndex(Math.max(0, Math.min(SLIDES.length - 1, next)));

	// A hand-rolled swipe rather than a carousel dependency: three slides with
	// no looping, autoplay, or virtualisation does not justify the bundle.
	const onTouchStart = (e: React.TouchEvent) => {
		touchStartX.current = e.touches[0].clientX;
	};
	const onTouchEnd = (e: React.TouchEvent) => {
		const start = touchStartX.current;
		touchStartX.current = null;
		if (start === null) return;
		const dx = e.changedTouches[0].clientX - start;
		// 48px: past an accidental drag, short of a deliberate scroll.
		if (Math.abs(dx) < 48) return;
		goTo(dx < 0 ? index + 1 : index - 1);
	};

	const slide = SLIDES[index];
	const { Art } = slide;

	return (
		<div className="flex min-h-[100dvh] flex-col bg-background px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
			<header className="flex justify-center py-2">
				<BrandMark variant="lockup" className="h-8" />
			</header>

			{/* Touch handlers are a progressive enhancement; the dots below stay
			    the keyboard- and screen-reader-accessible way to move. */}
			<section
				className="flex flex-1 flex-col items-center justify-center"
				onTouchStart={onTouchStart}
				onTouchEnd={onTouchEnd}
			>
				<div className="h-52 w-full max-w-[280px]">
					<Art />
				</div>

				<h1 className="mt-8 text-center text-2xl font-bold text-foreground">
					{slide.title}
				</h1>
				<p className="mt-3 max-w-[320px] text-center text-sm leading-relaxed text-muted-foreground">
					{slide.body}
				</p>

				<div className="mt-8 flex gap-2">
					{SLIDES.map((s, i) => (
						<button
							key={s.title}
							type="button"
							onClick={() => goTo(i)}
							aria-label={`Go to slide ${i + 1}: ${s.title}`}
							aria-current={i === index}
							className={`h-2 rounded-full transition-all ${
								i === index ? "w-6 bg-primary" : "w-2 bg-muted-foreground/30"
							}`}
						/>
					))}
				</div>
			</section>

			{/* Fixed on every slide: someone who already has an account should never
			    have to swipe through a pitch to sign in. */}
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
