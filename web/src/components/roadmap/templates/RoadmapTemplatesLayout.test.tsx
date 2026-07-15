/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: unknown) => options,
	Outlet: () => <main data-testid="template-route-content" />,
}));

vi.mock("@/components/root/Header", () => ({
	Header: () => <header data-testid="marketing-header" />,
}));

import { RoadmapTemplatesLayout } from "@/routes/roadmap-templates/route";

afterEach(cleanup);

describe("RoadmapTemplatesLayout", () => {
	it("keeps the marketing header above every nested template route", () => {
		render(<RoadmapTemplatesLayout />);

		expect(screen.getByTestId("marketing-header")).toBeTruthy();
		expect(screen.getByTestId("template-route-content")).toBeTruthy();
		expect(
			screen.getByTestId("template-route-content").parentElement?.className,
		).toContain("pt-20");
	});
});
