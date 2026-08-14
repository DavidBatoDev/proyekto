import { featureFlags, type RoadmapCanvasEngine } from "@/config/featureFlags";

/**
 * Resolves which engine renders the roadmap canvas.
 *
 * `featureFlags.roadmapCanvasEngine` is a BUILD-time value — Vite inlines
 * `import.meta.env` — so on its own it gives no way to flip an individual
 * session. This module adds the override layer that makes the flag usable as a
 * real kill switch:
 *
 *   1. `?canvas=react-flow|dom-svg` in the URL (also persisted, see below)
 *   2. `localStorage["roadmap.canvasEngine"]`
 *   3. a per-surface override constant (used during the staged ramp)
 *   4. the build-time flag
 *
 * ## Why the URL is read from `window.location.search` directly
 *
 * All three canvas routes run their search params through TanStack Router's
 * `validateSearch`, which returns a fresh object containing only the keys it
 * knows about — so `canvas` is dropped the moment the router normalises the URL,
 * and `RoadmapViewContent` fires a view-sync `navigate()` shortly after mount
 * that triggers exactly that. Reading at module init happens before any of it,
 * and the localStorage write makes the choice survive the strip and every
 * subsequent navigation. No route changes required.
 *
 * ## Resolved once, on purpose
 *
 * The engine must not change mid-session: swapping it would remount the canvas,
 * drop any in-flight drag, and desync collaboration. Hence a module constant
 * rather than a hook.
 */

const STORAGE_KEY = "roadmap.canvasEngine";

/** Canvas surfaces, which ramp independently (see the migration plan). */
export type CanvasSurface = "app" | "share" | "template";

/**
 * Per-surface overrides for the staged ramp — e.g. put "template" on the new
 * engine while the app route stays on React Flow. Empty until the ramp starts.
 */
const SURFACE_OVERRIDES: Partial<Record<CanvasSurface, RoadmapCanvasEngine>> =
	{};

/**
 * Only ever trust a value that is still a member of the union.
 *
 * This is the guard against a specific footgun: anyone who used
 * `?canvas=react-flow` has that string pinned in localStorage indefinitely.
 * When React Flow is eventually deleted, an unvalidated read would resolve to a
 * renderer that no longer exists and the canvas would render nothing. Unknown
 * values are ignored, so a stale pin degrades to the current default.
 */
function asEngine(
	value: string | null | undefined,
): RoadmapCanvasEngine | null {
	return value === "react-flow" || value === "dom-svg" ? value : null;
}

function readUrlOverride(): RoadmapCanvasEngine | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = new URLSearchParams(window.location.search).get("canvas");
		return asEngine(raw);
	} catch {
		return null;
	}
}

function readStoredOverride(): RoadmapCanvasEngine | null {
	if (typeof window === "undefined") return null;
	try {
		return asEngine(window.localStorage.getItem(STORAGE_KEY));
	} catch {
		// Storage can be disabled (private mode, embedded webview). Not fatal.
		return null;
	}
}

function persistOverride(engine: RoadmapCanvasEngine): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(STORAGE_KEY, engine);
	} catch {
		// Best-effort: the URL param still applies for this page load.
	}
}

/** Where the active engine came from. Surfaced in the dev HUD and diagnostics. */
export type CanvasEngineSource = "url" | "storage" | "surface" | "env";

export interface ResolvedCanvasEngine {
	engine: RoadmapCanvasEngine;
	source: CanvasEngineSource;
}

/** Exported for tests; production code should use `resolveCanvasEngine`. */
export function resolveCanvasEngineFrom(input: {
	url: RoadmapCanvasEngine | null;
	stored: RoadmapCanvasEngine | null;
	surface: RoadmapCanvasEngine | null;
	env: RoadmapCanvasEngine;
}): ResolvedCanvasEngine {
	if (input.url) return { engine: input.url, source: "url" };
	if (input.stored) return { engine: input.stored, source: "storage" };
	if (input.surface) return { engine: input.surface, source: "surface" };
	return { engine: input.env, source: "env" };
}

// Resolved at module load, before the router can normalise the URL away.
const urlOverride = readUrlOverride();
if (urlOverride) persistOverride(urlOverride);

const RESOLVED_BASE = {
	url: urlOverride,
	stored: readStoredOverride(),
	env: featureFlags.roadmapCanvasEngine,
} as const;

/**
 * The engine for a given surface. Stable for the lifetime of the page.
 *
 * A URL or stored override deliberately wins over the per-surface constant, so
 * support can hand an affected user `?canvas=react-flow` on any surface —
 * including the public share link — without a deploy.
 */
export function resolveCanvasEngine(
	surface: CanvasSurface = "app",
): RoadmapCanvasEngine {
	return resolveCanvasEngineFrom({
		...RESOLVED_BASE,
		surface: SURFACE_OVERRIDES[surface] ?? null,
	}).engine;
}

/** Same, with provenance — for the dev HUD and failure reports. */
export function describeCanvasEngine(
	surface: CanvasSurface = "app",
): ResolvedCanvasEngine {
	return resolveCanvasEngineFrom({
		...RESOLVED_BASE,
		surface: SURFACE_OVERRIDES[surface] ?? null,
	});
}
