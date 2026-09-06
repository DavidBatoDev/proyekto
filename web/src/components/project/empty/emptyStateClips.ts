/**
 * The four project empty-state clips.
 *
 * Authored in `remotion/src/stories/*EmptyStory.tsx` and rendered into
 * `web/public/`. Filenames are stable and served with a browser cache, so the
 * `?v=` is what forces a refetch after a re-render — bump it whenever the
 * composition changes. This is the convention `HeroSection.tsx` set for
 * `hero-highlight.mp4`.
 *
 * `steps` is the video's text alternative, not a caption of convenience: the
 * clip is `aria-hidden` and its own captions are baked pixels, so these lines
 * are the only version a screen reader ever gets. They must stay in sync with
 * the `CAPTIONS` array in the matching composition.
 */

export type EmptyStateClip = {
	src: string;
	poster: string;
	steps: readonly string[];
};

export const ROADMAP_EMPTY_CLIP: EmptyStateClip = {
	src: "/roadmap-empty.mp4?v=1",
	poster: "/roadmap-empty-poster.webp",
	steps: [
		"One canvas for the whole plan",
		"Milestones, then the epics under them",
		"Features and tasks hang off each epic",
		"Assign the work and it flows everywhere",
	],
};

export const BOARD_EMPTY_CLIP: EmptyStateClip = {
	src: "/board-empty.mp4?v=1",
	poster: "/board-empty-poster.webp",
	steps: [
		"Every task, in the column it's in",
		"Give it an owner and a due date",
		"Drag it forward as the work lands",
		"Progress rolls straight up the roadmap",
	],
};

export const TIMELINE_EMPTY_CLIP: EmptyStateClip = {
	src: "/timeline-empty.mp4?v=1",
	poster: "/timeline-empty-poster.webp",
	steps: [
		"The same plan, laid out in weeks",
		"Give each epic a start and an end",
		"Wire up what has to wait for what",
		"See what's late before it's a surprise",
	],
};

export const DELIVERABLES_EMPTY_CLIP: EmptyStateClip = {
	src: "/deliverable-empty.mp4?v=1",
	poster: "/deliverable-empty-poster.webp",
	steps: [
		"Name what the project hands over",
		"Attach the roadmap work behind it",
		"Send it to the people who sign off",
		"Acceptance, recorded and attributed",
	],
};
