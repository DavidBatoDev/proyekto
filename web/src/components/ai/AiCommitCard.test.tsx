/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/ai-context.service", () => ({
	aiContextService: { resolveRefs: vi.fn() },
}));

import type { RunCommitView } from "@/services/ai-agent.service";
import { aiContextService } from "@/services/ai-context.service";
import {
	AiCommitCard,
	getCommitStatusLabel,
	legacyLifecycleToCommit,
	toCommitCards,
} from "./AiCommitCard";
import type { AiSessionScope } from "./scope";
import type { AiChatMessage } from "./types";

beforeEach(() => {
	vi.mocked(aiContextService.resolveRefs).mockReset();
	vi.mocked(aiContextService.resolveRefs).mockImplementation(async (refs) =>
		refs.map((ref) => ({
			...ref,
			accessible: true,
			title: "Resolved roadmap",
			roadmap_id: ref.id,
			project_id: "proj-resolved",
		})),
	);
});

afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
});

const workspaceScope: AiSessionScope = {
	kind: "workspace",
	workspaceId: "ws-1",
	slug: "acme",
};

const roadmapScope: AiSessionScope = {
	kind: "roadmap",
	roadmapId: "rm-alpha",
	projectId: "proj-alpha",
};

const committed = (overrides: Partial<RunCommitView> = {}): RunCommitView => ({
	batch_id: "batch-1",
	roadmap_id: "rm-alpha",
	roadmap_title: "Alpha",
	project_id: "proj-alpha",
	status: "committed",
	change_id: "chg-1",
	operations_count: 1,
	impacted_items: [
		{
			node_id: "epic-1",
			node_type: "epic",
			title: "Onboarding",
			change_type: "NODE_ADDED",
			impact: "created",
		},
	],
	...overrides,
});

/**
 * `AiCommitCard` renders TanStack `<Link>`s, which need a router context to
 * build hrefs. A memory router with the roadmap route registered gives the
 * chips real, resolvable hrefs (params interpolated, search serialized).
 */
const clients: QueryClient[] = [];

async function renderWithRouter(ui: ReactNode) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	clients.push(client);
	const rootRoute = createRootRoute({
		component: () => (
			<QueryClientProvider client={client}>{ui}</QueryClientProvider>
		),
	});
	const roadmapRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/project/$projectId/roadmap/$roadmapId",
		component: () => null,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([roadmapRoute]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	render(<RouterProvider router={router} />);
	await screen.findAllByTestId("ai-commit-card");
}

describe("AiCommitCard", () => {
	it("renders one card per commit with the roadmap title and the frozen label", async () => {
		await renderWithRouter(
			<>
				<AiCommitCard commit={committed()} scope={workspaceScope} />
				<AiCommitCard
					commit={committed({
						batch_id: "batch-2",
						roadmap_id: "rm-beta",
						roadmap_title: "Beta",
						project_id: null,
						impacted_items: [],
					})}
					scope={workspaceScope}
				/>
			</>,
		);

		const cards = screen.getAllByTestId("ai-commit-card");
		expect(cards).toHaveLength(2);
		expect(screen.getByText("Alpha")).toBeTruthy();
		expect(screen.getByText("Beta")).toBeTruthy();
		expect(screen.getAllByText("Committed changes")).toHaveLength(2);
	});

	it("deep-links impacted chips with the n sentinel for a project-less roadmap", async () => {
		await renderWithRouter(
			<AiCommitCard
				commit={committed({
					roadmap_id: "rm-orphan",
					roadmap_title: "Orphan",
					project_id: null,
				})}
				scope={workspaceScope}
			/>,
		);

		const chip = screen.getByRole("link", { name: "Onboarding" });
		expect(chip.getAttribute("href")).toContain(
			"/project/n/roadmap/rm-orphan?nodeId=epic-1",
		);
	});

	it("links focus-roadmap chips with the scope project and the canvas view", async () => {
		await renderWithRouter(
			<AiCommitCard
				commit={committed({ project_id: null })}
				scope={roadmapScope}
				linkView="timelineView"
			/>,
		);

		const chip = screen.getByRole("link", { name: "Onboarding" });
		const href = chip.getAttribute("href") ?? "";
		expect(href).toContain("/project/proj-alpha/roadmap/rm-alpha?");
		expect(href).toContain("nodeId=epic-1");
		expect(href).toContain("view=timelineView");
	});

	it("shows the error message in a failed card", async () => {
		await renderWithRouter(
			<AiCommitCard
				commit={committed({
					status: "failed",
					change_id: null,
					error_code: "STALE_REVISION",
					error_message: "The roadmap changed while applying.",
				})}
				scope={workspaceScope}
			/>,
		);

		expect(screen.getByText("Commit did not complete")).toBeTruthy();
		expect(
			screen.getByText("The roadmap changed while applying."),
		).toBeTruthy();
		expect(screen.queryByRole("link")).toBeNull();
	});

	it("backfills chip titles from this step's operations", async () => {
		await renderWithRouter(
			<AiCommitCard
				commit={committed({
					impacted_items: [{ node_id: "epic-9", node_type: "epic" }],
					operations: [
						{
							op: "update_node",
							node_type: "epic",
							node_id: "epic-9",
							patch: { title: "Renamed epic" },
						},
					],
				})}
				scope={workspaceScope}
			/>,
		);

		expect(screen.getByRole("link", { name: "Renamed epic" })).toBeTruthy();
	});

	it("maps every commit status to a label", () => {
		expect(getCommitStatusLabel("committed")).toBe("Committed changes");
		expect(getCommitStatusLabel("failed")).toBe("Commit did not complete");
		expect(getCommitStatusLabel("pending")).toBe("Committing changes");
		expect(getCommitStatusLabel("skipped")).toBe("Changes were skipped");
	});
});

