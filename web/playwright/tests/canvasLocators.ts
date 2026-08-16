import type { Locator, Page } from "@playwright/test";

/**
 * Canvas locators for the roadmap view.
 *
 * Every selector here is emitted by the canvas SHELL or by the epic/feature
 * widgets — never by the renderer. That separation is what let the entire suite
 * run unchanged against two different canvas engines while they coexisted, and
 * it is why swapping the engine cost no spec edits.
 *
 * Keep it that way: a spec that reaches for an engine-internal class name is a
 * spec that breaks the next time the canvas changes shape.
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
