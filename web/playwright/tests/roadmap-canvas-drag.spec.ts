import { expect, test } from "@playwright/test";

import {
	canvasEpicNodes,
	canvasNodeById,
	canvasRoot,
	waitForCanvasReady,
} from "./canvasLocators";

/**
 * Drag-to-reorder, end to end.
 *
 * Before this file NOTHING tested dragging on either renderer: the perf spec
 * performs a drag but asserts nothing and deliberately aborts before
 * committing. So the reorder path — the canvas's single most destructive
 * interaction — shipped on trust.
 *
 * Written engine-neutrally (shell testids only), so the same file runs under
 * both `chromium-user` and `chromium-user-domsvg` and is the parity proof for
 * dragging.
 *
 * It MUTATES data, so it runs against DEDICATED fixture roadmaps — one PER
 * PROJECT. Both engine projects execute this file, Playwright runs them on
 * separate workers concurrently, and two workers reordering the same epics
 * corrupt each other: an earlier version of this spec shared the app roadmap
 * and did exactly that, leaving the fixture shuffled for every later run.
 * A roadmap each removes the race and keeps real project data untouched.
 *
 * The committed test still restores the original order afterwards, so repeated
 * runs start from the same place.
 */

const DRAG_PROJECT_ID = "22222222-3333-4444-8555-666666666666";
const DRAG_ROADMAPS: Record<string, string> = {
	"chromium-user": "22222222-3333-4444-8555-000000000001",
	"chromium-user-domsvg": "22222222-3333-4444-8555-000000000002",
};

function dragUrl(projectName: string): string {
	const roadmapId =
		DRAG_ROADMAPS[projectName] ?? DRAG_ROADMAPS["chromium-user"];
	return `/project/${DRAG_PROJECT_ID}/roadmap/${roadmapId}?view=roadmapView`;
}

/** Epic ids in current visual order, top to bottom. */
async function epicOrder(page: import("@playwright/test").Page) {
	const nodes = canvasEpicNodes(page);
	const count = await nodes.count();
	const rows: Array<{ id: string; y: number }> = [];
	for (let i = 0; i < count; i++) {
		const node = nodes.nth(i);
		const [id, box] = await Promise.all([
			node.getAttribute("data-node-id"),
			node.boundingBox(),
		]);
		if (id && box) rows.push({ id, y: box.y });
	}
	return rows.sort((a, b) => a.y - b.y).map((row) => row.id);
}

/**
 * Vertical distance that drops `moveId` clear of `targetId`.
 *
 * Insertion is decided by comparing centre-Y with a strict `<`, so landing
 * exactly on the target's centre sits on the tie-break boundary and may not
 * reorder at all. Overshoot past it, in whichever direction we are travelling.
 */
async function dropDistance(
	page: import("@playwright/test").Page,
	moveId: string,
	targetId: string,
) {
	const [moveBox, targetBox] = await Promise.all([
		canvasNodeById(page, moveId).boundingBox(),
		canvasNodeById(page, targetId).boundingBox(),
	]);
	if (!moveBox || !targetBox) throw new Error("canvas not laid out");

	const raw = targetBox.y + targetBox.height / 2 - (moveBox.y + moveBox.height / 2);
	return raw + (raw >= 0 ? 140 : -140);
}

/** Drags `nodeId` by a canvas-space offset, in steps so the engine sees moves. */
async function dragNode(
	page: import("@playwright/test").Page,
	nodeId: string,
	dy: number,
) {
	const node = canvasNodeById(page, nodeId);
	const box = await node.boundingBox();
	if (!box) throw new Error(`node ${nodeId} has no box`);

	// Grab near the top of the card, away from any interactive control.
	const startX = box.x + box.width / 2;
	const startY = box.y + 16;

	await page.mouse.move(startX, startY);
	await page.mouse.down();
	// The first small move crosses the drag threshold; the rest carry it.
	await page.mouse.move(startX, startY + 4);
	await page.mouse.move(startX, startY + dy, { steps: 16 });
	return async () => {
		await page.mouse.up();
	};
}

