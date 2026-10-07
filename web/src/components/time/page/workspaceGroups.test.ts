import { describe, expect, it } from "vitest";
import {
	contextInScope,
	forOptionInScope,
	isPersonalSheet,
	projectInScope,
	scopeLoggingFor,
	sheetInScope,
	timeVisibleInWorkspace,
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
		expect(waitingElsewhere(rows, "a", { d: "David's Workspace" })).toEqual([
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
