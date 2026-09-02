/**
 * Shape rules for a workspace URL handle, mirrored from the backend
 * (`WORKSPACE_SLUG_PATTERN` in workspaces.dto.ts) and the database CHECK.
 * Shape only: whether a handle is reserved or taken is the server's answer,
 * returned as a 409. Change these in lockstep with the backend.
 */

export const WORKSPACE_SLUG_MIN_LENGTH = 3;
export const WORKSPACE_SLUG_MAX_LENGTH = 60;
export const WORKSPACE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const UUID_SHAPE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * What the database's slugify does, for a live preview as the owner types:
 * apostrophes dropped (so "Teleg's" reads "telegs"), accents folded, lowercased,
 * runs of anything else collapsed to single hyphens, trimmed, capped.
 */
export function normalizeWorkspaceSlug(input: string): string {
	return input
		.replace(/['’]/g, "")
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, WORKSPACE_SLUG_MAX_LENGTH)
		.replace(/-+$/g, "");
}

export function isValidWorkspaceSlug(slug: string): boolean {
	return (
		slug.length >= WORKSPACE_SLUG_MIN_LENGTH &&
		slug.length <= WORKSPACE_SLUG_MAX_LENGTH &&
		WORKSPACE_SLUG_PATTERN.test(slug) &&
		!UUID_SHAPE.test(slug)
	);
}
