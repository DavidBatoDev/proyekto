import { StartSellingCtaButton } from "./StartSellingCtaButton";
import {
	START_SELLING_PHOTOS,
	STOCK_PHOTO_HEIGHT,
	STOCK_PHOTO_WIDTH,
} from "./startSellingMedia";

/**
 * The opening frame: a photograph, a claim, and one button.
 *
 * The photo is `eager` and carries its intrinsic dimensions — it is the largest
 * thing above the fold, and lazy-loading the one image someone is guaranteed to
 * see only buys a flash of empty space. The `bg-muted` under it is what a CDN
 * failure degrades to: a coloured block with legible text on top, rather than a
 * broken-image icon and white-on-white.
 *
 * The scrim is two stacked gradients rather than a flat overlay so the text side
 * stays dark enough to read while the right of the frame keeps its detail.
 */
export function StartSellingHero() {
	return (
		<section className="relative isolate overflow-hidden bg-muted">
			<img
				src={START_SELLING_PHOTOS.hero}
				alt=""
				width={STOCK_PHOTO_WIDTH}
				height={STOCK_PHOTO_HEIGHT}
				loading="eager"
				fetchPriority="high"
				decoding="async"
				className="absolute inset-0 -z-10 h-full w-full object-cover"
			/>
			<div
				aria-hidden="true"
				className="absolute inset-0 -z-10 bg-linear-to-r from-black/80 via-black/60 to-black/30"
			/>

			<div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-28 lg:px-10 lg:py-36">
				<div className="max-w-2xl">
					<p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-white/70">
						Sell your work on Proyekto
					</p>
					<h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">
						Get paid for the work you already do best
					</h1>
					<p className="mt-5 max-w-xl text-[15px] leading-relaxed text-white/85">
						Join the talent pool that Solutions Leads staff real projects from.
						Scoped work, signed terms, and delivery that gets accepted before it
						gets invoiced.
					</p>
					<div className="mt-8">
						<StartSellingCtaButton tone="onPhoto" />
					</div>
					<p className="mt-4 text-[13px] text-white/70">
						Free to list. You set your rate and your hours.
					</p>
				</div>
			</div>
		</section>
	);
}
