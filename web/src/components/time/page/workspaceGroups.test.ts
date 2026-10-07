import { describe, expect, it } from "vitest";
import {
	contextInScope,
	forOptionInScope,
	isOutsideProject,
	isOutsideSheet,
	isPersonalSheet,
	projectInScope,
	scopeLoggingFor,
	sharedProjectLabel,
	sheetInScope,
	timeVisibleInWorkspace,
	WORKSPACE_GROUPS_COPY,
	type WorkspaceScope,
	waitingElsewhere,
	waitingHereCount,
	waitingInScope,
} from "./workspaceGroups";

const sheet = (
	scope_kind: "workspace" | "team" | "engagement",
	scope_ref: string,
	policy_workspace_id: string | null = null,
) => ({ scope_kind, scope_ref, policy_workspace_id }) as never;
const row = (ws: string | null, name?: string) =>
	({
		policy_workspace_id: ws,
		policy_workspace: ws && name ? { id: ws, name } : null,
	}) as never;

const inA: WorkspaceScope = {
	current: "a",
	isDefault: true,
	teams: { tm: "a", tx: "x" },
};
const inD: WorkspaceScope = {
	current: "d",
	isDefault: false,
	teams: { tm: "a" },
};

describe("contextInScope", () => {
	it("keeps the workspace's own context and its teams'", () => {
		expect(contextInScope({ kind: "workspace", id: "a" }, inA)).toBe(true);
		expect(contextInScope({ kind: "workspace", id: "d" }, inA)).toBe(false);
		expect(contextInScope({ kind: "team", id: "tm" }, inA)).toBe(true);
		expect(contextInScope({ kind: "team", id: "tx" }, inA)).toBe(false);
	});
	it("shows personal and agreement time only in the default workspace", () => {
		expect(contextInScope({ kind: "personal", id: null }, inA)).toBe(true);
		expect(contextInScope({ kind: "assignment", id: "e" }, inA)).toBe(true);
		expect(contextInScope({ kind: "personal", id: null }, inD)).toBe(false);
	});
	it("never hides on a guess: unknown teams and no workspace keep everything", () => {
		expect(contextInScope({ kind: "team", id: "new" }, inD)).toBe(true);
		expect(
			contextInScope(
				{ kind: "workspace", id: "d" },
				{ current: undefined, isDefault: false },
			),
		).toBe(true);
	});
});

describe("sheets and waiting rows", () => {
	it("scope sheets by policy workspace, workspace or team", () => {
		expect(sheetInScope(sheet("team", "tm", "d"), inA)).toBe(false);
		expect(sheetInScope(sheet("team", "tm"), inA)).toBe(true);
		expect(sheetInScope(sheet("workspace", "a"), inA)).toBe(true);
		expect(sheetInScope(sheet("engagement", "e"), inD)).toBe(false);
		expect(isPersonalSheet(sheet("engagement", "e"))).toBe(true);
		expect(isPersonalSheet(sheet("workspace", "a"))).toBe(false);
	});
	it("count waiting here and elsewhere", () => {
		const rows = [
			row("a"),
			row("d", "David's"),
			row("d", "David's"),
			row(null),
			row("t", "Test"),
		];
		expect(rows.filter((r) => waitingInScope(r, inA))).toHaveLength(2);
		expect(waitingHereCount(rows, inA)).toBe(2);
		expect(waitingHereCount(rows, inD)).toBe(2);
		expect(waitingElsewhere(rows, inA, { d: "David's Workspace" })).toEqual([
			{ workspaceId: "d", name: "David's Workspace", count: 2 },
			{ workspaceId: "t", name: "Test", count: 1 },
		]);
	});
});

describe("timeVisibleInWorkspace", () => {
	it("opens for a context, a waiting row or an admin item in this workspace", () => {
		expect(
			timeVisibleInWorkspace({
				scope: inA,
				contexts: [{ kind: "team", id: "tm" }],
			}),
		).toBe(true);
		expect(timeVisibleInWorkspace({ scope: inD, waiting: [row("d")] })).toBe(
			true,
		);
		expect(
			timeVisibleInWorkspace({ scope: inD, admins: [{ workspace_id: "d" }] }),
		).toBe(true);
		expect(
			timeVisibleInWorkspace({ scope: inD, sheets: [sheet("workspace", "d")] }),
		).toBe(true);
	});
	it("opens for personal time only in the default workspace", () => {
		const contexts = [{ kind: "personal" as const, id: null }];
		expect(timeVisibleInWorkspace({ scope: inA, contexts })).toBe(true);
		expect(timeVisibleInWorkspace({ scope: inD, contexts })).toBe(false);
	});
	it("stays closed for time elsewhere and with no workspace", () => {
		expect(
			timeVisibleInWorkspace({
				scope: inD,
				contexts: [
					{ kind: "workspace", id: "a" },
					{ kind: "team", id: "tm" },
				],
				waiting: [row("a")],
			}),
		).toBe(false);
		expect(
			timeVisibleInWorkspace({ scope: { current: null, isDefault: false } }),
		).toBe(false);
	});
});

