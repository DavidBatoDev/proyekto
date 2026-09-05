import { describe, expect, it } from "vitest";
import {
	type AiSessionScope,
	aiScopeKey,
	aiSessionsBasePath,
	focusRoadmapId,
	isSameAiScope,
	NO_PROJECT_ROUTE_ID,
	toAgentScope,
	toRouteProjectId,
} from "./scope";

const roadmapScope: AiSessionScope = {
	kind: "roadmap",
	roadmapId: "rm-1",
	projectId: "pj-1",
};

const workspaceScope: AiSessionScope = {
	kind: "workspace",
	workspaceId: "ws-1",
	slug: "acme",
};

describe("aiScopeKey", () => {
	it("keys a roadmap scope by roadmap id", () => {
		expect(aiScopeKey(roadmapScope)).toBe("roadmap:rm-1");
	});

	it("keys a workspace scope by workspace id", () => {
		expect(aiScopeKey(workspaceScope)).toBe("workspace:ws-1");
	});

	it("never collides across kinds for the same id", () => {
		const roadmap: AiSessionScope = {
			kind: "roadmap",
			roadmapId: "same",
			projectId: "n",
		};
		const workspace: AiSessionScope = {
			kind: "workspace",
			workspaceId: "same",
			slug: "s",
		};
		expect(aiScopeKey(roadmap)).not.toBe(aiScopeKey(workspace));
	});
});

describe("aiSessionsBasePath", () => {
	it("routes roadmap threads through the roadmap controller", () => {
		expect(aiSessionsBasePath(roadmapScope)).toBe(
			"/api/roadmaps/rm-1/ai-sessions",
		);
	});

	it("routes workspace threads through the workspace controller", () => {
		expect(aiSessionsBasePath(workspaceScope)).toBe(
			"/api/workspaces/ws-1/ai-sessions",
		);
	});
});

describe("toAgentScope", () => {
	it("builds the agent's snake_case roadmap scope", () => {
		expect(toAgentScope(roadmapScope)).toEqual({
			kind: "roadmap",
			roadmap_id: "rm-1",
		});
	});

	it("builds the agent's snake_case workspace scope without the slug", () => {
		expect(toAgentScope(workspaceScope)).toEqual({
			kind: "workspace",
			workspace_id: "ws-1",
		});
	});
});

describe("focusRoadmapId", () => {
	it("is the roadmap in roadmap scope", () => {
		expect(focusRoadmapId(roadmapScope)).toBe("rm-1");
	});

	it("is null in workspace scope and for a missing scope", () => {
		expect(focusRoadmapId(workspaceScope)).toBeNull();
		expect(focusRoadmapId(null)).toBeNull();
	});
});

describe("toRouteProjectId", () => {
	it("passes a real project id through", () => {
		expect(toRouteProjectId("pj-1")).toBe("pj-1");
	});

	it("falls back to the 'n' sentinel for null, undefined and empty", () => {
		expect(NO_PROJECT_ROUTE_ID).toBe("n");
		expect(toRouteProjectId(null)).toBe("n");
		expect(toRouteProjectId(undefined)).toBe("n");
		expect(toRouteProjectId("")).toBe("n");
	});

	it("keeps an existing sentinel as-is", () => {
		expect(toRouteProjectId("n")).toBe("n");
	});
});

describe("isSameAiScope", () => {
	it("compares by key, ignoring display-only fields", () => {
		expect(
			isSameAiScope(roadmapScope, { ...roadmapScope, projectId: "n" }),
		).toBe(true);
		expect(
			isSameAiScope(workspaceScope, { ...workspaceScope, slug: "other" }),
		).toBe(true);
		expect(isSameAiScope(roadmapScope, workspaceScope)).toBe(false);
	});

	it("treats two missing scopes as equal and one missing as different", () => {
		expect(isSameAiScope(null, null)).toBe(true);
		expect(isSameAiScope(undefined, undefined)).toBe(true);
		expect(isSameAiScope(roadmapScope, null)).toBe(false);
		expect(isSameAiScope(null, undefined)).toBe(false);
	});
});
