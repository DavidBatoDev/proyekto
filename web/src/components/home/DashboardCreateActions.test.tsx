/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardCreateActions } from "./DashboardCreateActions";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		params,
		className,
		"data-hierarchy-level": hierarchyLevel,
	}: {
		children?: ReactNode;
		to: string;
		params?: Record<string, string>;
		className?: string;
		"data-hierarchy-level"?: string;
	}) => (
		<a
			href={to.replace("$projectId", params?.projectId ?? "$projectId")}
			className={className}
			data-hierarchy-level={hierarchyLevel}
		>
			{children}
		</a>
	),
}));

vi.mock("@/components/roadmap/RoadmapStartDialog", () => ({
	RoadmapStartTrigger: ({
		children,
		className,
		hierarchyLevel,
	}: {
		children?: ReactNode;
		className?: string;
		hierarchyLevel?: string;
	}) => (
		<button
			type="button"
			className={className}
			data-hierarchy-level={hierarchyLevel}
		>
			{children}
		</button>
	),
}));

afterEach(cleanup);

describe("DashboardCreateActions", () => {
	it("links to project creation and opens the roadmap chooser", () => {
		render(<DashboardCreateActions />);

		const projectLink = screen.getByRole("link", { name: /create project/i });
		const roadmapButton = screen.getByRole("button", {
			name: /create roadmap/i,
		});

		expect(projectLink.getAttribute("href")).toBe("/project/new");
		expect(projectLink.getAttribute("data-hierarchy-level")).toBe("project");
		// The templates gallery used to be this button's only destination. It is
		// now one of three choices behind the chooser, so there is no href here.
		expect(screen.queryByRole("link", { name: /create roadmap/i })).toBeNull();
		expect(roadmapButton.getAttribute("data-hierarchy-level")).toBe("roadmap");

		const notice = screen.getByRole("button", {
			name: /about roadmap integration/i,
		});
		const tooltip = screen.getByRole("tooltip");
		expect(tooltip.textContent).toContain(
			"A roadmap can be integrated to a project",
		);
		expect(notice.getAttribute("aria-describedby")).toBe(tooltip.id);
		expect(
			screen.queryByRole("link", { name: /post a project brief/i }),
		).toBeNull();
	});
});
