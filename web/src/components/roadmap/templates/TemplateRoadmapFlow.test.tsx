/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoadmapTemplateVersionContent } from "@/types/roadmap-template";
import {
	buildTemplateRoadmapPreview,
	TemplateRoadmapFlow,
} from "./TemplateRoadmapFlow";

let roadmapViewProps: Record<string, unknown> | null = null;

vi.mock("../views/roadmap/RoadmapView", () => ({
	RoadmapView: (props: Record<string, unknown>) => {
		roadmapViewProps = props;
		return <div data-testid="roadmap-view" />;
	},
}));

const content: RoadmapTemplateVersionContent = {
	contract_version: 1,
	schedule_kind: "long_term",
	roadmap: {
		name: "Launch roadmap",
		description: "A reusable launch plan",
		schedule_kind: "long_term",
		start_day_offset: 0,
		end_day_offset: 30,
	},
	milestones: [],
	epics: [
		{
			key: "epic-foundation",
			title: "Foundation",
			time_label: "(Month 1)",
			description: "Establish the product foundation.",
			start_day_offset: 0,
			end_day_offset: 29,
			priority: "high",
			tags: ["strategy"],
			features: [
				{
					key: "feature-plan",
					title: "Plan",
					time_label: "(Week 1)",
					description: "Define the delivery plan.",
					start_day_offset: 0,
					end_day_offset: 6,
					is_deliverable: true,
					tasks: [
						{
							key: "task-scope",
							title: "Write the scope",
							description: "Document the agreed product scope.",
							priority: "urgent",
							position: 1,
							work_type: "real_work",
							due_day_offset: 3,
							checklist: [
								{ id: "item-1", title: "Review scope", completed: false },
							],
						},
					],
				},
			],
		},
	],
};

describe("TemplateRoadmapFlow", () => {
	afterEach(() => {
		cleanup();
		roadmapViewProps = null;
	});

	it("converts relative template content into draft roadmap canvas data", () => {
		const preview = buildTemplateRoadmapPreview(
			"template-1",
			content,
			"2026-07-14",
		);

		expect(preview.roadmap).toMatchObject({
			name: "Launch roadmap",
			status: "draft",
			start_date: "2026-07-14",
			end_date: "2026-08-13",
			currentUserRole: "viewer",
		});
		expect(preview.epics[0]).toMatchObject({
			title: "(Month 1) Foundation",
			status: "backlog",
			start_date: "2026-07-14",
			end_date: "2026-08-12",
		});
		expect(preview.epics[0].features?.[0]).toMatchObject({
			title: "(Week 1) Plan",
			start_date: "2026-07-14",
			end_date: "2026-07-20",
		});
		expect(preview.epics[0].features?.[0].tasks?.[0]).toMatchObject({
			title: "Write the scope",
			status: "todo",
			due_date: "2026-07-17",
		});
	});

	it("mounts the existing roadmap canvas as a fitted read-only flow", () => {
		render(
			<TemplateRoadmapFlow
				templateId="template-1"
				content={content}
				startDate="2026-07-14"
			/>,
		);

		expect(screen.getByTestId("template-roadmap-flow")).toBeTruthy();
		expect(screen.getByTestId("roadmap-view")).toBeTruthy();
		expect(roadmapViewProps).toMatchObject({
			readOnly: true,
			fitView: true,
			minZoom: 0.2,
			performanceMode: "reducedMotion",
		});
	});
});
