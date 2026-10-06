/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { timeService } from "@/services/time.service";
import type { MyTimeProject } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import {
	defaultLoggableProjectId,
	isArchivedProject,
	orderLoggableProjects,
	projectTitle,
	useLoggableProjects,
} from "./useLoggableProjects";

const USER = "user-1";

function project(id: string, over: Partial<MyTimeProject> = {}): MyTimeProject {
	return {
		id,
		title: `Project ${id}`,
		workspace_id: "w1",
		options: 1,
		default_kind: "team",
		status: "active",
		last_logged_at: null,
		...over,
	};
}

let client: QueryClient;

function setup(options: Parameters<typeof useLoggableProjects>[0] = {}) {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const wrapper = ({ children }: { children: ReactNode }) =>
		createElement(QueryClientProvider, { client }, children);
	return renderHook(() => useLoggableProjects(options), { wrapper });
}

beforeEach(() => {
	useAuthStore.setState({ user: { id: USER } as never });
});

afterEach(() => {
	cleanup();
	client?.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
});

describe("orderLoggableProjects", () => {
	it("keeps the server order (most recently logged first) and sinks archived projects", () => {
		const list = [
			project("a", { status: "archived" }),
			project("b"),
			project("c", { status: "paused" }),
		];
		expect(orderLoggableProjects(list).map((p) => p.id)).toEqual([
			"b",
			"c",
			"a",
		]);
	});

	it("drops projects with no option (never listed by A9, but never trusted either)", () => {
		expect(
			orderLoggableProjects([project("a", { options: 0 }), project("b")]).map(
				(p) => p.id,
			),
		).toEqual(["b"]);
		expect(orderLoggableProjects(null)).toEqual([]);
	});

	it("reads archived from the status only", () => {
		expect(isArchivedProject(project("a", { status: "archived" }))).toBe(true);
		expect(isArchivedProject(project("a", { status: null }))).toBe(false);
		expect(isArchivedProject(null)).toBe(false);
	});
});

describe("defaultLoggableProjectId", () => {
	const ordered = [project("recent"), project("older")];

	it("defaults to the most recently logged project", () => {
		expect(defaultLoggableProjectId(ordered)).toBe("recent");
	});

	it("takes the preferred project only when it is loggable", () => {
		expect(defaultLoggableProjectId(ordered, "older")).toBe("older");
		expect(defaultLoggableProjectId(ordered, "elsewhere")).toBe("recent");
	});

	it("is null for an empty list", () => {
		expect(defaultLoggableProjectId([])).toBeNull();
	});
});

describe("projectTitle", () => {
	it("falls back for an untitled project", () => {
		expect(projectTitle({ title: "  " })).toBe("Untitled project");
		expect(projectTitle({ title: "Acme Website" })).toBe("Acme Website");
	});
});

describe("useLoggableProjects", () => {
	it("reads GET me/projects and exposes the default and lookup", async () => {
		const spy = vi.spyOn(timeService, "listMyProjects").mockResolvedValue({
			projects: [project("p1"), project("p0", { status: "archived" })],
			truncated: true,
		});
		const { result } = setup({ preferredProjectId: "p0" });
		await waitFor(() => expect(result.current.projects).toHaveLength(2));
		expect(spy).toHaveBeenCalledTimes(1);
		expect(result.current.defaultProjectId).toBe("p0");
		expect(result.current.byId.get("p1")?.title).toBe("Project p1");
		expect(result.current.truncated).toBe(true);
		expect(result.current.isEmpty).toBe(false);
	});

	it("says empty once loaded with nothing to log on", async () => {
		vi.spyOn(timeService, "listMyProjects").mockResolvedValue({
			projects: [],
		});
		const { result } = setup();
		await waitFor(() => expect(result.current.isEmpty).toBe(true));
		expect(result.current.defaultProjectId).toBeNull();
	});

	it("waits for a signed-in user", () => {
		useAuthStore.setState({ user: null });
		const spy = vi.spyOn(timeService, "listMyProjects");
		const { result } = setup();
		expect(spy).not.toHaveBeenCalled();
		expect(result.current.isLoading).toBe(false);
		expect(result.current.isEmpty).toBe(false);
	});
});
