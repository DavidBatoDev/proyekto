import type { RoadmapNodeKind } from "@/components/roadmap/shared/NodeGlyph";

/**
 * One level of an Epic → Feature → Task trail, keeping its kind so the UI can
 * give it the roadmap's own glyph.
 *
 * Neutral on purpose. Deliverables, Change Requests and Decisions each link to
 * roadmap work through a different junction table with a different set of
 * allowed targets, but they all render the trail the same way. This type used to
 * live in `delivery/deliveryModel.ts`, which meant the other two surfaces
 * imported from the Deliverables model to describe their own links.
 */
export interface LinkSegment {
	kind: RoadmapNodeKind;
	title: string;
}

/**
 * Build a trail segment, dropping the level entirely when its title is missing.
 *
 * A parent is absent when the payload did not embed it upward — an older row, or
 * a target since deleted. Skipping the level beats rendering an empty glyph.
 */
export function trailSegment(
	kind: RoadmapNodeKind,
	title: string | undefined | null,
): LinkSegment[] {
	return title ? [{ kind, title }] : [];
}