test.describe("roadmap canvas — drag to reorder", () => {
	test.beforeEach(async ({ page }, testInfo) => {
		await page.goto(dragUrl(testInfo.project.name));
		await waitForCanvasReady(page, 45_000);
	});

	test("dragging an epic downward previews a reorder and can be cancelled", async ({
		page,
	}) => {
		const before = await epicOrder(page);
		test.skip(before.length < 2, "needs at least two epics to reorder");

		const first = before[0];
		const release = await dragNode(
			page,
			first,
			await dropDistance(page, first, before[1]),
		);

		// Mid-drag the preview must already show the new order — this is the
		// reflow the user is steering by, and it is computed from live positions.
		await expect
			.poll(async () => (await epicOrder(page))[0], { timeout: 10_000 })
			.not.toBe(first);

		await release();

		// A real reorder raises a confirm modal rather than persisting silently.
		const modal = page.getByRole("button", { name: /^Cancel$/ });
		await expect(modal).toBeVisible({ timeout: 10_000 });
		await modal.click();

		// Cancelling must restore the original order exactly.
		await expect
			.poll(async () => (await epicOrder(page)).join(","), { timeout: 10_000 })
			.toBe(before.join(","));
	});

	test("confirming a drag persists the new order, then restores it", async ({
		page,
	}, testInfo) => {
		const before = await epicOrder(page);
		test.skip(before.length < 2, "needs at least two epics to reorder");

		const [first, second] = before;

		const reorder = async (moveId: string, targetId: string) => {
			const orderBefore = (await epicOrder(page)).join(",");
			const release = await dragNode(
				page,
				moveId,
				await dropDistance(page, moveId, targetId),
			);
			// Confirm the gesture actually took hold before releasing. Without this
			// a drag that silently failed to register shows up later as "the confirm
			// modal never appeared", which points at the wrong thing entirely.
			//
			// The invariant is "the order changed", not "the moved node left the
			// top" — this helper also runs in reverse to restore, where the moved
			// node becomes first rather than stops being first.
			await expect
				.poll(async () => (await epicOrder(page)).join(","), { timeout: 10_000 })
				.not.toBe(orderBefore);
			await release();

			// `exact` matters: the modal's close button is labelled "Close epic
			// reorder confirmation modal", which contains "Confirm" as a substring
			// and otherwise trips strict mode.
			const confirm = page.getByRole("button", {
				name: "Confirm",
				exact: true,
			});
			await expect(confirm).toBeVisible({ timeout: 10_000 });
			await confirm.click();
			await expect(confirm).toBeHidden({ timeout: 20_000 });
		};

		try {
			await reorder(first, second);

			// Reload to prove it reached the database rather than only the store.
			await page.reload();
			await waitForCanvasReady(page, 45_000);
			await expect
				.poll(async () => (await epicOrder(page))[0], { timeout: 15_000 })
				.toBe(second);
		} finally {
			// Restore, whatever happened above — a shuffled fixture would silently
			// change what every later run is testing.
			await page.goto(dragUrl(testInfo.project.name));
			await waitForCanvasReady(page, 45_000);
			const current = await epicOrder(page);
			if (current[0] !== first && current.includes(first)) {
				await reorder(first, current[0]);
			}
		}
	});

	test("a press inside a .nodrag region does not move the card", async ({
		page,
	}) => {
		const order = await epicOrder(page);
		test.skip(order.length === 0, "needs an epic");

		// `.nodrag` opts subtrees out of canvas dragging. Under React Flow this was
		// the library's behaviour; the in-house engine has to reproduce it, and a
		// regression here means task rows drag the whole card.
		const nodrag = canvasRoot(page).locator(".nodrag").first();
		const count = await nodrag.count();
		test.skip(count === 0, "no .nodrag region is currently rendered");

		const box = await nodrag.boundingBox();
		if (!box) throw new Error("nodrag region not laid out");

		const target = canvasNodeById(page, order[0]);
		const beforeBox = await target.boundingBox();

		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 120, {
			steps: 10,
		});
		await page.mouse.up();

		// The claim is "the card did not follow a 120px drag", not "nothing moved
		// at all" — a few pixels of reflow inside the scrollable task region is
		// expected. 20px is comfortably below any real follow while still failing
		// loudly if the card starts tracking the pointer.
		const afterBox = await target.boundingBox();
		expect(Math.abs((afterBox?.y ?? 0) - (beforeBox?.y ?? 0))).toBeLessThan(20);
		// And no confirm modal should have appeared.
		await expect(page.getByRole("button", { name: /^Cancel$/ })).toBeHidden();
	});
});
