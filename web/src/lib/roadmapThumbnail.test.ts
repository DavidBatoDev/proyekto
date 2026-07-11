import { describe, expect, it } from "vitest";
import {
	generateRoadmapThumbnailDataUri,
	isGeneratedRoadmapThumbnailDataUri,
} from "./roadmapThumbnail";

describe("roadmap thumbnails", () => {
	it("recognizes generated placeholders as non-custom thumbnails", () => {
		const generated = generateRoadmapThumbnailDataUri(
			"roadmap-1",
			"PartsPortal",
		);

		expect(isGeneratedRoadmapThumbnailDataUri(generated)).toBe(true);
	});

	it("preserves uploaded image URLs", () => {
		expect(
			isGeneratedRoadmapThumbnailDataUri(
				"https://images.example.com/roadmap.jpg",
			),
		).toBe(false);
		expect(isGeneratedRoadmapThumbnailDataUri(" ")).toBe(false);
	});
});
