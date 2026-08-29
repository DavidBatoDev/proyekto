/**
 * The shared clock for both stories.
 *
 * `DURATION = 330` means the last rendered frame is **329**, and a looping
 * `<video>` cuts from 329 straight back to 0. So both stories hold their first
 * and last `SEAM_HOLD` frames pixel-identical: the loop point becomes a cut
 * between two matching stills, which is invisible, and it hands x264 twelve
 * free duplicate frames.
 *
 * Beats overlap by 6 frames so one scene's exit crossfades into the next
 * scene's entrance rather than cutting.
 */
export const FPS = 30;
export const DURATION = 330;

export const STAGE = { w: 1920, h: 1080 } as const;

/**
 * The marketplace hero clip is not 16:9. It fills the 30% column of a 70/30
 * band, where a 16:9 strip would be a letterbox slot two hundred pixels tall.
 * 4:3 keeps the tile close to the height of the copy beside it.
 */
export const HERO_STAGE = { w: 1200, h: 900 } as const;

/** The frames held identical at both ends of the loop. */
export const SEAM_HOLD = 6;

export const BEATS = [
	{ from: 0, duration: 90 },
	{ from: 84, duration: 84 },
	{ from: 162, duration: 90 },
	{ from: 246, duration: 84 },
] as const;

/**
 * The dot grid drifts one 48px cell every 66 frames — exactly 5 whole cycles
 * in 330 frames, so it wraps precisely at the seam. Any ambient loop in this
 * project must divide DURATION for the same reason.
 */
export const GRID_PERIOD = 66;
export const GRID_CELL = 48;

/**
 * The frame each poster is pulled from: a settled one with the closing caption
 * fully on, so a single image carries the whole story.
 *
 * Rendered via `remotion still <Story> --frame=<n>` rather than a `<Still>`
 * composition — inside a one-frame Still, `<Freeze>` is clamped to that frame
 * and the story renders at frame 0.
 */
export const POSTER_FRAME = {
	talent: 300,
	consultant: 302,
	mcp: 270,
	hero: 268,
} as const;
