/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/ai-context.service", () => ({
	aiContextService: { resolveRefs: vi.fn() },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({
			children,
			to,
			params,
			search,
			className,
			...rest
		}: {
			children?: ReactNode;
			to: string;
			params?: Record<string, string>;
			search?: Record<string, string>;
			className?: string;
		}) => {
			let href = to;
			for (const [key, value] of Object.entries(params ?? {})) {
				href = href.replace(`$${key}`, value);
			}
			if (search) href += `?${new URLSearchParams(search).toString()}`;
			return createElement("a", { href, className, ...rest }, children);
		},
	};
});

import { aiContextService } from "@/services/ai-context.service";
import { AiEntityChip } from "./AiEntityChip";
import { AiMarkdown, renderBracketTagsInNode } from "./AiMarkdown";
import type { AiSessionScope } from "./scope";

const ID = "a91b9842-15ae-48c1-bf90-627a71179e38";
const scope: AiSessionScope = {
	kind: "roadmap",
	roadmapId: "roadmap",
	projectId: "project",
};
const clients: QueryClient[] = [];

function renderMarkdown(content: string) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	clients.push(client);
	return render(
		<QueryClientProvider client={client}>
			<AiMarkdown content={content} scope={scope} />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.mocked(aiContextService.resolveRefs).mockReset();
	vi.mocked(aiContextService.resolveRefs).mockImplementation(async (refs) =>
		refs.map((ref) => ({
			...ref,
			accessible: true,
			title: "Drag Task",
			roadmap_id: "roadmap",
			project_id: "project",
		})),
	);
});

afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
});

describe("AiMarkdown entity links", () => {
	it("renders one entity chip and preserves surrounding relationship prose", async () => {
		const { container } = renderMarkdown(
			`[Drag Task](proyekto://task/${ID}) — in this roadmap, status: todo.`,
		);
		await screen.findByRole("link");
		expect(
			container.querySelectorAll('[data-entity-kind="task"]'),
		).toHaveLength(1);
		expect(container.textContent).toBe(
			"Drag Task — in this roadmap, status: todo.",
		);
		expect(container.textContent).not.toContain("proyekto://");
	});

	it("keeps bracket-tag pills beside chips and flattens formatted link text", async () => {
		const { container } = renderMarkdown(
			`[note] [**Drag** Task](proyekto://task/${ID})`,
		);
		const note = screen.getByText("note");
		expect(note.tagName).toBe("SPAN");
		expect(note.className).toContain("rounded-full");
		expect(
			container.querySelector('[data-entity-kind="task"]')?.textContent,
		).toBe("Drag Task");
		await screen.findByRole("link");
		expect(
			container.querySelectorAll('[data-entity-kind="task"]'),
		).toHaveLength(1);
		const chip = createElement(
			AiEntityChip,
			{ kind: "task", id: ID, label: "[note]", scope },
			"[note]",
		);
		expect(renderBracketTagsInNode(chip)).toBe(chip);
	});

	it("opens absolute HTTP links in a protected new tab and keeps relative links in-tab", () => {
		renderMarkdown(
			"[Docs](https://proyekto.app/help) [Local](/help) [HTTP](http://example.test)",
		);
		for (const name of ["Docs", "HTTP"]) {
			const link = screen.getByRole("link", { name });
			expect(link.getAttribute("target")).toBe("_blank");
			expect(link.getAttribute("rel")).toBe("noopener noreferrer");
		}
		expect(
			screen.getByRole("link", { name: "Local" }).getAttribute("target"),
		).toBeNull();
	});

	it("renders an unexpanded handle as title text without a chip or URI leak", () => {
		const { container } = renderMarkdown("[Epic title](proyekto://epic/E1)");
		expect(container.textContent).toBe("Epic title");
		expect(container.querySelector("[data-entity-kind]")).toBeNull();
		expect(container.querySelector("a")).toBeNull();
		expect(container.innerHTML).not.toContain("proyekto://");
	});

	it("renders empty and stripped unsafe destinations without anchors", () => {
		const { container } = renderMarkdown(
			"[Empty]() and [Unsafe](javascript:alert)",
		);
		expect(container.textContent).toBe("Empty and Unsafe");
		expect(container.querySelector("a")).toBeNull();
	});

	it("keeps existing assistant prose and ordinary markdown working without a query provider", () => {
		const { container } = render(
			<AiMarkdown content="Done. **Two tasks** updated. [note]" />,
		);
		expect(container.textContent).toBe("Done. Two tasks updated. note");
		expect(screen.getByText("Two tasks").tagName).toBe("STRONG");
		expect(container.querySelector("[data-entity-kind]")).toBeNull();
	});
});
