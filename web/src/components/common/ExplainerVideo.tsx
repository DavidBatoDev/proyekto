/**
 * A looping motion-graphics explainer, with the two things a decorative video
 * on this codebase always needs.
 *
 * 1. The poster is a real layer, not just the `poster` attribute. It sits under
 *    the video permanently, so the panel is never an empty box — before the
 *    video paints, and for `prefers-reduced-motion` users, where the video is
 *    hidden outright. A gradient behind it would make this optional; an inset
 *    panel has nothing behind it.
 * 2. The beats are carried as visible text. The video is decorative to
 *    assistive tech (`aria-hidden`) and its own captions are baked pixels, so
 *    without `steps` that content reaches nobody using a screen reader.
 *    `stepsVisible={false}` drops them from the layout but keeps them in the
 *    accessibility tree, which is the only version of that trade worth having -
 *    deleting `steps` outright would leave the panel with no text at all.
 *
 * The clips are authored in `remotion/` (see `remotion/src/stories/`) and
 * rendered into `web/public/`. To refresh one, edit the composition, re-run the
 * render commands in remotion/README.md, and bump the `?v=` on the `src` — the
 * filenames are stable and served with a browser cache, so the version param is
 * what forces a refetch. This mirrors the convention `HeroSection.tsx` set for
 * `hero-highlight.mp4`.
 *
 * The clips sit on a self-contained navy ground that cannot follow the page
 * theme, so `rounded-2xl border border-border` on the frame is what makes them
 * read as a deliberate inset on dark themes. It is not decoration — see the
 * note in remotion/src/primitives/Stage.tsx.
 */
export function ExplainerVideo({
	src,
	poster,
	steps,
	className,
	frameClassName,
	dimensions = { w: 1920, h: 1080 },
	stepsVisible = true,
}: {
	/** Root-relative path, including the `?v=` cache-bust. */
	src: string;
	poster: string;
	/** The beats the clip shows, as the text alternative for the video. */
	steps: readonly string[];
	/** Wrapper sizing — the caller owns width and spacing. */
	className?: string;
	/** Border classes on the frame. Defaults to the neutral page border. */
	frameClassName?: string;
	/** The clip's native size. Sets the frame aspect, so a 4:3 clip is not cropped. */
	dimensions?: { w: number; h: number };
	/** False hides the beats visually; they stay available to screen readers. */
	stepsVisible?: boolean;
}) {
	return (
		<figure className={className}>
			<div
				className={`relative w-full overflow-hidden rounded-2xl border ${frameClassName ?? "border-border"}`}
				style={{ aspectRatio: `${dimensions.w} / ${dimensions.h}` }}
			>
				<img
					src={poster}
					alt=""
					aria-hidden="true"
					width={dimensions.w}
					height={dimensions.h}
					loading="lazy"
					decoding="async"
					className="absolute inset-0 h-full w-full object-cover"
				/>
				<video
					className="absolute inset-0 h-full w-full object-cover motion-reduce:hidden"
					autoPlay
					loop
					muted
					playsInline
					preload="metadata"
					poster={poster}
					aria-hidden="true"
					width={dimensions.w}
					height={dimensions.h}
				>
					<source src={src} type="video/mp4" />
				</video>
			</div>

			<figcaption
				className={
					stepsVisible
						? "mt-4 text-[13px] leading-relaxed text-muted-foreground"
						: "sr-only"
				}
			>
				{steps.map((step, index) => (
					<span key={step}>
						{index > 0 ? (
							<span
								aria-hidden="true"
								className="px-2 text-muted-foreground/45"
							>
								·
							</span>
						) : null}
						{step}
					</span>
				))}
			</figcaption>
		</figure>
	);
}
