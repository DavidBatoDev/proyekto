/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateRoadmapThumbnailDataUri } from "@/lib/roadmapThumbnail";
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

	it("shows the banner image above the epic overview when one is set", () => {
		render(
			<RoadmapPreviewCard
				variant="roadmap"
				title="Product roadmap"
				description="Project roadmap"
				epics={templateEpics}
				previewImageUrl="https://cdn.proyekto.tech/roadmap-previews/banner.png"
				status={<span>Active</span>}
				footerAction={<span>Open roadmap</span>}
			/>,
		);

		const banner = document.querySelector("[data-roadmap-card-banner]");
		expect(banner?.getAttribute("src")).toBe(
			"https://cdn.proyekto.tech/roadmap-previews/banner.png",
		);
		// The epics stay on the card - the banner only takes the top band, and
		// one fewer row shows above the fold.
		expect(screen.getByText("Scope framing")).toBeTruthy();
		expect(screen.getByText("Billing setup")).toBeTruthy();
		expect(screen.queryByText("Launch checklist")).toBeNull();
		expect(screen.getByText("+2 more epics")).toBeTruthy();
	});

	it("keeps epics expandable on a banner card once it is selected", () => {
		const roadmapEpics: RoadmapCardEpic[] = [
			{
				id: "epic-1",
				title: "Product discovery",
				position: 0,
				features: [{ id: "feature-1", title: "Interview customers" }],
			},
		];

		render(
			<RoadmapPreviewCard
				variant="roadmap"
				interactive
				title="Product roadmap"
				description="Project roadmap"
				epics={roadmapEpics}
				previewImageUrl="https://cdn.proyekto.tech/roadmap-previews/banner.png"
				status={<span>Active</span>}
				footerAction={<span>Open roadmap</span>}
			/>,
		);

		const card = screen.getByRole("button", { name: /product roadmap/i });
		fireEvent.click(card);
		expect(card.getAttribute("aria-pressed")).toBe("true");
		expect(document.querySelector("[data-roadmap-card-banner]")).toBeTruthy();
		expect(screen.getByText("Interview customers")).toBeTruthy();

		const epicButton = screen
			.getAllByRole("button", { name: /product discovery/i })
			.find((element) => element.tagName === "BUTTON");
		fireEvent.click(epicButton as HTMLButtonElement);
		expect(screen.queryByText("Interview customers")).toBeNull();
	});

	it("keeps the epic overview for the generated placeholder thumbnail", () => {
		render(
			<RoadmapPreviewCard
				variant="roadmap"
				title="Product roadmap"
				description="Project roadmap"
				epics={templateEpics}
				previewImageUrl={generateRoadmapThumbnailDataUri(
					"roadmap-1",
					"Product roadmap",
				)}
				status={<span>Active</span>}
				footerAction={<span>Open roadmap</span>}
			/>,
		);

		expect(document.querySelector("[data-roadmap-card-banner]")).toBeNull();
		expect(screen.getByText("Scope framing")).toBeTruthy();
	});

	it("falls back to the epic overview when the banner image fails to load", () => {
		render(
			<RoadmapPreviewCard
				variant="roadmap"
				title="Product roadmap"
				description="Project roadmap"
				epics={templateEpics}
				previewImageUrl="https://cdn.proyekto.tech/missing.png"
				status={<span>Active</span>}
				footerAction={<span>Open roadmap</span>}
			/>,
		);

		const banner = document.querySelector("[data-roadmap-card-banner]");
		expect(banner).toBeTruthy();
		fireEvent.error(banner as HTMLImageElement);

		expect(document.querySelector("[data-roadmap-card-banner]")).toBeNull();
		expect(screen.getByText("Scope framing")).toBeTruthy();
	});

	it("lets template cards select and toggle their feature previews", () => {
		const interactiveTemplateEpics: RoadmapCardEpic[] = [
			{
				id: "epic-1",
				title: "Product discovery",
				position: 0,
				features: [
					{ id: "feature-1", title: "Interview customers" },
					{ id: "feature-2", title: "Validate demand" },
				],
			},
		];

		render(
			<RoadmapPreviewCard
				variant="template"
				interactive
				title="SaaS MVP Launch"
				description="SaaS template"
				epics={interactiveTemplateEpics}
				status={<span>Free</span>}
				footerAction={<button type="button">Use template</button>}
			/>,
		);

		const card = screen.getByRole("button", { name: /saas mvp launch/i });
		expect(card.getAttribute("aria-pressed")).toBe("false");
		expect(screen.queryByText("Interview customers")).toBeNull();

		fireEvent.click(card);
		expect(card.getAttribute("aria-pressed")).toBe("true");
		expect(screen.getByText("Interview customers")).toBeTruthy();
		expect(screen.getByText("Validate demand")).toBeTruthy();

		const epicButton = screen
			.getAllByRole("button", { name: /product discovery/i })
			.find((element) => element.tagName === "BUTTON");
		expect(epicButton).toBeTruthy();
		fireEvent.click(epicButton as HTMLButtonElement);
		expect(screen.queryByText("Interview customers")).toBeNull();

		fireEvent.keyDown(document, { key: "Escape" });
		expect(card.getAttribute("aria-pressed")).toBe("false");
	});
});
