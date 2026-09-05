import type { AgentSessionScope } from "@/services/ai-agent.service";

// =============================================================================
// Session scope (D3). One shape drives the query keys, the persisted threads
// store, the run store's scope index, the backend sessions base path, and the
// agent create body. Pure module: no React, no stores, no roadmapStore.
// =============================================================================

export type AiSessionScope =
	| {
			kind: "roadmap";
			roadmapId: string;
			/** Route project id; may be the `"n"` sentinel for a standalone roadmap. */
			projectId: string;
	  }
	| {
			kind: "workspace";
			workspaceId: string;
			slug: string;
	  };

export type AiSessionScopeKind = AiSessionScope["kind"];

/** Route sentinel for a roadmap without a project (`/project/n/roadmap/...`). */
export const NO_PROJECT_ROUTE_ID = "n";

/**
 * Stable key for a scope — query keys, `activeThreadIdByScope`,
 * `startingByScope`. Matches the agent's own scope key format by convention
 * (`roadmap:{id}` / `workspace:{id}`); the agent computes its own.
 */
export function aiScopeKey(scope: AiSessionScope): string {
	return scope.kind === "roadmap"
		? `roadmap:${scope.roadmapId}`
		: `workspace:${scope.workspaceId}`;
}

/** Backend sessions family for the scope (D6 controllers). */
export function aiSessionsBasePath(scope: AiSessionScope): string {
	return scope.kind === "roadmap"
		? `/api/roadmaps/${scope.roadmapId}/ai-sessions`
		: `/api/workspaces/${scope.workspaceId}/ai-sessions`;
}

/** The agent's `scope` body on `POST /agent/sessions`. */
export function toAgentScope(scope: AiSessionScope): AgentSessionScope {
	return scope.kind === "roadmap"
		? { kind: "roadmap", roadmap_id: scope.roadmapId }
		: { kind: "workspace", workspace_id: scope.workspaceId };
}

/** The roadmap bare handles refer to; null in workspace scope. */
export function focusRoadmapId(scope: AiSessionScope | null): string | null {
	return scope?.kind === "roadmap" ? scope.roadmapId : null;
}

/**
 * Project id for `/project/$projectId/...` links: the `"n"` sentinel stands
 * in for a missing project, mirroring `resolveCandidateDestination`.
 */
export function toRouteProjectId(projectId: string | null | undefined): string {
	return projectId && projectId !== "" ? projectId : NO_PROJECT_ROUTE_ID;
}

export function isSameAiScope(
	a: AiSessionScope | null | undefined,
	b: AiSessionScope | null | undefined,
): boolean {
	if (!a || !b) return a === b;
	return aiScopeKey(a) === aiScopeKey(b);
}
