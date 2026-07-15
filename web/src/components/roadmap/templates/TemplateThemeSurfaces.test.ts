import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const TEMPLATE_SURFACES = [
	"routes/roadmap-templates/index.tsx",
	"routes/roadmap-templates/$slug.tsx",
	"routes/consultant/templates.tsx",
	"routes/project/$projectId/roadmap/create.tsx",
	"components/root/TemplatesSection.tsx",
	"components/root/TemplateEntryCard.tsx",
	"components/home/RoadmapPreviewCard.tsx",
	"components/roadmap/templates/TemplateRoadmapFlow.tsx",
	"components/roadmap/templates/MarketplaceRoadmapPrompt.tsx",
];

const FIXED_LIGHT_NEUTRAL =
	/\b(?:bg-white(?:\/\d+)?|(?:bg|text|border)-(?:slate|gray)-(?:50|100|200|300|400|500|600|700|800|900|950)(?:\/\d+)?)\b/g;

describe("roadmap template theme surfaces", () => {
	it.each(TEMPLATE_SURFACES)(
		"uses semantic theme colors in %s",
		(relativePath) => {
			const source = readFileSync(
				resolve(process.cwd(), "src", relativePath),
				"utf8",
			);

			expect(source.match(FIXED_LIGHT_NEUTRAL) ?? []).toEqual([]);
		},
	);

	it("opens the standalone creation route directly in the roadmap builder", () => {
		const source = readFileSync(
			resolve(
				process.cwd(),
				"src/routes/project/$projectId/roadmap/create.tsx",
			),
			"utf8",
		);

		expect(source).toContain("<RoadmapBuilder");
		expect(source).not.toContain("Blank or AI-assisted");
		expect(source).not.toContain("Start from a template");
	});

	it("keeps the template usage card compact", () => {
		const source = readFileSync(
			resolve(process.cwd(), "src/routes/roadmap-templates/$slug.tsx"),
			"utf8",
		);

		expect(source).not.toContain("Rate after using");
		expect(source).not.toContain("Save rating");
		expect(source).not.toContain("Report template");
	});
});
