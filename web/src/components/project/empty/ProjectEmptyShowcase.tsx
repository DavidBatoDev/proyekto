import type { ReactNode } from "react";
import { ExplainerVideo } from "@/components/common/ExplainerVideo";

/**
 * The two-column empty state the roadmap, board, timeline and deliverables
 * pages share when they have nothing to show.
 *
 * There is no card. A bordered box around an empty state is a container for
 * content that is not there — it draws a frame and then apologises for what is
 * inside it. These pages get the full width instead: a looping clip on the
 * left showing what the surface DOES, and on the right the still it ends on,
 * the reason to care, and the one action that starts it.
 *
 * Each page passes its own clip, its own illustration and its own copy — the
 * four surfaces are four different jobs, and one shared "no roadmap linked"
 * screen was the reason they never explained any of them.
 *
 * The clip is the same `ExplainerVideo` the marketing pages use, which is why
 * `steps` is required here too: the video is `aria-hidden` and its captions
 * are baked pixels, so `steps` is the only version of that content a screen
 * reader receives. It must stay in sync with the captions in the composition
 * (`remotion/src/stories/*EmptyStory.tsx`).
 */
export function ProjectEmptyShowcase({
	eyebrow,
	title,
	description,
	clip,
	illustration,
	points,
	primaryAction,
	secondaryAction,
}: {
	/** The surface this page is, in one word. */
	eyebrow: string;
	title: string;
	description: string;
	/** The Remotion clip: root-relative src with its `?v=`, poster, and beats. */
	clip: { src: string; poster: string; steps: readonly string[] };
	/** The still that shows what the surface looks like with data on it. */
	illustration: ReactNode;
	/** Three short lines on what this surface gives you. */
	points: readonly string[];
	primaryAction: ReactNode;
	secondaryAction?: ReactNode;
}) {
	return (
		<div className="app-shell-bg h-full w-full overflow-y-auto">
			<div className="mx-auto w-full max-w-6xl px-5 py-8 md:px-8 md:py-12">
				<div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
					{/* Left: what the surface does, as a loop. `stepsVisible={false}`
					    keeps the beats in the accessibility tree without repeating,
					    in small grey text, the captions already burned into the clip. */}
					<ExplainerVideo
						src={clip.src}
						poster={clip.poster}
						steps={clip.steps}
						stepsVisible={false}
						className="w-full"
					/>

					{/* Right: what it looks like full, and how to get there. */}
					<div className="flex flex-col">
						<div className="mb-7 w-full max-w-md self-center lg:self-start">
							{illustration}
						</div>

						<p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
							{eyebrow}
						</p>
						<h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
							{title}
						</h1>
						<p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
							{description}
						</p>

						<ul className="mt-5 flex flex-col gap-2">
							{points.map((point) => (
								<li
									key={point}
									className="flex items-start gap-2.5 text-sm text-muted-foreground"
								>
									<span
										aria-hidden="true"
										className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
									/>
									{point}
								</li>
							))}
						</ul>

						<div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
							{primaryAction}
							{secondaryAction}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
