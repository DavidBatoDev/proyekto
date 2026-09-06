/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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

import {
	type AiResolvedEntity,
	aiContextService,
} from "@/services/ai-context.service";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";
import { AiEntityChip } from "./AiEntityChip";
import { aiEntityKeys } from "./aiEntityResolver";
import type { AiMentionKind } from "./aiMentions";
import type { AiSessionScope } from "./scope";

const ID = "a91b9842-15ae-48c1-bf90-627a71179e38";
const ROADMAP = "b91b9842-15ae-48c1-bf90-627a71179e38";
const PROJECT = "c91b9842-15ae-48c1-bf90-627a71179e38";
const scope: AiSessionScope = {
	kind: "roadmap",
	roadmapId: ROADMAP,
	projectId: PROJECT,
};
const resolveRefs = vi.mocked(aiContextService.resolveRefs);
const clients: QueryClient[] = [];

function user(id: string): User {
	return {
		id,
		app_metadata: {},
		user_metadata: {},
		aud: "authenticated",
		created_at: "2026-09-06T10:00:00Z",
	};
}

function task(overrides: Partial<AiResolvedEntity> = {}): AiResolvedEntity {
	return {
		kind: "task",
		id: ID,
		accessible: true,
		title: "Canonical task",
		roadmap_id: ROADMAP,
		project_id: PROJECT,
		...overrides,
	};
}

function renderChip({
	kind = "task",
	label = "Old task title",
	chipScope = scope,
	repeats = 1,
}: {
	kind?: AiMentionKind;
	label?: string;
	chipScope?: AiSessionScope | null;
	repeats?: number;
} = {}) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	clients.push(client);
	const view = render(
		<QueryClientProvider client={client}>
			{Array.from({ length: repeats }, (_, index) => (
				<AiEntityChip
					key={index}
					kind={kind}
					id={ID}
					label={label}
					scope={chipScope}
				/>
			))}
		</QueryClientProvider>,
	);
	return { ...view, client };
}

beforeEach(() => {
	useAuthStore.setState({ user: null });
	localStorage.removeItem("proyekto_guest_session_id");
	localStorage.removeItem("prdigy_guest_session_id");
	resolveRefs.mockReset();
	resolveRefs.mockResolvedValue([task()]);
});

afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
	useAuthStore.setState({ user: null });
	localStorage.removeItem("proyekto_guest_session_id");
	localStorage.removeItem("prdigy_guest_session_id");
	vi.useRealTimers();
});

