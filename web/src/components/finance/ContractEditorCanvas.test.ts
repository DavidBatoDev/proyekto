import { describe, expect, it } from "vitest";
import { splitContractClauseBody } from "@/components/project/ContractDocumentPreview";
import {
	paginateContractBlocks,
	remapZoomCentre,
} from "./ContractEditorCanvas";

describe("paginateContractBlocks", () => {
	it("keeps ordered sections together when they fit", () => {
		expect(
			paginateContractBlocks(
				[
					{ id: "header", height: 120 },
					{ id: "parties", height: 180 },
					{ id: "terms", height: 260 },
				],
				600,
			),
		).toEqual([["header", "parties", "terms"]]);
	});

	it("moves the next whole section to a new page", () => {
		expect(
			paginateContractBlocks(
				[
					{ id: "header", height: 200 },
					{ id: "parties", height: 250 },
					{ id: "terms", height: 200 },
					{ id: "signatures", height: 120 },
				],
				500,
			),
		).toEqual([
			["header", "parties"],
			["terms", "signatures"],
		]);
	});

	it("places an oversized semantic block on its own page", () => {
		expect(
			paginateContractBlocks(
				[
					{ id: "header", height: 100 },
					{ id: "clause:long", height: 700 },
					{ id: "signatures", height: 100 },
				],
				500,
			),
		).toEqual([["header"], ["clause:long"], ["signatures"]]);
	});
});

describe("splitContractClauseBody", () => {
	it("keeps short legal text as one editable fragment", () => {
		expect(splitContractClauseBody("Short clause.", 100)).toEqual([
			{ text: "Short clause.", start: 0, end: 13 },
		]);
	});

	it("splits long text at a word boundary without losing content", () => {
		const body = Array.from({ length: 40 }, (_, index) => `word${index}`).join(
			" ",
		);
		const fragments = splitContractClauseBody(body, 80);
		expect(fragments.length).toBeGreaterThan(1);
		expect(fragments.map((fragment) => fragment.text).join("")).toBe(body);
	});
});

describe("remapZoomCentre", () => {
	// A4 at 100% and 50%, with the column's real chrome: py-10 -> 40px above the
	// first page, gap-7 -> 28px between pages.
	const base = {
		centreX: 0,
		padTop: 40,
		padLeft: 32,
		gap: 28,
		pageCount: 3,
	};
	const at100 = { ...base, oldPageHeight: 1123, newPageHeight: 1123, ratio: 1 };
	const halve = {
		...base,
		oldPageHeight: 1123,
		newPageHeight: 561.5,
		ratio: 0.5,
	};

	it("is identity when the zoom has not moved", () => {
		const centreY = 40 + 400;
		expect(remapZoomCentre({ ...at100, centreY }).centreY).toBeCloseTo(centreY);
	});

	it("keeps the same fraction of the same page under the centre", () => {
		// Halfway down page 1 (0-indexed) at 100%.
		const centreY = 40 + (1123 + 28) + 1123 / 2;

		const next = remapZoomCentre({ ...halve, centreY }).centreY;

		// Halfway down page 1 at 50%: padding, one page + gap, then half a page.
		expect(next).toBeCloseTo(40 + (561.5 + 28) + 561.5 / 2);
	});

	it("does not scale the padding or the inter-page gaps", () => {
		// The top edge of page 2 stays exactly padding + 2 * (page + gap) — if the
		// fixed chrome were scaled with the pages this would come out short.
		const centreY = 40 + 2 * (1123 + 28);

		expect(remapZoomCentre({ ...halve, centreY }).centreY).toBeCloseTo(
			40 + 2 * (561.5 + 28),
		);
	});

	it("beats a flat scrollTop * ratio, which drifts by the fixed chrome", () => {
		const centreY = 40 + 2 * (1123 + 28);

		const exact = remapZoomCentre({ ...halve, centreY }).centreY;
		const naive = centreY * 0.5;

		// Exactly the fixed chrome the naive version wrongly halves: half the top
		// padding (20) plus half of the two gaps above this point (28). The error
		// grows with every page and gap above the centre.
		expect(exact - naive).toBeCloseTo(20 + 28);
	});

	it("holds position inside a gap rather than stretching it", () => {
		// 10px into the gap after page 0.
		const centreY = 40 + 1123 + 10;

		expect(remapZoomCentre({ ...halve, centreY }).centreY).toBeCloseTo(
			40 + 561.5 + 10,
		);
	});

	it("clamps a centre past the last page to the end of the document", () => {
		const centreY = 40 + 99 * (1123 + 28);

		const next = remapZoomCentre({ ...halve, centreY }).centreY;

		// Mapped through page 2 — the last of three — and no further: padding, two
		// whole periods, then the last page and its trailing gap. Before the
		// withinPeriod clamp this extrapolated to page 99 and returned 112304.
		expect(next).toBeCloseTo(40 + 2 * (561.5 + 28) + 561.5 + 28);
	});

	it("scales x about the left padding, not about zero", () => {
		expect(
			remapZoomCentre({ ...halve, centreY: 40, centreX: 32 + 400 }).centreX,
		).toBeCloseTo(32 + 200);
	});

	it("returns the centre untouched when a page has no height yet", () => {
		const input = {
			...base,
			centreY: 500,
			centreX: 300,
			oldPageHeight: 0,
			newPageHeight: 0,
			ratio: 2,
		};

		expect(remapZoomCentre(input)).toEqual({ centreY: 500, centreX: 300 });
	});
});
