import { describe, expect, it } from "vitest";
import {
	PINCH_STEP_IN,
	PINCH_STEP_OUT,
	resolvePinch,
	stepGranularity,
} from "./mobileZoom";

describe("stepGranularity", () => {
	it("zooms in toward finer scales", () => {
		expect(stepGranularity("year", 1)).toBe("month");
		expect(stepGranularity("month", 1)).toBe("week");
		expect(stepGranularity("week", 1)).toBe("day");
	});

	it("zooms out toward coarser scales", () => {
		expect(stepGranularity("day", -1)).toBe("week");
		expect(stepGranularity("week", -1)).toBe("month");
		expect(stepGranularity("month", -1)).toBe("year");
	});

	it("clamps at both ends rather than wrapping", () => {
		expect(stepGranularity("day", 1)).toBe("day");
		expect(stepGranularity("year", -1)).toBe("year");
	});
});

describe("resolvePinch", () => {
	it("holds the scale inside the dead zone", () => {
		for (const scale of [0.9, 1, 1.1, 1.3]) {
			expect(resolvePinch("month", scale)).toEqual({
				granularity: "month",
				consumed: 1,
			});
		}
	});

	it("steps finer once the inward threshold is crossed", () => {
		expect(resolvePinch("month", PINCH_STEP_IN)).toEqual({
			granularity: "week",
			consumed: PINCH_STEP_IN,
		});
	});

	it("steps coarser once the outward threshold is crossed", () => {
		expect(resolvePinch("month", PINCH_STEP_OUT)).toEqual({
			granularity: "year",
			consumed: PINCH_STEP_OUT,
		});
	});

	it("carries leftover travel into the next step", () => {
		// Two thresholds' worth of pinch steps once and leaves one threshold of
		// travel banked, so a continuous gesture keeps stepping.
		const accumulated = PINCH_STEP_IN * PINCH_STEP_IN;
		const { granularity, consumed } = resolvePinch("year", accumulated);
		expect(granularity).toBe("month");
		expect(accumulated / consumed).toBeCloseTo(PINCH_STEP_IN);
	});

	it("swallows the excess at the finest scale so it cannot wind up", () => {
		const { granularity, consumed } = resolvePinch("day", 12);
		expect(granularity).toBe("day");
		// consumed === accumulated, so the caller's accumulator resets to 1 and
		// the next outward pinch is felt immediately.
		expect(12 / consumed).toBe(1);
	});

	it("swallows the excess at the coarsest scale too", () => {
		const { granularity, consumed } = resolvePinch("year", 0.05);
		expect(granularity).toBe("year");
		expect(0.05 / consumed).toBe(1);
	});

	it("ignores degenerate scales", () => {
		for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(resolvePinch("week", scale)).toEqual({
				granularity: "week",
				consumed: 1,
			});
		}
	});
});
