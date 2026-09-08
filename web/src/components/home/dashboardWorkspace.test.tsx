/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import apiClient from "@/api/axios";
import { useDashboardContent } from "@/hooks/useDashboardContent";
import { supabase } from "@/lib/supabase";
import {
	TourDemoProvider,
	useTourDemoControls,
} from "@/lib/tours/demo/TourDemoContext";
import { workspaceKeys } from "@/queries/workspaces";
import { useAuthStore } from "@/stores/authStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { User } from "@/types";
import { DashboardWidgets } from "./DashboardWidgets";
import { ProjectsGrid } from "./ProjectsGrid";
import { RoadmapsGrid } from "./RoadmapsGrid";
import { TeamsGrid } from "./TeamsGrid";

const projectKey = ["dashboard", "projects", "anonymous"];
const roadmapKey = ["dashboard", "roadmaps-preview", "anonymous"];
const teamKey = ["teams", "mine", "anonymous"];
const projectInviteKey = ["projects", "my-invites"];
const teamInviteKey = ["teams", "my-invites"];
const scopes = ["a", "b", "external", null];
const clients: QueryClient[] = [];

function project(workspace_id: string | null, index = 0) {
	return {
		id: `p-${workspace_id}-${index}`,
		workspace_id,
		title: `Project ${workspace_id} ${index}`,
		status: "draft",
	};
}
function team(workspace_id: string | null) {
	return {
		id: `t-${workspace_id}`,
		workspace_id,
		name: `Team ${workspace_id}`,
		updated_at: "2026-09-08",
	};
}
function roadmap(workspace_id: string | null) {
	return {
		id: `r-${workspace_id}`,
		name: `Roadmap ${workspace_id}`,
		project: workspace_id ? project(workspace_id) : null,
		project_id: workspace_id ? project(workspace_id).id : null,
		epics: [],
	};
}
function invite(workspace_id: string | null, status = "pending") {
	return {
		id: `i-${workspace_id}-${status}`,
		status,
		created_at: "2026-09-08",
		project: {
			...project(workspace_id),
			title: `Project invite ${workspace_id}`,
		},
		team: { ...team(workspace_id), name: `Team invite ${workspace_id}` },
	};
}

function Dashboard() {
	const { isEmpty, isLoading } = useDashboardContent();
	const demo = useTourDemoControls();
	return (
		<>
			<output data-testid="state">
				{isLoading ? "loading" : isEmpty ? "empty" : "content"}
			</output>
			<button
				type="button"
				onClick={() =>
					demo.enter({
						projects: [project(null)],
						teams: [team(null)],
						roadmaps: [roadmap(null)],
						projectInvites: [],
						teamInvites: [],
					})
				}
			>
				Replay tour
			</button>
			<DashboardWidgets>
				<ProjectsGrid />
				<TeamsGrid />
				<RoadmapsGrid />
			</DashboardWidgets>
		</>
	);
}

async function setup(slug = "a", withWorkspaces = true) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	clients.push(client);
	if (withWorkspaces)
		client.setQueryData(
			workspaceKeys.mine(undefined),
			["a", "b", "empty"].map((id) => ({ id, slug: id })),
		);
	client.setQueryData(
		projectKey,
		scopes.map((id) => project(id)),
	);
	client.setQueryData(roadmapKey, scopes.map(roadmap));
	client.setQueryData(teamKey, scopes.map(team));
	client.setQueryData(projectInviteKey, [
		...scopes.map((id) => invite(id)),
		invite("a", "accepted"),
	]);
	client.setQueryData(teamInviteKey, [
		...scopes.map((id) => invite(id)),
		invite("a", "accepted"),
	]);
	client.setQueryData(["dashboard", "meetings-preview", "anonymous"], []);
	const root = createRootRoute({
		component: () => (
			<QueryClientProvider client={client}>
				<TourDemoProvider>
					<Outlet />
				</TourDemoProvider>
			</QueryClientProvider>
		),
	});
	const route = createRoute({
		getParentRoute: () => root,
		path: "/w/$workspaceSlug",
		component: Dashboard,
	});
	const router = createRouter({
		routeTree: root.addChildren([route]),
		history: createMemoryHistory({ initialEntries: [`/w/${slug}`] }),
	});
	await router.load();
	render(<RouterProvider router={router} />);
	await screen.findByTestId("state");
	return { client, router };
}

