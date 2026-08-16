import { describe, expect, it } from "vitest";
import { buildPreviewHtml } from "./worker";

describe("roadmap preview HTML", () => {
	it("contains escaped item metadata and social tags", () => {
		const html = buildPreviewHtml(
			{
				roadmapId: "roadmap-1",
				projectId: "project-1",
				roadmapName: "Q3 <Roadmap>",
				nodeId: "task-1",
				nodeType: "task",
				title: "Fix <onboarding>",
			},
			"https://www.proyekto.tech/roadmap/preview/roadmap-1/task-1",
			"https://www.proyekto.tech/project/project-1/roadmap/roadmap-1?nodeId=task-1&view=roadmapView",
		);

		expect(html).toContain('property="og:title"');
		expect(html).toContain("Fix &lt;onboarding&gt; · Task");
		expect(html).toContain("Q3 &lt;Roadmap&gt;");
		expect(html).not.toContain("Fix <onboarding>");
		expect(html).toContain("Opening Proyekto");
	});
});
