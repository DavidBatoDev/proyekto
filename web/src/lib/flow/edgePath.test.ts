import { Position, getSimpleBezierPath as reactFlowPath } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { getSimpleBezierPath } from "./edgePath";
import type { HandlePosition } from "./types";

/**
 * Byte-identity of edge paths against the implementation being replaced.
 *
 * DELETE THIS FILE in the same commit that removes `@xyflow/react`. It is the
 * ONLY file under lib/flow/ permitted to import that package (importBoundary
 * .test.ts excludes test files for exactly this reason), and it only has value
 * while both implementations coexist.
 *
 * Strict string equality is the point. `toBeCloseTo` on parsed numbers would
 * pass while emitting a different `d` attribute, and "the curve is a bit off"
 * is precisely the class of regression this migration is most likely to ship.
 */

const POSITIONS: HandlePosition[] = ["left", "top", "right", "bottom"];

const TO_RF: Record<HandlePosition, Position> = {
	left: Position.Left,
	top: Position.Top,
	right: Position.Right,
	bottom: Position.Bottom,
};

/**
 * Deterministic pseudo-random coordinates — a seeded LCG rather than
 * Math.random, so a failure is always reproducible from the test name alone.
 */
function makeRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
}

describe("getSimpleBezierPath", () => {
	it("matches React Flow for every source/target position pair", () => {
		const random = makeRandom(20260816);

		for (const sourcePosition of POSITIONS) {
			for (const targetPosition of POSITIONS) {
				for (let i = 0; i < 25; i++) {
					const args = {
						sourceX: random() * 4000 - 2000,
						sourceY: random() * 4000 - 2000,
						targetX: random() * 4000 - 2000,
						targetY: random() * 4000 - 2000,
					};

					const ours = getSimpleBezierPath({
						...args,
						sourcePosition,
						targetPosition,
					});
					const theirs = reactFlowPath({
						...args,
						sourcePosition: TO_RF[sourcePosition],
						targetPosition: TO_RF[targetPosition],
					});

					expect(ours[0]).toBe(theirs[0]);
					expect(ours.slice(1)).toEqual(theirs.slice(1));
				}
			}
		}
	});

	it("matches on the real graph's two edge shapes", () => {
		// The only two shapes the roadmap actually produces:
		//   epic chain   bottom -> top
		//   epic/feature right  -> left   (the target handle is unnamed)
		const chain = {
			sourceX: 350,
			sourceY: 560,
			sourcePosition: "bottom" as const,
			targetX: 350,
			targetY: 700,
			targetPosition: "top" as const,
		};
		const feature = {
			sourceX: 600,
			sourceY: 450,
			sourcePosition: "right" as const,
			targetX: 750,
			targetY: 415,
			targetPosition: "left" as const,
		};

		for (const args of [chain, feature]) {
			expect(getSimpleBezierPath(args)[0]).toBe(
				reactFlowPath({
					...args,
					sourcePosition: TO_RF[args.sourcePosition],
					targetPosition: TO_RF[args.targetPosition],
				})[0],
			);
		}
	});

	it("matches on degenerate geometry", () => {
		const cases: Array<{
			sourceX: number;
			sourceY: number;
			targetX: number;
			targetY: number;
		}> = [
			// Coincident endpoints — a real case when a node has no size yet.
			{ sourceX: 0, sourceY: 0, targetX: 0, targetY: 0 },
			// Negative coordinates (the canvas pans into negative space).
			{ sourceX: -1200, sourceY: -880, targetX: -40, targetY: -3 },
			// Sub-pixel values, where float formatting differences would show up.
			{
				sourceX: 0.1,
				sourceY: 0.2,
				targetX: 0.30000000000000004,
				targetY: 1 / 3,
			},
			// Values large enough to hit exponential notation in String(n).
			{ sourceX: 1e21, sourceY: -1e21, targetX: 5e-7, targetY: 1e-7 },
		];

		for (const args of cases) {
			for (const sourcePosition of POSITIONS) {
				for (const targetPosition of POSITIONS) {
					expect(
						getSimpleBezierPath({ ...args, sourcePosition, targetPosition })[0],
					).toBe(
						reactFlowPath({
							...args,
							sourcePosition: TO_RF[sourcePosition],
							targetPosition: TO_RF[targetPosition],
						})[0],
					);
				}
			}
		}
	});

	it("defaults to bottom -> top, as React Flow does", () => {
		const args = { sourceX: 10, sourceY: 20, targetX: 90, targetY: 160 };
		expect(getSimpleBezierPath(args)[0]).toBe(reactFlowPath(args)[0]);
	});
});
