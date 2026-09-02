/**
 * The one place that knows the shape of a workspace-scoped URL.
 *
 * Organizational pages live at /w/<slug>/…; everything else keeps its bare
 * path. Every path matcher in the chrome runs `stripWorkspacePrefix` first so
 * it keeps working on both shapes, and every string-built link to an
 * organizational page goes through `toWorkspacePath` so there is exactly one
 * way to spell it.
 */

export const WORKSPACE_PREFIX = "/w";

const PREFIX_PATTERN = /^\/w\/([^/?#]+)(?=[/?#]|$)/;

/** "/w/acme/teams/x?y" -> "acme". Null when the path is not workspace-scoped. */
export function workspaceSlugFromPath(path: string): string | null {
	const match = path.match(PREFIX_PATTERN);
	if (!match) return null;
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return match[1];
	}
}

/**
 * "/w/acme/teams/x" -> "/teams/x"; "/w/acme" -> "/"; a path without the
 * prefix is returned unchanged. Query and hash ride along.
 */
export function stripWorkspacePrefix(path: string): string {
	const match = path.match(PREFIX_PATTERN);
	if (!match) return path;
	const rest = path.slice(match[0].length);
	if (rest === "") return "/";
	if (rest.startsWith("/")) return rest;
	// Only a query or hash followed the slug.
	return `/${rest}`;
}

function splitSuffix(path: string): { pathname: string; suffix: string } {
	const cut = path.search(/[?#]/);
	if (cut === -1) return { pathname: path, suffix: "" };
	return { pathname: path.slice(0, cut), suffix: path.slice(cut) };
}

function isUnder(pathname: string, root: string): boolean {
	return pathname === root || pathname.startsWith(`${root}/`);
}

/**
 * Bare organizational path -> slugged path. Rewrites only the three roots that
 * moved: /dashboard, /teams (but never /teams/me, which is personal), and
 * /workspace[/settings…] -> /settings… Anything else, an already-slugged
 * path, or a null slug comes back unchanged — the bare routes still exist as
 * redirects, so nothing breaks.
 */
export function toWorkspacePath(barePath: string, slug: string | null): string {
	if (!slug || barePath.startsWith(`${WORKSPACE_PREFIX}/`)) return barePath;
	const { pathname, suffix } = splitSuffix(barePath);
	const base = `${WORKSPACE_PREFIX}/${encodeURIComponent(slug)}`;

	if (isUnder(pathname, "/dashboard")) return `${base}${pathname}${suffix}`;

	if (isUnder(pathname, "/teams") && !isUnder(pathname, "/teams/me")) {
		return `${base}${pathname}${suffix}`;
	}

	if (pathname === "/workspace" || pathname === "/workspace/") {
		return `${base}/settings${suffix}`;
	}
	if (isUnder(pathname, "/workspace/settings")) {
		return `${base}${pathname.slice("/workspace".length)}${suffix}`;
	}

	return barePath;
}
