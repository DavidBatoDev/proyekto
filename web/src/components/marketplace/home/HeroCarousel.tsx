import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ExplainerVideo } from "@/components/common/ExplainerVideo";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

export type HeroSlide = {
	key: string;
	eyebrow: string;
	headline: string;
	cta: { label: string; to: string; search?: Record<string, unknown> };
	clip: {
		src: string;
		poster: string;
		steps: readonly string[];
		dimensions: { w: number; h: number };
	};
};

/** How long a slide holds before advancing. */
const SLIDE_MS = 7000;
/** The timer ticks at this rate; the bar is drawn from elapsed, not transitioned. */
const TICK_MS = 50;
/** Long enough to read as a crossfade, short enough not to feel like waiting. */
const FADE_S = 0.4;
/** Half of the copy transition: one slide fades out, then the next fades in. */
const FADE_MS = 260;

/**
 * The marketplace promo band: three slides, 70/30, with a pause control and a
 * segment per slide.
 *
 * The progress bar is driven by the same elapsed clock that advances the slide.
 * A CSS transition alone would keep animating while the tab is backgrounded and
 * while the carousel is paused, so the bar would lie about where the timer is.
 * There IS a 100ms width transition on top, but only to smooth the 50ms ticks
 * into a slide rather than a staircase — it is always chasing the real elapsed
 * value, never the source of it, and it stops dead when the clock does.
 *
 * It starts PAUSED for `prefers-reduced-motion`, and holds while anything inside
 * has KEYBOARD focus, so a call to action cannot slide away from someone
 * part-way through tabbing to it. Keyboard specifically: holding on any focus
 * meant a mouse click on a segment or on play left that control focused and the
 * carousel stopped dead, which read as "play does nothing".
 *
 * It deliberately does NOT pause on hover: the pointer crosses this band on the
 * way to everything below it, and stalling every time made it feel stuck. The
 * pause button and the segments are both real controls, so anyone who wants it
 * to stop can stop it.
 *
 * TRANSITIONS. The copy column keeps all three slides mounted in one grid cell
 * and crossfades opacity, so the band always stands at the height of the
 * TALLEST slide and never resizes mid-transition. Swapping a single mounted
 * child instead (`AnimatePresence mode="wait"`) collapses the band below `lg`,
 * where the copy sets its height and there is no clip to hold it open.
 * Inactive slides are `inert`, so their call to action stays out of the tab
 * order rather than being three competing links stacked on each other.
 *
 * The clip is the one thing NOT kept mounted: three autoplaying videos on a
 * dashboard is real decode work for frames nobody sees. It crossfades through
 * `AnimatePresence`, so at most two exist and only for `FADE_S`.
 */
