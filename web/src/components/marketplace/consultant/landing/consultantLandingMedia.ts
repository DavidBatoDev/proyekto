import { STOCK_PHOTO_BASE_URL } from "@/data/stockPhotoManifest";

/**
 * Photography for the consultant landing page.
 *
 * Art-directed, not random — same reasoning as startSellingMedia.ts: a landing
 * page that reshuffles its hero on every load has no identity, and each slot's
 * crop was chosen against one specific frame. Frames deliberately do not
 * overlap with the talent landing's picks (02/06/07/03), so the two
 * storefronts read as siblings, not clones.
 *
 * Every frame is 1200x675 (16:9); other shapes crop with `object-cover`.
 */
const photo = (path: string) => `${STOCK_PHOTO_BASE_URL}/${path}`;

export const STOCK_PHOTO_WIDTH = 1200;
export const STOCK_PHOTO_HEIGHT = 675;

export const CONSULTANT_LANDING_PHOTOS = {
	/** Someone leading a room — the person this page is recruiting. */
	hero: photo("stock/team-collaboration/01.jpg"),
	/** Client-facing conversation, for the card about the workspace they see. */
	workspace: photo("stock/team-collaboration/04.jpg"),
	/** A working team, for the card about the talent bench. */
	bench: photo("stock/team-collaboration/05.jpg"),
	/** Darker tones, sits under a scrim in the closing band. */
	closing: photo("stock/team-collaboration/08.jpg"),
} as const;
