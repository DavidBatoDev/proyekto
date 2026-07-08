import { describe, expect, it } from "vitest";
import { type LayoutEvent, layoutDay } from "./layout";

function byId(boxes: ReturnType<typeof layoutDay>) {
	return Object.fromEntries(boxes.map((b) => [b.id, b]));
}

describe("layoutDay", () => {
	it("gives sequential (non-overlapping) events the full width", () => {
		const events: LayoutEvent[] = [
			{ id: "a", start: 0, end: 60 },
			{ id: "b", start: 120, end: 180 },
		];
		const boxes = byId(layoutDay(events));
		expect(boxes.a.columnCount).toBe(1);
		expect(boxes.a.widthPct).toBe(100);
		expect(boxes.a.leftPct).toBe(0);
		expect(boxes.b.columnCount).toBe(1);
		expect(boxes.b.topPct).toBeCloseTo((120 / 1440) * 100, 5);
		expect(boxes.b.heightPct).toBeCloseTo((60 / 1440) * 100, 5);
	});

	it("splits two fully-overlapping events into two half-width columns", () => {
		const boxes = byId(
			layoutDay([
				{ id: "a", start: 60, end: 120 },
				{ id: "b", start: 60, end: 120 },
			]),
		);
		expect(boxes.a.columnCount).toBe(2);
		expect(boxes.b.columnCount).toBe(2);
		expect(boxes.a.widthPct).toBe(50);
		const lefts = [boxes.a.leftPct, boxes.b.leftPct].sort((x, y) => x - y);
		expect(lefts).toEqual([0, 50]);
	});

	it("treats back-to-back events (a.end === b.start) as non-overlapping", () => {
		const boxes = byId(
			layoutDay([
				{ id: "a", start: 0, end: 60 },
				{ id: "b", start: 60, end: 120 },
			]),
		);
		expect(boxes.a.columnCount).toBe(1);
		expect(boxes.b.columnCount).toBe(1);
	});

	it("packs a staircase into a single 2-column cluster and reuses freed columns", () => {
		// A[0-60] & B[30-90] overlap; B & C[60-120] overlap; A & C only touch.
		// All three are transitively one cluster needing 2 columns; C reuses A's.
		const boxes = byId(
			layoutDay([
				{ id: "a", start: 0, end: 60 },
				{ id: "b", start: 30, end: 90 },
				{ id: "c", start: 60, end: 120 },
			]),
		);
		expect(boxes.a.columnCount).toBe(2);
		expect(boxes.b.columnCount).toBe(2);
		expect(boxes.c.columnCount).toBe(2);
		expect(boxes.a.columnIndex).toBe(0);
		expect(boxes.b.columnIndex).toBe(1);
		expect(boxes.c.columnIndex).toBe(0); // reuses A's freed column
	});

	it("handles a zero-length event without collapsing the layout", () => {
		const boxes = byId(
			layoutDay([
				{ id: "a", start: 120, end: 120 },
				{ id: "b", start: 300, end: 360 },
			]),
		);
		expect(boxes.a.heightPct).toBe(0);
		expect(boxes.a.topPct).toBeCloseTo((120 / 1440) * 100, 5);
		expect(boxes.a.columnCount).toBe(1); // does not overlap b
	});

	it("clamps events that spill past the day boundaries", () => {
		const boxes = byId(layoutDay([{ id: "overnight", start: -30, end: 1500 }]));
		expect(boxes.overnight.topPct).toBe(0);
		expect(boxes.overnight.heightPct).toBe(100);
	});

	it("honors a narrowed visible window", () => {
		const boxes = byId(
			layoutDay([{ id: "a", start: 540, end: 600 }], {
				dayStartMin: 480,
				dayEndMin: 1080,
			}),
		);
		// 9:00–10:00 within an 8:00–18:00 (600-min) window.
		expect(boxes.a.topPct).toBeCloseTo(((540 - 480) / 600) * 100, 5);
		expect(boxes.a.heightPct).toBeCloseTo((60 / 600) * 100, 5);
	});
});
