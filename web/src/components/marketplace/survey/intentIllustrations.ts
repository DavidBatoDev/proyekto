import type { SurveyIntent } from "@/queries/marketplaceSurvey";

/**
 * Illustrations for the three marketplace intents, served from `web/public`.
 *
 * Filenames match the STORED intent value (`consultant`, not "solutions-lead"),
 * so this map needs no second translation table — the label lives in
 * `INTENT_LABELS` and nowhere else.
 *
 * The sources were 1254x1254 PNGs totalling 3.7 MB; they render at 96px, so
 * they are resized to 320 (2x, with room to spare) and stored as WebP, which
 * takes the set to 28 KB. Regenerate at the same size rather than dropping a
 * full-resolution export in here.
 */
export const INTENT_ILLUSTRATIONS: Record<SurveyIntent, string> = {
	client: "/images/survey/client.webp",
	consultant: "/images/survey/consultant.webp",
	talent: "/images/survey/talent.webp",
};

/** The intrinsic size of the stored files, set on the tag to avoid layout shift. */
export const INTENT_ILLUSTRATION_SIZE = 320;
