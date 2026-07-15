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

afterEach(cleanup);

describe("DashboardCreateActions", () => {
	it("links to project and standalone roadmap creation", () => {
		render(<DashboardCreateActions />);

		const projectLink = screen.getByRole("link", { name: /create project/i });
		const roadmapLink = screen.getByRole("link", { name: /create roadmap/i });

		expect(projectLink.getAttribute("href")).toBe("/project-posting");
		expect(projectLink.getAttribute("data-hierarchy-level")).toBe("project");
		expect(roadmapLink.getAttribute("href")).toBe("/project/n/roadmap/create");
		expect(roadmapLink.getAttribute("data-hierarchy-level")).toBe("roadmap");
	});
});
