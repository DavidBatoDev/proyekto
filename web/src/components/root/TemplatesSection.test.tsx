/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TemplatesSection } from "./TemplatesSection";

const { getFeaturedRoadmapTemplates, inViewState } = vi.hoisted(() => ({
	getFeaturedRoadmapTemplates: vi.fn(),
	inViewState: { current: true },
}));
vi.mock("@/api", () => ({ getFeaturedRoadmapTemplates }));

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
	useInView: () => inViewState.current,
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
	inViewState.current = true;
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
		getFeaturedRoadmapTemplates.mockResolvedValue({
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
		expect(getFeaturedRoadmapTemplates).toHaveBeenCalledTimes(1);
	});

	it("waits to fetch until the templates section is near the viewport", () => {
		inViewState.current = false;
		getFeaturedRoadmapTemplates.mockResolvedValue({ items: [] });
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});

		render(
			<QueryClientProvider client={client}>
				<TemplatesSection />
			</QueryClientProvider>,
		);

		expect(getFeaturedRoadmapTemplates).not.toHaveBeenCalled();
	});
});