describe("toCommitCards", () => {
	const baseMessage: AiChatMessage = {
		id: "m1",
		role: "assistant",
		content: "Done.",
		timestamp: "2026-09-04T08:00:00.000Z",
	};

	it("prefers run commits over the legacy lifecycle", () => {
		const cards = toCommitCards(
			{
				...baseMessage,
				commits: [committed()],
				commitLifecycle: {
					state: "failed",
					impactedItems: [],
					updatedAt: "2026-09-04T08:00:00.000Z",
				},
			},
			roadmapScope,
		);
		expect(cards).toHaveLength(1);
		expect(cards[0].status).toBe("committed");
		expect(cards[0].roadmap_title).toBe("Alpha");
	});

	it("renders a legacy commitLifecycle row as one commit on the focus roadmap", () => {
		const cards = toCommitCards(
			{
				...baseMessage,
				commitLifecycle: {
					state: "committed",
					impactedItems: [
						{
							nodeId: "task-1",
							nodeType: "task",
							title: "Write tests",
							kind: "modified",
							changeType: "STATUS_CHANGED",
						},
					],
					updatedAt: "2026-09-04T08:00:00.000Z",
				},
			},
			roadmapScope,
		);
		expect(cards).toHaveLength(1);
		expect(cards[0].roadmap_id).toBe("rm-alpha");
		expect(cards[0].status).toBe("committed");
		expect(cards[0].impacted_items).toEqual([
			{
				node_id: "task-1",
				node_type: "task",
				title: "Write tests",
				change_type: "STATUS_CHANGED",
				impact: "modified",
			},
		]);
	});

	it("carries the legacy failure reason", () => {
		const commit = legacyLifecycleToCommit(
			{
				state: "failed",
				impactedItems: [],
				updatedAt: "2026-09-04T08:00:00.000Z",
				errorMessage: "Validation failed",
			},
			null,
		);
		expect(commit.status).toBe("failed");
		expect(commit.error_message).toBe("Validation failed");
		expect(commit.roadmap_id).toBe("");
	});

	it("returns nothing for a plain assistant turn", () => {
		expect(toCommitCards(baseMessage, roadmapScope)).toEqual([]);
	});
});

describe("AiCommitCard attribution hydration", () => {
	it("resolves a title and project the agent could not attach", async () => {
		await renderWithRouter(
			<AiCommitCard
				commit={committed({ roadmap_title: null, project_id: null })}
				scope={workspaceScope}
			/>,
		);
		expect(await screen.findByText("Resolved roadmap")).toBeTruthy();
		const hrefs = screen
			.getAllByRole("link")
			.map((link) => link.getAttribute("href") ?? "");
		expect(hrefs.length).toBeGreaterThan(0);
		for (const href of hrefs) {
			expect(href.startsWith("/project/proj-resolved/roadmap/")).toBe(true);
		}
		expect(aiContextService.resolveRefs).toHaveBeenCalledTimes(1);
	});

	it("keeps the fallbacks when the roadmap is not accessible", async () => {
		vi.mocked(aiContextService.resolveRefs).mockImplementation(async (refs) =>
			refs.map((ref) => ({
				...ref,
				accessible: false,
				error_code: "NOT_FOUND",
			})),
		);
		await renderWithRouter(
			<AiCommitCard
				commit={committed({ roadmap_title: null, project_id: null })}
				scope={workspaceScope}
			/>,
		);
		expect(screen.getByText("Roadmap")).toBeTruthy();
		const href = screen.getAllByRole("link")[0].getAttribute("href") ?? "";
		expect(href.startsWith("/project/n/roadmap/")).toBe(true);
	});

	it("never asks the resolver when the commit already carries both", async () => {
		// Let any batch the previous test queued flush before counting calls.
		await new Promise((resolve) => setTimeout(resolve, 60));
		vi.mocked(aiContextService.resolveRefs).mockClear();
		await renderWithRouter(
			<AiCommitCard commit={committed()} scope={workspaceScope} />,
		);
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(aiContextService.resolveRefs).not.toHaveBeenCalled();
	});
});