describe("logging scope", () => {
	it("offers only this workspace's projects (unowned ones in the default)", () => {
		expect(projectInScope({ workspace_id: "a" }, inA)).toBe(true);
		expect(projectInScope({ workspace_id: "d" }, inA)).toBe(false);
		expect(projectInScope({ workspace_id: null }, inA)).toBe(true);
		expect(projectInScope({ workspace_id: null }, inD)).toBe(false);
	});

	it("offers only this workspace's For options; Just me in the default only", () => {
		const opt = (
			kind: string,
			id: string | null,
			tag: string | null = null,
		) => ({
			kind,
			id,
			workspace_tag: tag,
		});
		expect(forOptionInScope(opt("workspace", "a"), inA)).toBe(true);
		expect(forOptionInScope(opt("team", "tx"), inA)).toBe(false);
		expect(forOptionInScope(opt("team", "tm", "Other"), inA)).toBe(false);
		expect(forOptionInScope(opt("assignment", "as"), inD)).toBe(true);
		expect(forOptionInScope(opt("personal", null), inA)).toBe(true);
		expect(forOptionInScope(opt("personal", null), inD)).toBe(false);
	});

	it("drops a remembered default that points elsewhere", () => {
		const here = { kind: "workspace", id: "d", workspace_tag: null };
		const mine = { kind: "personal", id: null, workspace_tag: null };
		const scoped = scopeLoggingFor(
			{ options: [here, mine], selected: null, prefill: mine },
			inD,
		);
		expect(scoped.options).toEqual([here]);
		expect(scoped.prefill).toBeNull();
		expect(scoped.selected).toBe(here);
		const untouched = { options: [here], selected: null, prefill: null };
		expect(scopeLoggingFor(untouched, null)).toBe(untouched);
	});
});

describe("outside workspaces (shared with you)", () => {
	const members = ["a", "d"];
	const def: WorkspaceScope = {
		current: "a",
		isDefault: true,
		members,
		defaultId: "a",
		teams: { tout: "x", tm: "a" },
	};
	const other: WorkspaceScope = { ...def, current: "d", isDefault: false };

	it("puts an outside project in the default workspace only", () => {
		expect(projectInScope({ workspace_id: "x" }, def)).toBe(true);
		expect(projectInScope({ workspace_id: "x" }, other)).toBe(false);
		expect(isOutsideProject({ workspace_id: "x" }, def)).toBe(true);
		// A member workspace is unaffected.
		expect(projectInScope({ workspace_id: "d" }, other)).toBe(true);
		expect(projectInScope({ workspace_id: "d" }, def)).toBe(false);
		expect(isOutsideProject({ workspace_id: "d" }, def)).toBe(false);
	});

	it("puts an outside team's context and sheets in the default workspace", () => {
		expect(contextInScope({ kind: "team", id: "tout" }, def)).toBe(true);
		expect(contextInScope({ kind: "team", id: "tout" }, other)).toBe(false);
		expect(sheetInScope(sheet("team", "tout"), def)).toBe(true);
		expect(isOutsideSheet(sheet("team", "tout"), def)).toBe(true);
		expect(isOutsideSheet(sheet("team", "tm"), def)).toBe(false);
	});

	it("counts outside waiting rows in the default workspace", () => {
		const rows = [row("x", "Acme"), row("d", "David's")];
		expect(waitingHereCount(rows, def)).toBe(1);
		expect(waitingHereCount(rows, other)).toBe(1);
		expect(waitingElsewhere(rows, other, { a: "August's" })).toEqual([
			{ workspaceId: "a", name: "August's", count: 1 },
		]);
		expect(waitingElsewhere(rows, def, { d: "David's" })).toEqual([
			{ workspaceId: "d", name: "David's", count: 1 },
		]);
	});

	it("opens Time in the default workspace for an outside project", () => {
		expect(
			timeVisibleInWorkspace({ scope: def, projects: [{ workspace_id: "x" }] }),
		).toBe(true);
		expect(
			timeVisibleInWorkspace({
				scope: other,
				projects: [{ workspace_id: "x" }],
			}),
		).toBe(false);
	});

	it("labels shared projects with their workspace when known", () => {
		expect(sharedProjectLabel("Portal", "Acme")).toBe("Portal · Acme");
		expect(sharedProjectLabel("Portal", null)).toBe("Portal");
		expect(WORKSPACE_GROUPS_COPY.sharedJustMe(null)).toContain(
			"the project's workspace",
		);
	});
});
