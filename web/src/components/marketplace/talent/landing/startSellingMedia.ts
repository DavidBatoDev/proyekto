import { STOCK_PHOTO_BASE_URL } from "@/data/stockPhotoManifest";

/**
 * Photography for the Start selling page.
 *
 * Art-directed rather than picked by `pickStockPhotoUrl`. That helper chooses at
 * random from a themed pool, which is right for a roadmap thumbnail — every
 * roadmap wanting a different picture — and wrong here: a landing page that
 * reshuffles its hero on every load has no identity, and the crop of each slot
 * was chosen against one specific frame.
 *
 * Deliberately NOT gated on `featureFlags.stockPhotos`. That flag decides
 * whether roadmap create swaps its generated gradient for a photo, and its
 * warning — "do not enable until the objects are live on cdn.proyekto.tech" —
 * is satisfied: every path below was confirmed to return HTTP 200 image/jpeg.
 * Reusing the flag here would tie two unrelated rollouts together.
 *
 * Every frame in the pools is 1200x675 (16:9), so slots that need another shape
 * crop with `object-cover` rather than letterboxing.
 */
const photo = (path: string) => `${STOCK_PHOTO_BASE_URL}/${path}`;

export const STOCK_PHOTO_WIDTH = 1200;
export const STOCK_PHOTO_HEIGHT = 675;

export const START_SELLING_PHOTOS = {
	/** Warm, collaborative, faces visible — people you would want to work with. */
	hero: photo("stock/team-collaboration/02.jpg"),
	/** Heads-down work, for the card about controlling your own terms. */
	focus: photo("stock/team-collaboration/06.jpg"),
	/** A room of people, for the card about who is on the other side. */
	people: photo("stock/team-collaboration/07.jpg"),
	/** Darker tones, sits under a scrim in the closing band. */
	closing: photo("stock/team-collaboration/03.jpg"),
} as const;