export function HeroCarousel({ slides }: { slides: readonly HeroSlide[] }) {
	const reducedMotion = usePrefersReducedMotion();
	const [index, setIndex] = useState(0);
	const [paused, setPaused] = useState(false);
	/** True only while KEYBOARD focus is inside the band — see onFocusCapture. */
	const [focusHeld, setFocusHeld] = useState(false);
	const [elapsed, setElapsed] = useState(0);
	/**
	 * Bumped on every explicit navigation, and part of the timer's deps.
	 *
	 * Without it, clicking the segment of the slide already showing sets
	 * `elapsed` to 0 but leaves `index` untouched, so the effect's deps do not
	 * change, the old interval survives with its old start time, and the next
	 * tick snaps the bar straight back to where it was.
	 */
	const [cycle, setCycle] = useState(0);

	// Reduced motion decides the initial state only; the button still wins after.
	const [userSet, setUserSet] = useState(false);
	const running = !(userSet ? paused : paused || reducedMotion) && !focusHeld;

	const go = useCallback(
		(next: number) => {
			setIndex(((next % slides.length) + slides.length) % slides.length);
			setElapsed(0);
			setCycle((c) => c + 1);
		},
		[slides.length],
	);

	useEffect(() => {
		if (!running) return;
		const started = Date.now() - elapsed;
		const id = window.setInterval(() => {
			const next = Date.now() - started;
			if (next >= SLIDE_MS) {
				setIndex((i) => (i + 1) % slides.length);
				setElapsed(0);
				return;
			}
			setElapsed(next);
		}, TICK_MS);
		return () => window.clearInterval(id);
		// `elapsed` is intentionally not a dependency: it is what this effect
		// writes, and depending on it would tear down the interval every tick.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [running, index, cycle, slides.length]);

	const active = slides[index];
	// Reduced-motion users get the swap, not the movement.
	const fade = reducedMotion ? 0 : FADE_S;

	return (
		<section
			aria-roledescription="carousel"
			aria-label="What you can do here"
			className="mt-3 overflow-hidden rounded-2xl bg-primary text-primary-foreground"
			onFocusCapture={(event) => {
				// KEYBOARD focus only. A mouse click on a segment or on the play
				// button also focuses it, and holding on that stopped the carousel
				// for good — pressing play did nothing, because the button that was
				// just pressed still had focus. `:focus-visible` is exactly the
				// "arrived here by keyboard" signal, and it is what separates the
				// case worth guarding (a link sliding away mid-tab) from the case
				// that broke it.
				const target = event.target as HTMLElement;
				try {
					if (target.matches(":focus-visible")) setFocusHeld(true);
				} catch {
					// Engines without :focus-visible simply do not hold.
				}
			}}
			onBlurCapture={() => setFocusHeld(false)}
		>
			<div className="grid items-center gap-6 px-6 pt-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] lg:gap-10 lg:px-8">
				<div
					aria-live="polite"
					aria-atomic="true"
					className="mx-auto grid w-full max-w-2xl lg:mx-0 lg:max-w-none"
				>
					{slides.map((slide, i) => {
						const shown = i === index;
						return (
							<div
								key={slide.key}
								// All three share one grid cell, so the column is always as
								// tall as the tallest and nothing reflows on a change.
								className="col-start-1 row-start-1 transition-opacity duration-[260ms] ease-out motion-reduce:transition-none"
								style={{
									opacity: shown ? 1 : 0,
									// Staggered, not simultaneous. Both slides share one grid
									// cell, so a plain crossfade shows two headlines stacked on
									// top of each other for the whole transition — unreadable
									// with text, where it would have been fine with images.
									// The outgoing one clears first, then the incoming arrives.
									transitionDelay: shown ? `${FADE_MS}ms` : "0ms",
								}}
								aria-hidden={!shown}
								inert={!shown}
							>
								<p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-primary-foreground/70">
									{slide.eyebrow}
								</p>
								<h2 className="mt-2 text-balance text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
									{slide.headline}
								</h2>
								<Link
									to={slide.cta.to}
									search={slide.cta.search as never}
									className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-primary-foreground px-5 py-2.5 text-[13px] font-semibold text-primary transition-opacity hover:opacity-90"
								>
									{slide.cta.label}
									<ArrowRight className="h-3.5 w-3.5" />
								</Link>
							</div>
						);
					})}
				</div>

				<div
					className="relative hidden lg:block"
					style={{
						aspectRatio: `${active.clip.dimensions.w} / ${active.clip.dimensions.h}`,
					}}
				>
					<AnimatePresence initial={false}>
						<motion.div
							key={active.key}
							className="absolute inset-0"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							transition={{ duration: fade, ease: "easeInOut" }}
						>
							<ExplainerVideo
								src={active.clip.src}
								poster={active.clip.poster}
								steps={active.clip.steps}
								dimensions={active.clip.dimensions}
								stepsVisible={false}
								frameClassName="border-primary-foreground/25"
							/>
						</motion.div>
					</AnimatePresence>
				</div>
			</div>

			<div className="flex items-center gap-3 px-6 pb-5 pt-6 lg:px-8">
				<button
					type="button"
					onClick={() => {
						setUserSet(true);
						setPaused((p) => !p);
					}}
					aria-label={running ? "Pause" : "Play"}
					className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary-foreground/40 text-primary-foreground transition-colors hover:bg-primary-foreground/10"
				>
					{running ? (
						<Pause className="h-3 w-3 fill-current" />
					) : (
						<Play className="h-3 w-3 fill-current" />
					)}
				</button>

				{slides.map((item, i) => (
					<button
						key={item.key}
						type="button"
						onClick={() => go(i)}
						aria-label={`Slide ${i + 1} of ${slides.length}: ${item.eyebrow}`}
						aria-current={i === index}
						className="group h-4 min-w-0 flex-1 py-1.5"
					>
						<span className="block h-1 w-full overflow-hidden rounded-full bg-primary-foreground/30 group-hover:bg-primary-foreground/45">
							<span
								className="block h-full rounded-full bg-primary-foreground transition-[width] duration-100 ease-linear motion-reduce:transition-none"
								style={{
									width:
										i < index
											? "100%"
											: i === index
												? `${Math.min(100, (elapsed / SLIDE_MS) * 100)}%`
												: "0%",
								}}
							/>
						</span>
					</button>
				))}
			</div>
		</section>
	);
}
