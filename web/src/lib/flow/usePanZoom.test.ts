import { describe, expect, it } from "vitest";
import { regionClaimsWheel, type WheelDecision } from "./usePanZoom";

const down: WheelDecision = { kind: "pan", deltaX: 0, deltaY: 40 };
const up: WheelDecision = { kind: "pan", deltaX: 0, deltaY: -40 };
const sideways: WheelDecision = { kind: "pan", deltaX: 40, deltaY: 0 };
const zoom: WheelDecision = { kind: "zoom", deltaX: 0, deltaY: 40 };

const list = (scrollTop: number, scrollHeight = 500, clientHeight = 200) => ({
	scrollTop,
	scrollHeight,
	clientHeight,
});

describe("regionClaimsWheel", () => {
	it("leaves the wheel to the canvas outside any scroll region", () => {
		expect(regionClaimsWheel(null, down)).toBe(false);
	});

	it("leaves the wheel to the canvas when the list does not overflow", () => {
		expect(regionClaimsWheel(list(0, 200, 200), down)).toBe(false);
		expect(regionClaimsWheel(list(0, 200, 200), up)).toBe(false);
	});

	it("keeps the wheel while the list can scroll that way", () => {
		expect(regionClaimsWheel(list(0), down)).toBe(true);
		expect(regionClaimsWheel(list(150), up)).toBe(true);
	});

	it("hands the wheel back at the list's top and bottom", () => {
		expect(regionClaimsWheel(list(0), up)).toBe(false);
		expect(regionClaimsWheel(list(300), down)).toBe(false);
		// Fractional scrollTop on high-DPI screens still counts as the bottom.
		expect(regionClaimsWheel(list(299.5), down)).toBe(false);
	});

	it("never claims sideways or zoom wheels", () => {
		expect(regionClaimsWheel(list(150), sideways)).toBe(false);
		expect(regionClaimsWheel(list(150), zoom)).toBe(false);
	});
});
