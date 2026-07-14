/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type RoadmapCardEpic, RoadmapPreviewCard } from "./RoadmapPreviewCard";

afterEach(() => {
	cleanup();
});

const templateEpics: RoadmapCardEpic[] = [
	{ id: "epic-1", title: "Scope framing", position: 0 },
	{ id: "epic-2", title: "Core product sprint", position: 1 },
	{ id: "epic-3", title: "Billing setup", position: 2 },
	{ id: "epic-4", title: "Launch checklist", position: 3 },
	{ id: "epic-5", title: "Growth review", position: 4 },
];

describe("RoadmapPreviewCard", () => {
	it("renders the capped template epic preview without saved-roadmap metadata", () => {
		render(
			<RoadmapPreviewCard
				variant="template"
				title="SaaS MVP Launch"
				description="SaaS template"
				epics={templateEpics}
				status={<span>Template</span>}
				footerAction={<button type="button">Use template</button>}
			/>,
		);

		expect(screen.getByText("SaaS MVP Launch")).toBeTruthy();
		expect(screen.getByText("Scope framing")).toBeTruthy();
		expect(screen.getByText("Launch checklist")).toBeTruthy();
		expect(screen.queryByText("Growth review")).toBeNull();
		expect(screen.getByText("+1 more epic")).toBeTruthy();
		expect(screen.queryByText(/features?$/i)).toBeNull();
		expect(screen.getByRole("button", { name: "Use template" })).toBeTruthy();
		expect(screen.queryByLabelText("Open roadmap actions")).toBeNull();
	});

	it("retains saved-roadmap selection and nested feature behavior", () => {
		const onSelect = vi.fn();
		const roadmapEpics: RoadmapCardEpic[] = [
			{
				id: "epic-1",
				title: "Product discovery",
				position: 0,
				features: [
					{
						id: "feature-1",
						title: "Interview customers",
						tasks: [{ id: "task-1" }],
					},
				],
			},
		];

		render(
			<RoadmapPreviewCard
				variant="roadmap"
				title="Product roadmap"
				description="Project roadmap"
				epics={roadmapEpics}
				selected
				onSelect={onSelect}
				status={<span>Active</span>}
				footerAction={<span>Open roadmap</span>}
			/>,
		);

		expect(screen.getByText("1 feature")).toBeTruthy();
		expect(screen.getByText("Interview customers")).toBeTruthy();
		const epicButton = screen
			.getAllByRole("button", { name: /product discovery/i })
			.find((element) => element.tagName === "BUTTON");
		expect(epicButton).toBeTruthy();
		fireEvent.click(epicButton as HTMLButtonElement);
		expect(screen.queryByText("Interview customers")).toBeNull();
		expect(onSelect).not.toHaveBeenCalled();
	});
});
