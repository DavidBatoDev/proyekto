import { StartSellingCtaButton } from "./StartSellingCtaButton";
import {
	START_SELLING_PHOTOS,
	STOCK_PHOTO_HEIGHT,
	STOCK_PHOTO_WIDTH,
} from "./startSellingMedia";

/**
 * The closing band: the same ask as the hero, at the point where someone has
 * read the requirements and is deciding.
 *
 * Permanently dark regardless of theme — the photo underneath is a fixed image,
 * so white text over a heavy scrim is correct in both light and dark rather
 * than something to invert.
 *
 * The ground is `bg-black` and NOT `bg-foreground`, which is what it was first.
 * `foreground` is near-black in light and near-white in dark, so the band that
 * looked right in light mode washed out to grey in dark and dropped the white
 * heading to poor contrast. A band that is deliberately the same in both themes
 * needs a colour that does not invert; the photo blends toward this ground at
 * 60% opacity, so it has to stay dark.
 */
export function StartSellingCta() {
	return (
		<section className="relative isolate mt-20 overflow-hidden bg-black lg:mt-24">
			<img
				src={START_SELLING_PHOTOS.closing}
				alt=""
				width={STOCK_PHOTO_WIDTH}
				height={STOCK_PHOTO_HEIGHT}
				loading="lazy"
				decoding="async"
				className="absolute inset-0 -z-10 h-full w-full object-cover opacity-60"
			/>
			<div aria-hidden="true" className="absolute inset-0 -z-10 bg-black/55" />

			<div className="mx-auto flex max-w-3xl flex-col items-center px-4 py-20 text-center sm:px-6 lg:py-24">
				<h2 className="text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
					Let's show clients what you've got to offer
				</h2>
				<p className="mt-4 max-w-xl text-[15px] leading-relaxed text-white/80">
					Listing is free. You keep control of your rate, your hours and which
					projects you say yes to.
				</p>
				<div className="mt-8">
					<StartSellingCtaButton tone="onPhoto" />
				</div>
			</div>
		</section>
	);
}
