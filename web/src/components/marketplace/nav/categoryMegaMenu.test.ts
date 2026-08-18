import { describe, expect, it } from "vitest";
import {
	clampPanelLeft,
	columnize,
	MEGA_PANEL_MAX_WIDTH,
	MEGA_VIEWPORT_MARGIN,
	nextTriggerIndex,
	resolvePanelWidth,
} from "./categoryMegaMenu";

describe("resolvePanelWidth", () => {
	it("caps at the maximum on a wide viewport", () => {
		expect(resolvePanelWidth(1920)).toBe(MEGA_PANEL_MAX_WIDTH);
	});

	it("leaves a margin on both sides of a narrow viewport", () => {
		expect(resolvePanelWidth(320)).toBe(320 - MEGA_VIEWPORT_MARGIN * 2);
	});

	it("never returns a negative width", () => {
		expect(resolvePanelWidth(4)).toBe(0);
	});
});

describe("clampPanelLeft", () => {
	it("leaves a comfortably placed panel where it is", () => {
		expect(clampPanelLeft(300, 760, 1920)).toBe(300);
	});

	it("pulls a panel back inside the right edge", () => {
		expect(clampPanelLeft(1800, 760, 1920)).toBe(
			1920 - 760 - MEGA_VIEWPORT_MARGIN,
		);
	});

	it("clamps a negative left to the viewport margin", () => {
		expect(clampPanelLeft(-40, 760, 1920)).toBe(MEGA_VIEWPORT_MARGIN);
	});

	// When the panel cannot fit, the left margin has to win: overflowing right
	// keeps the first column visible, whereas clamping right would push the
	// start of the list off-screen.
	it("prefers the left margin when the panel is wider than the viewport", () => {
		expect(clampPanelLeft(0, 900, 400)).toBe(MEGA_VIEWPORT_MARGIN);
	});
});

describe("columnize", () => {
	it("splits evenly divisible items into equal columns", () => {
		expect(columnize([1, 2, 3, 4, 5, 6], 3)).toEqual([
			[1, 2],
			[3, 4],
			[5, 6],
		]);
	});

	it("keeps reading order down each column when uneven", () => {
		expect(columnize([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([
			[1, 2, 3],
			[4, 5, 6],
			[7],
		]);
	});

	it("returns fewer columns than asked when there are too few items", () => {
		expect(columnize([1, 2], 3)).toEqual([[1], [2]]);
	});

	it("returns nothing for an empty list", () => {
		expect(columnize([], 3)).toEqual([]);
	});
});

describe("nextTriggerIndex", () => {
	it("steps forward", () => {
		expect(nextTriggerIndex(0, 1, 4)).toBe(1);
	});

	it("wraps past the end", () => {
		expect(nextTriggerIndex(3, 1, 4)).toBe(0);
	});

	it("wraps before the start", () => {
		expect(nextTriggerIndex(0, -1, 4)).toBe(3);
	});

	it("stays put with no categories", () => {
		expect(nextTriggerIndex(0, 1, 0)).toBe(0);
	});
});