describe("AiEntityChip", () => {
	it("shows a non-linked label while loading, then the canonical title", async () => {
		const { container } = renderChip();
		const loading = container.querySelector('[data-entity-state="loading"]');
		expect(loading?.textContent).toBe("Old task title");
		expect(loading?.getAttribute("href")).toBeNull();
		expect(loading?.getAttribute("data-entity-kind")).toBe("task");
		expect(loading?.getAttribute("data-entity-id")).toBe(ID);
		await waitFor(() => {
			expect(screen.getByRole("link").textContent).toBe("Canonical task");
		});
		expect(screen.getByRole("link").getAttribute("data-entity-state")).toBe(
			"linked",
		);
	});

	it("renders the task glyph, destination, primary avatars, overflow and parent tooltip", async () => {
		resolveRefs.mockResolvedValue([
			task({
				status: "in_progress",
				parent_chain: [
					{ kind: "feature", id: "f", title: "Drag Feature" },
					{ kind: "epic", id: "e", title: "Drag Epic 1" },
					{ kind: "roadmap", id: ROADMAP, title: "PW Drag A" },
				],
				assignees: ["Primary Person", "Second Person", "Third", "Fourth"].map(
					(display_name, index) => ({
						id: `person-${index}`,
						display_name,
						avatar_url: `https://images.example.test/${index}.png`,
					}),
				),
				assignee_count: 4,
			}),
		]);
		const { container } = renderChip();
		const link = await screen.findByRole("link");
		expect(link.getAttribute("href")).toBe(
			`/project/${PROJECT}/roadmap/${ROADMAP}?nodeId=${ID}`,
		);
		expect(link.querySelector('svg[aria-label="Task"]')).toBeTruthy();
		expect(link.textContent).toContain("Canonical task");
		expect(link.getAttribute("title")).toBe(
			"Task · In Progress · Drag Feature / Drag Epic 1 / PW Drag A · Assigned to Primary Person, Second Person, Third, Fourth",
		);
		const avatars = Array.from(link.querySelectorAll("img"));
		expect(avatars.map((img) => img.getAttribute("alt"))).toEqual([
			"Primary Person",
			"Second Person",
		]);
		expect(screen.getByText("+2")).toBeTruthy();
		expect(
			Array.from(container.querySelectorAll("[class]"))
				.map((node) => node.getAttribute("class"))
				.join(" "),
		).not.toMatch(/slate|gray|violet/);
	});

	it("uses initials and shows all three avatars when there is no overflow", async () => {
		resolveRefs.mockResolvedValue([
			task({
				assignees: ["Alex One", "Bea Two", "Cory Three"].map(
					(display_name, index) => ({
						id: `person-${index}`,
						display_name,
						avatar_url: null,
					}),
				),
				assignee_count: 3,
			}),
		]);
		renderChip();
		await screen.findByRole("link");
		expect(screen.getByText("AO")).toBeTruthy();
		expect(screen.getByText("BT")).toBeTruthy();
		expect(screen.getByText("CT")).toBeTruthy();
		expect(screen.queryByText(/^\+\d+$/)).toBeNull();
		const link = screen.getByRole("link", { name: "Task Canonical task" });
		expect(link.getAttribute("title")).toBe(
			"Task · Assigned to Alex One, Bea Two, Cory Three",
		);
		expect(screen.getByText("AO").closest('[aria-hidden="true"]')).toBeTruthy();
	});

	it("uses the full assignee count even when the backend caps returned profiles", async () => {
		resolveRefs.mockResolvedValue([
			task({
				assignees: Array.from({ length: 5 }, (_, index) => ({
					id: `person-${index}`,
					display_name: `Person ${index}`,
					avatar_url: null,
				})),
				assignee_count: 8,
			}),
		]);
		renderChip();
		await screen.findByRole("link");
		expect(screen.getByText("+6")).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Task Canonical task" })
				.getAttribute("title"),
		).toBe(
			"Task · Assigned to Person 0, Person 1, Person 2, Person 3, Person 4, and 3 more",
		);
	});

	it("renders inaccessible entities as plain chips using only the link label", async () => {
		resolveRefs.mockResolvedValue([
			{ kind: "task", id: ID, accessible: false, error_code: "NOT_FOUND" },
		]);
		const { container } = renderChip();
		await waitFor(() => {
			expect(
				container.querySelector('[data-entity-state="plain"]'),
			).toBeTruthy();
		});
		expect(screen.getByText("Old task title")).toBeTruthy();
		expect(screen.queryByRole("link")).toBeNull();
		expect(container.querySelector("[href]")).toBeNull();
	});

	it("leaves an accessible team plain in roadmap scope", async () => {
		resolveRefs.mockResolvedValue([task({ kind: "team", title: "Platform" })]);
		const { container } = renderChip({ kind: "team" });
		await screen.findByText("Platform");
		expect(container.querySelector('[data-entity-state="plain"]')).toBeTruthy();
		expect(screen.queryByRole("link")).toBeNull();
	});

	it("links a team in workspace scope", async () => {
		resolveRefs.mockResolvedValue([task({ kind: "team", title: "Platform" })]);
		renderChip({
			kind: "team",
			chipScope: {
				kind: "workspace",
				workspaceId: "workspace",
				slug: "studio",
			},
		});
		expect((await screen.findByRole("link")).getAttribute("href")).toBe(
			`/w/studio/teams/${ID}`,
		);
	});

	it("uses the n sentinel for a roadmap without a project", async () => {
		resolveRefs.mockResolvedValue([
			task({ kind: "roadmap", project_id: null, title: "Standalone roadmap" }),
		]);
		renderChip({ kind: "roadmap" });
		expect((await screen.findByRole("link")).getAttribute("href")).toBe(
			`/project/n/roadmap/${ID}`,
		);
	});

	it("tolerates an older backend without assignee fields", async () => {
		renderChip();
		const link = await screen.findByRole("link");
		expect(link.textContent).toBe("Canonical task");
		expect(link.querySelector("img")).toBeNull();
	});

	it("resolves the same task in two replies once through the query cache", async () => {
		renderChip({ repeats: 2 });
		await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(2));
		expect(resolveRefs).toHaveBeenCalledExactlyOnceWith([
			{ kind: "task", id: ID },
		]);
	});
});

