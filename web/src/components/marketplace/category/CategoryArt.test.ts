import { describe, expect, it } from "vitest";
import {
	CATEGORY_ART_PALETTE_COUNT,
	CATEGORY_ART_VARIANT_COUNT,
	selectCategoryArt,
} from "./CategoryArt";

const SLUGS = [
	"product-strategy",
	"software-engineering",
	"ai-and-data",
	"cloud-devops-security",
	"design-and-brand",
	"growth-and-marketing",
	"sales-and-revenue",
	"finance-and-fundraising",
	"operations-and-delivery",
	"people-and-organisation",
	"industry-practices",
];

describe("selectCategoryArt", () => {
	it("gives a slug the same colour wherever it is drawn", () => {
		// A category's tile has to stay recognisable between the grid, another
		// category's grid, and any future placement — so position must not move
		// the palette.
		for (const slug of SLUGS) {
			const first = selectCategoryArt(slug, 0).paletteIndex;
			expect(selectCategoryArt(slug, 7).paletteIndex).toBe(first);
			expect(selectCategoryArt(slug).paletteIndex).toBe(first);
		}
	});

	it("spreads scenes evenly down a grid", () => {
		// Hashing the slug for the scene too left four of eleven tiles drawing
		// the same one, which reads as a bug rather than as variety.
		const counts = new Map<number, number>();
		SLUGS.forEach((slug, index) => {
			const { variant } = selectCategoryArt(slug, index);
			counts.set(variant, (counts.get(variant) ?? 0) + 1);
		});
		const perVariant = [...counts.values()];
		expect(counts.size).toBe(CATEGORY_ART_VARIANT_COUNT);
		expect(
			Math.max(...perVariant) - Math.min(...perVariant),
		).toBeLessThanOrEqual(1);
	});

	it("stays inside the declared palette and scene counts", () => {
		for (const slug of [...SLUGS, "", "a", "an-unusually-long-category-slug"]) {
			const { paletteIndex, variant } = selectCategoryArt(slug);
			expect(paletteIndex).toBeGreaterThanOrEqual(0);
			expect(paletteIndex).toBeLessThan(CATEGORY_ART_PALETTE_COUNT);
			expect(variant).toBeGreaterThanOrEqual(0);
			expect(variant).toBeLessThan(CATEGORY_ART_VARIANT_COUNT);
		}
	});
});
