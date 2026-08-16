import { expect, test } from "@playwright/test";
import { canvasNodes, canvasRoot, waitForCanvasReady } from "./canvasLocators";

/**
 * Perf baseline for the canvas renderer swap.
 *
 * "At parity" has to be a measured claim, not an opinion, so this records the
 * numbers the CURRENT renderer produces on a deliberately large roadmap. Run it
 * against React Flow first, keep the output, then run it against the new engine
 * and compare. It asserts almost nothing — it is an instrument, not a gate.
 *
 *   PW_PERF_PROJECT_ID=… PW_PERF_ROADMAP_ID=… \
 *     npx playwright test playwright/tests/canvas-perf-baseline.spec.ts
 *
 * Frame rate is derived from requestAnimationFrame timestamps while a gesture
 * is driven, which measures what the user actually perceives (the browser's
 * ability to produce frames) rather than how long our JS took.
 */

const PERF_PROJECT_ID =
	process.env.PW_PERF_PROJECT_ID ?? "11111111-2222-4333-8444-555555555555";
const PERF_ROADMAP_ID =
	process.env.PW_PERF_ROADMAP_ID ?? "11111111-2222-4333-8444-666666666666";
const PERF_URL = `/project/${PERF_PROJECT_ID}/roadmap/${PERF_ROADMAP_ID}?view=roadmapView`;

/** Counts real animation frames over `ms`, returning fps and the worst frame. */
async function measureFrames(
	page: import("@playwright/test").Page,
	ms: number,
): Promise<{ fps: number; worstFrameMs: number }> {
	return page.evaluate((duration) => {
		return new Promise<{ fps: number; worstFrameMs: number }>((resolve) => {
			const gaps: number[] = [];
			let last = performance.now();
			const started = last;
			const tick = (now: number) => {
				gaps.push(now - last);
				last = now;
				if (now - started >= duration) {
					const worst = gaps.reduce((a, b) => Math.max(a, b), 0);
					resolve({
						fps: Math.round((gaps.length / (now - started)) * 1000),
						worstFrameMs: Math.round(worst * 100) / 100,
					});
					return;
				}
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
	}, ms);
}

test("canvas perf baseline on a large roadmap", async ({ page }) => {
	test.setTimeout(180_000);

	// ── time to ready ───────────────────────────────────────────────────────
	const startedAt = Date.now();
	await page.goto(PERF_URL);
	await waitForCanvasReady(page, 90_000);
	const timeToReadyMs = Date.now() - startedAt;

	const engine = await canvasRoot(page).getAttribute("data-canvas-engine");
	const nodeCount = await canvasNodes(page).count();
	const domNodes = await page.evaluate(
		() => document.querySelectorAll("*").length,
	);

	// ── idle ────────────────────────────────────────────────────────────────
	const idle = await measureFrames(page, 1000);

	// ── pan ─────────────────────────────────────────────────────────────────
	const box = await canvasRoot(page).boundingBox();
	if (!box) throw new Error("canvas has no bounding box");
	const midX = box.x + box.width / 2;
	const midY = box.y + box.height / 2;

	await page.mouse.move(midX, midY);
	await page.mouse.down();
	const panMeasurement = measureFrames(page, 2000);
	for (let i = 0; i < 40; i++) {
		await page.mouse.move(midX - i * 6, midY - i * 3);
	}
	const pan = await panMeasurement;
	await page.mouse.up();

	// ── node drag (the reorder gesture) ─────────────────────────────────────
	const firstNode = canvasNodes(page).first();
	const nodeBox = await firstNode.boundingBox();
	let drag = { fps: 0, worstFrameMs: 0 };
	if (nodeBox) {
		await page.mouse.move(
			nodeBox.x + nodeBox.width / 2,
			nodeBox.y + Math.min(20, nodeBox.height / 2),
		);
		await page.mouse.down();
		const dragMeasurement = measureFrames(page, 2000);
		for (let i = 0; i < 40; i++) {
			await page.mouse.move(
				nodeBox.x + nodeBox.width / 2,
				nodeBox.y + Math.min(20, nodeBox.height / 2) + i * 8,
			);
		}
		drag = await dragMeasurement;
		// Release off-target so no reorder is committed — this is a measurement,
		// not a mutation.
		await page.keyboard.press("Escape");
		await page.mouse.up();
	}

	// ── memory after pan cycles ─────────────────────────────────────────────
	const heapMb = await page.evaluate(() => {
		const mem = (
			performance as unknown as { memory?: { usedJSHeapSize: number } }
		).memory;
		return mem ? Math.round((mem.usedJSHeapSize / 1024 / 1024) * 10) / 10 : null;
	});

	console.log(
		`\n[canvas-perf] ${JSON.stringify(
			{
				engine,
				epicsExpected: 60,
				renderedNodes: nodeCount,
				domNodes,
				timeToReadyMs,
				idleFps: idle.fps,
				panFps: pan.fps,
				panWorstFrameMs: pan.worstFrameMs,
				dragFps: drag.fps,
				dragWorstFrameMs: drag.worstFrameMs,
				heapMb,
			},
			null,
			2,
		)}\n`,
	);

	// Only a smoke assertion: the point of this spec is the numbers above.
	expect(nodeCount).toBeGreaterThan(0);
});
