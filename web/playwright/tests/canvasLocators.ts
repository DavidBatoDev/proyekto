import type { Locator, Page } from "@playwright/test";

/**
 * Canvas locators for the roadmap view.
 *
 * These exist so the e2e suite stops reaching into React Flow's internal class
 * names (`.react-flow`, `.react-flow__node`, `.react-flow__controls-*`). Those
 * are implementation details of a dependency we are replacing; every spec that
 * hard-codes one is a spec that breaks on the renderer swap for no good reason.
 *
 * The `data-testid`s below are emitted by the canvas shell and the epic/feature
 * widgets, not by the renderer, so they are identical under either engine.
 *
 * Note on `.or()` fallbacks: deliberately not used. During the migration BOTH the
 * shell's `[data-testid="roadmap-canvas"]` and React Flow's `.react-flow` element
 * are present — they are different nodes — so an `.or()` chain would resolve to
 * two elements and trip Playwright's strict mode. The app change and this change
 * land together, so a revert reverts both.
 */

/** The canvas shell. Also the surface to drag against for pan gestures. */
export const canvasRoot = (page: Page): Locator =>
	page.locator('[data-testid="roadmap-canvas"]');

/** Every rendered epic/feature card. */
export const canvasNodes = (page: Page): Locator =>
	page.locator('[data-testid="roadmap-canvas-node"]');

export const canvasEpicNodes = (page: Page): Locator =>
	page.locator('[data-testid="roadmap-canvas-node"][data-node-type="epic"]');

export const canvasFeatureNodes = (page: Page): Locator =>
	page.locator('[data-testid="roadmap-canvas-node"][data-node-type="feature"]');

export const canvasNodeById = (page: Page, nodeId: string): Locator =>
	page.locator(`[data-testid="roadmap-canvas-node"][data-node-id="${nodeId}"]`);

export const canvasZoomIn = (page: Page): Locator =>
	page.locator('[data-testid="roadmap-canvas-zoom-in"]');

export const canvasZoomOut = (page: Page): Locator =>
	page.locator('[data-testid="roadmap-canvas-zoom-out"]');

export const canvasFitView = (page: Page): Locator =>
	page.locator('[data-testid="roadmap-canvas-fit-view"]');

/**
 * Waits until the canvas has committed its first layout. Strictly better than
 * waiting on a node to appear: `data-canvas-ready` is the same signal the shell
 * uses to fade the canvas in, so there is no window where nodes exist but are
 * still invisible.
 */
export async function waitForCanvasReady(
	page: Page,
	timeout = 30_000,
): Promise<void> {
	await canvasRoot(page).waitFor({ state: "visible", timeout });
	await page
		.locator('[data-testid="roadmap-canvas"][data-canvas-ready="true"]')
		.waitFor({ state: "attached", timeout });
}

/** Which engine actually rendered — useful when a failure is engine-specific. */
export async function canvasEngine(page: Page): Promise<string | null> {
	return canvasRoot(page).getAttribute("data-canvas-engine");
}