describe("AiEntityChip actor cache isolation", () => {
	it("hides a prior account's cached title and avatars immediately after account switching", async () => {
		useAuthStore.setState({ user: user("account-a") });
		resolveRefs.mockResolvedValueOnce([
			task({
				title: "Account A private task",
				assignees: [
					{
						id: "private-person",
						display_name: "Private Person",
						avatar_url: "https://images.example.test/private.png",
					},
				],
				assignee_count: 1,
			}),
		]);
		resolveRefs.mockResolvedValueOnce([
			{ kind: "task", id: ID, accessible: false, error_code: "NOT_FOUND" },
		]);
		const { container } = renderChip();
		await screen.findByText("Account A private task");
		expect(screen.getByAltText("Private Person")).toBeTruthy();
		act(() => useAuthStore.setState({ user: user("account-b") }));
		expect(screen.queryByText("Account A private task")).toBeNull();
		expect(screen.queryByAltText("Private Person")).toBeNull();
		expect(screen.getByText("Old task title")).toBeTruthy();
		expect(screen.queryByRole("link")).toBeNull();
		await waitFor(() => {
			expect(
				container.querySelector('[data-entity-state="plain"]'),
			).toBeTruthy();
		});
		expect(resolveRefs).toHaveBeenCalledTimes(2);
	});

	it("drops a queued old-account lookup before dispatch and resolves for the new account", async () => {
		vi.useFakeTimers();
		useAuthStore.setState({ user: user("account-a") });
		resolveRefs.mockImplementation(async () => {
			expect(useAuthStore.getState().user?.id).toBe("account-b");
			return [task({ title: "Account B task" })];
		});
		renderChip();
		expect(resolveRefs).not.toHaveBeenCalled();
		act(() => useAuthStore.setState({ user: user("account-b") }));
		await act(async () => vi.advanceTimersByTimeAsync(50));
		await act(async () => vi.advanceTimersByTimeAsync(10));
		expect(resolveRefs).toHaveBeenCalledExactlyOnceWith([
			{ kind: "task", id: ID },
		]);
		expect(screen.getByText("Account B task")).toBeTruthy();
	});

	it("discards an in-flight old-account result after the new account has resolved", async () => {
		useAuthStore.setState({ user: user("account-a") });
		let completeFirst!: (entities: AiResolvedEntity[]) => void;
		resolveRefs.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					completeFirst = resolve;
				}),
		);
		resolveRefs.mockResolvedValueOnce([task({ title: "Account B task" })]);
		const { client } = renderChip();
		await waitFor(() => expect(resolveRefs).toHaveBeenCalledTimes(1));
		act(() => useAuthStore.setState({ user: user("account-b") }));
		await screen.findByText("Account B task");
		await act(async () => {
			completeFirst([task({ title: "Late account A secret" })]);
		});
		expect(screen.queryByText("Late account A secret")).toBeNull();
		expect(screen.getByText("Account B task")).toBeTruthy();
		const cached = client.getQueriesData<AiResolvedEntity>({
			queryKey: aiEntityKeys.one("task", ID),
		});
		expect(
			cached.some(([, entity]) => entity?.title === "Late account A secret"),
		).toBe(false);
		expect(resolveRefs).toHaveBeenCalledTimes(2);
	});

	it("partitions replacement guest sessions without putting their credentials in cache keys", async () => {
		localStorage.setItem("proyekto_guest_session_id", "guest-secret-first");
		resolveRefs.mockResolvedValueOnce([task({ title: "First guest task" })]);
		resolveRefs.mockResolvedValueOnce([task({ title: "Second guest task" })]);
		const { client, rerender } = renderChip();
		await screen.findByText("First guest task");
		localStorage.setItem("proyekto_guest_session_id", "guest-secret-second");
		rerender(
			<QueryClientProvider client={client}>
				<AiEntityChip
					kind="task"
					id={ID}
					label="Old task title"
					scope={scope}
				/>
			</QueryClientProvider>,
		);
		expect(screen.queryByText("First guest task")).toBeNull();
		await screen.findByText("Second guest task");
		expect(resolveRefs).toHaveBeenCalledTimes(2);
		const queries = client
			.getQueryCache()
			.findAll({ queryKey: aiEntityKeys.all });
		expect(queries).toHaveLength(2);
		const keys = JSON.stringify(queries.map((query) => query.queryKey));
		expect(keys).not.toContain("guest-secret-first");
		expect(keys).not.toContain("guest-secret-second");
	});
});