beforeEach(() => {
	// The unresolved-workspace case deliberately leaves its HTTP request pending.
	vi.spyOn(apiClient, "get").mockImplementation(() => new Promise(() => {}));
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
			unobserve() {}
		},
	);
	vi.spyOn(supabase, "channel").mockReturnValue({
		on() {
			return this;
		},
		subscribe() {
			return this;
		},
	} as unknown as ReturnType<typeof supabase.channel>);
	vi.spyOn(supabase, "removeChannel").mockResolvedValue("ok");
	useAuthStore.setState({ user: { id: "anonymous" } as User });
});

afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	useWorkspaceStore.getState().clear();
});

describe("dashboard workspace isolation", () => {
	it("filters cards and invitations and switches using the same account-wide cache", async () => {
		const { client, router } = await setup();
		for (const name of [
			"Project a 0",
			"Team a",
			"Roadmap a",
			"Project invite a",
			"Team invite a",
		])
			expect(screen.getByText(name)).toBeTruthy();
		for (const suffix of ["b", "external", "null"]) {
			for (const name of [
				`Project ${suffix} 0`,
				`Team ${suffix}`,
				`Roadmap ${suffix}`,
				`Project invite ${suffix}`,
				`Team invite ${suffix}`,
			])
				expect(screen.queryByText(name)).toBeNull();
		}
		await act(async () => {
			await router.navigate({
				to: "/w/$workspaceSlug",
				params: { workspaceSlug: "b" },
			});
		});
		expect(screen.getByText("Project b 0")).toBeTruthy();
		expect(screen.getByText("Team b")).toBeTruthy();
		expect(screen.getByText("Roadmap b")).toBeTruthy();
		expect(screen.queryByText("Project a 0")).toBeNull();
		expect(screen.queryByText("Team invite a")).toBeNull();
		expect(client.getQueryData(projectKey)).toHaveLength(4);
	});

	it("treats a workspace containing only foreign content as empty, but counts its project invitations", async () => {
		const { client } = await setup("empty");
		expect(screen.getByTestId("state").textContent).toBe("empty");
		await act(async () => {
			client.setQueryData(projectInviteKey, [invite("empty")]);
		});
		await waitFor(() =>
			expect(screen.getByTestId("state").textContent).toBe("content"),
		);
		expect(screen.getByText("Project invite empty")).toBeTruthy();
	});

	it("never shows cached account content while the workspace is unresolved", async () => {
		await setup("a", false);
		expect(screen.getByTestId("state").textContent).toBe("loading");
		expect(screen.queryByText("Project a 0")).toBeNull();
		expect(screen.queryByText("Team a")).toBeNull();
		expect(screen.queryByText("Roadmap a")).toBeNull();
	});

	it("scopes activity and project-linked meetings before selecting previews", async () => {
		const { client } = await setup();
		await act(async () => {
			client.setQueryData(
				roadmapKey,
				["external", "b", "a"].map((id) => ({
					...roadmap(id),
					epics: [
						{
							id: `e-${id}`,
							title: "Epic",
							position: 0,
							features: [
								{
									id: `f-${id}`,
									title: "Feature",
									tasks: [
										{
											id: `task-${id}`,
											title: `Activity ${id}`,
											status: "in_review",
											assignee_id: "anonymous",
										},
									],
								},
							],
						},
					],
				})),
			);
			client.setQueryData(
				["dashboard", "meetings-preview", "anonymous"],
				["b", "a"].map((id, index) => ({
					id: `m-${id}`,
					title: `Meeting ${id}`,
					project_id: project(id).id,
					scheduled_at: new Date(
						Date.now() + (index + 1) * 3600000,
					).toISOString(),
				})),
			);
		});
		expect(await screen.findByText("1 task assigned to you")).toBeTruthy();
		expect(screen.queryByText("3 tasks assigned to you")).toBeNull();
		expect(screen.getAllByText(/Meeting a/).length).toBeGreaterThan(0);
		expect(screen.queryByText(/Meeting b/)).toBeNull();
	});

	it("applies the project preview limit after filtering and preserves tour fixtures", async () => {
		const { client } = await setup();
		await act(async () => {
			client.setQueryData(projectInviteKey, []);
			client.setQueryData(projectKey, [
				...Array.from({ length: 8 }, (_, i) => project("b", i)),
				...Array.from({ length: 7 }, (_, i) => project("a", i)),
			]);
		});
		expect(await screen.findByText("View more (1)")).toBeTruthy();
		expect(screen.queryByText("Project a 6")).toBeNull();
		fireEvent.click(screen.getByTestId("projects-view-more"));
		expect(screen.getByText("Project a 6")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Replay tour" }));
		expect(screen.getByText("Project null 0")).toBeTruthy();
		expect(screen.getByText("Team null")).toBeTruthy();
		expect(screen.getByText("Roadmap null")).toBeTruthy();
		expect(screen.queryByText("Project a 0")).toBeNull();
	});
});
