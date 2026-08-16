import { describe, expect, it } from "vitest";
import {
	buildRoadmapNodeUrl,
	buildRoadmapPreviewUrl,
} from "./roadmapPreviewLink";

describe("roadmap preview links", () => {
	it("builds an encoded public preview URL", () => {
		expect(
			buildRoadmapPreviewUrl(
				"https://www.proyekto.tech/",
				"road map/1",
				"task/2",
			),
		).toBe("https://www.proyekto.tech/roadmap/preview/road%20map%2F1/task%2F2");
	});

	it("builds the authenticated destination URL", () => {
		expect(
			buildRoadmapNodeUrl(
				"https://www.proyekto.tech",
				"project/1",
				"roadmap/2",
				"feature/3",
			),
		).toBe(
			"https://www.proyekto.tech/project/project%2F1/roadmap/roadmap%2F2?nodeId=feature%2F3&view=roadmapView",
		);
	});
});
