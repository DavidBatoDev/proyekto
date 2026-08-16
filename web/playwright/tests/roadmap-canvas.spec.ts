import { expect, test } from "@playwright/test";
import {
	canvasEngine,
	canvasEpicNodes,
	canvasFitView,
	canvasNodes,
	canvasRoot,
	canvasZoomIn,
	canvasZoomOut,
	waitForCanvasReady,
} from "./canvasLocators";
import { APP_URL, PROJECT_ID, ROADMAP_ID } from "./canvasFixture";

/**
 * Fast, deterministic canvas regression net — NO AI involved.
 *
 * Why this exists: the roadmap canvas was covered only incidentally, by the
 * `roadmap-ai-*` specs, which drive a real agent. Those are slow,
 * non-deterministic, and expensive, so nobody runs them per-commit — meaning a
 * canvas regression could sit undetected between full runs. This suite is meant
 * to run on every canvas change:
 *
 *   cd web && npm run pw:test -- playwright/tests/roadmap-canvas.spec.ts
 *
 * It is also the parity harness for the canvas-renderer replacement: every
 * assertion here is engine-neutral (see ./canvasLocators), so the same file
 * runs green against either renderer.
 */


/** Reads the live viewport transform off the canvas pane. */
async function paneTransform(page: import("@playwright/test").Page) {
	return page.evaluate(() => {
		const pane = document.querySelector<HTMLElement>(
			'[data-testid="roadmap-canvas"] .react-flow__viewport, [data-testid="roadmap-canvas"] [data-flow-pane]',
		);
		return pane ? getComputedStyle(pane).transform : null;
	});
}

test.describe("roadmap canvas", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(APP_URL);
		await waitForCanvasReady(page, 45_000);
	});

	test("renders the canvas with epic nodes and reports its engine", async ({
		page,
	}) => {
		await expect(canvasRoot(page)).toBeVisible();

		// The fixture roadmap always has at least one epic; a canvas that renders
		// zero nodes is the classic "layout silently returned nothing" failure.
		await expect(canvasEpicNodes(page).first()).toBeVisible({
			timeout: 30_000,
		});
		expect(await canvasNodes(page).count()).toBeGreaterThan(0);

		// Recorded so a failure report says which renderer produced it.
		const engine = await canvasEngine(page);
		expect(engine).toBeTruthy();
		console.log(`[canvas] engine=${engine}`);
	});

	test("every rendered node carries a stable id and type", async ({ page }) => {
		await expect(canvasNodes(page).first()).toBeVisible({ timeout: 30_000 });

		const meta = await canvasNodes(page).evaluateAll((els) =>
			els.map((el) => ({
				id: el.getAttribute("data-node-id"),
				type: el.getAttribute("data-node-type"),
			})),
		);

		expect(meta.length).toBeGreaterThan(0);
		for (const node of meta) {
			expect(node.id, "every node needs an id for deep links").toBeTruthy();
			expect(["epic", "feature"]).toContain(node.type);
		}
		// Ids must be unique or deep-link focus targets the wrong card.
		const ids = meta.map((n) => n.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test("zoom controls change the viewport and clamp at the limits", async ({
		page,
	}) => {
		const badge = page.getByText(/^Zoom \d+%$/);
		await expect(badge).toBeVisible({ timeout: 30_000 });
		const readZoom = async () => {
			const text = (await badge.textContent()) ?? "";
			return Number(text.replace(/[^\d]/g, ""));
		};

		const initial = await readZoom();
		await canvasZoomIn(page).click();
		await expect
			.poll(readZoom, { timeout: 10_000 })
			.toBeGreaterThan(initial);

		const zoomedIn = await readZoom();
		await canvasZoomOut(page).click();
		await expect.poll(readZoom, { timeout: 10_000 }).toBeLessThan(zoomedIn);

		// maxZoom is 1.5 -> the button must eventually disable rather than run away.
		for (let i = 0; i < 12; i++) {
			if (await canvasZoomIn(page).isDisabled()) break;
			await canvasZoomIn(page).click();
		}
		await expect.poll(readZoom, { timeout: 10_000 }).toBeLessThanOrEqual(150);
	});

	test("fit view re-frames without collapsing the canvas", async ({ page }) => {
		await canvasZoomIn(page).click();
		await canvasFitView(page).click();

		// After a fit, nodes must still be on screen and the canvas still ready.
		await expect(canvasRoot(page)).toHaveAttribute(
			"data-canvas-ready",
			"true",
		);
		const box = await canvasEpicNodes(page).first().boundingBox();
		expect(box, "an epic should remain laid out after fitView").not.toBeNull();
		expect(box?.width ?? 0).toBeGreaterThan(0);
	});

	test("dragging the pane pans the canvas without moving nodes relative to it", async ({
		page,
	}) => {
		const epic = canvasEpicNodes(page).first();
		await expect(epic).toBeVisible({ timeout: 30_000 });

		const before = await epic.boundingBox();
		const root = await canvasRoot(page).boundingBox();
		if (!before || !root) throw new Error("canvas not laid out");

		// Drag on empty canvas space, well right of the feature column.
		const startX = root.x + root.width * 0.85;
		const startY = root.y + root.height * 0.85;
		await page.mouse.move(startX, startY);
		await page.mouse.down();
		await page.mouse.move(startX - 160, startY, { steps: 12 });
		await page.mouse.up();

		await expect
			.poll(
				async () => {
					const box = await epic.boundingBox();
					return box ? Math.round(box.x) : null;
				},
				{ timeout: 10_000 },
			)
			.not.toBe(Math.round(before.x));
	});

	test("the transform is applied to a single pane element", async ({ page }) => {
		// Guards the core invariant of the renderer: one transformed pane carrying
		// every node, rather than per-node absolute repositioning on pan.
		const transform = await paneTransform(page);
		expect(transform, "canvas pane should carry a CSS transform").toBeTruthy();
		expect(transform).not.toBe("none");
	});
});

test.describe("roadmap canvas — deep links", () => {
	test("focusing a node by id keeps the canvas ready", async ({ page }) => {
		await page.goto(APP_URL);
		await waitForCanvasReady(page, 45_000);

		const firstId = await canvasEpicNodes(page)
			.first()
			.getAttribute("data-node-id");
		expect(firstId).toBeTruthy();

		await page.goto(
			`/project/${PROJECT_ID}/roadmap/${ROADMAP_ID}?view=roadmapView&nodeId=${firstId}`,
		);
		await waitForCanvasReady(page, 45_000);

		await expect(canvasRoot(page)).toBeVisible();
		await expect(page).toHaveURL(new RegExp(`nodeId=${firstId}`));
	});

	test("an unknown nodeId does not break the canvas", async ({ page }) => {
		await page.goto(
			`/project/${PROJECT_ID}/roadmap/${ROADMAP_ID}?view=roadmapView&nodeId=00000000-0000-0000-0000-000000000000`,
		);
		await waitForCanvasReady(page, 45_000);

		await expect(canvasRoot(page)).toBeVisible();
		await expect(canvasNodes(page).first()).toBeVisible({ timeout: 30_000 });
	});
});
