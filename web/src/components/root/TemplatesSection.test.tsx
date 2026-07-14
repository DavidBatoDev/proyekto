/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TemplatesSection } from "./TemplatesSection";

vi.mock("framer-motion", () => ({
	motion: {
		div: ({
			children,
			className,
		}: {
			children?: ReactNode;
			className?: string;
		}) => <div className={className}>{children}</div>,
	},
	useInView: () => true,
}));

vi.mock("./TemplateEntryCard", () => ({
	TemplateEntryCard: ({
		template,
	}: {
		template: { id: string; name: string };
	}) => (
		<article data-testid={`template-${template.id}`}>{template.name}</article>
	),
}));

afterEach(() => {
	cleanup();
});

describe("TemplatesSection", () => {
	it("keeps category filtering while rendering the template grid", () => {
		render(<TemplatesSection />);

		expect(screen.getAllByTestId(/^template-/)).toHaveLength(6);
		fireEvent.click(screen.getByRole("button", { name: "AI" }));

		expect(screen.getAllByTestId(/^template-/)).toHaveLength(2);
		expect(screen.getByText("AI Copilot Rollout")).toBeTruthy();
		expect(screen.getByText("AI Automation Stack")).toBeTruthy();
		expect(screen.queryByText("SaaS MVP Launch")).toBeNull();
	});
});
