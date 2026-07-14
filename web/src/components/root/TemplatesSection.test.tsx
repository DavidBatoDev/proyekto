/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TemplatesSection } from "./TemplatesSection";

const { getRoadmapTemplates } = vi.hoisted(() => ({
	getRoadmapTemplates: vi.fn(),
}));
vi.mock("@/api", () => ({ getRoadmapTemplates }));

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
		template: { id: string; title: string };
	}) => (
		<article data-testid={`template-${template.id}`}>{template.title}</article>
	),
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const template = (id: string, title: string, category: string) => ({
	id,
	title,
	category: {
		slug: category.toLowerCase().replace(/\s/g, "-"),
		name: category,
	},
});

describe("TemplatesSection", () => {
	it("loads six featured templates and keeps API category filtering", async () => {
		getRoadmapTemplates.mockResolvedValue({
			items: [
				template("1", "SaaS MVP Launch", "SaaS"),
				template("2", "Production AI Product", "AI & Machine Learning"),
				template("3", "AI Evaluation Program", "AI & Machine Learning"),
				template("4", "Web Product", "Web Development"),
				template("5", "Store Launch", "E-commerce"),
				template("6", "Research Study", "Research"),
			],
			next_cursor: null,
		});
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={client}>
				<TemplatesSection />
			</QueryClientProvider>,
		);

		expect(await screen.findAllByTestId(/^template-/)).toHaveLength(6);
		fireEvent.click(
			screen.getByRole("button", { name: "AI & Machine Learning" }),
		);

		expect(screen.getAllByTestId(/^template-/)).toHaveLength(2);
		expect(screen.getByText("Production AI Product")).toBeTruthy();
		expect(screen.queryByText("SaaS MVP Launch")).toBeNull();
		expect(getRoadmapTemplates).toHaveBeenCalledWith({
			sort: "featured",
			limit: 6,
		});
	});
});
