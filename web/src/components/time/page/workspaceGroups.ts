// web/src/components/time/page/workspaceGroups.ts
//
// Time is per workspace: the /time page and the sidebar's Time item follow
// the workspace switcher. One rule decides what belongs to a workspace:
//
//   workspace context / sheet → its own id
//   team context / sheet      → the team's workspace (policy_workspace_id first)
//   waiting sheet             → its policy workspace
//   policy card (admins)      → its workspace
//   personal, agreement       → no workspace: shown in the person's DEFAULT
//                               workspace only, as "Personal & agreements"
//
// The default workspace is the earliest one the person owns (the server's
// `joined_at` order, `pickDefaultWorkspace`). A team whose workspace isn't
// known yet counts as belonging to the current workspace, so nothing hides on
// a guess.

import type {
	ApprovalRow,
	OverviewContext,
	TimesheetSummary,
	WorkspaceTimeAdmin,
} from "@/services/time.types";

export const WORKSPACE_GROUPS_COPY = {
	personal: "Personal & agreements",
	unnamed: "another workspace",
	notSetUp: (name: string) => `Time isn't set up for you in ${name}.`,
	notSetUpDetail:
		"Switch to a workspace where you track or approve time, or head back to the dashboard.",
	dashboard: "Go to the dashboard",
	switch: "Switch",
} as const;

/** Team id → its workspace id (the person's teams). */
export type TeamWorkspaces = Readonly<
	Record<string, string | null | undefined>
>;

export interface WorkspaceScope {
	/** The current workspace; null/undefined = none or loading (nothing scoped). */
	current: string | null | undefined;
	/** The current workspace is the person's default one. */
	isDefault: boolean;
	teams?: TeamWorkspaces;
}

type ScopeSheet = Pick<
	TimesheetSummary,
	"scope_kind" | "scope_ref" | "policy_workspace_id"
> & { team_id?: string | null };
type ScopeWaiting = Pick<
	ApprovalRow,
	"policy_workspace_id" | "policy_workspace"
>;

function same(a: string | null | undefined, b: string): boolean {
	return (a ?? "").toLowerCase() === b.toLowerCase();
}

function teamWorkspace(
	teamId: string | null | undefined,
	teams: TeamWorkspaces = {},
): string | null {
	if (!teamId) return null;
	return teams[teamId] ?? teams[teamId.toLowerCase()] ?? null;
}

/**
 * Where something belongs: a workspace id, `"personal"` (no workspace), or
 * `"unknown"` (a team whose workspace isn't known yet).
 */
type Owner = string | "personal" | "unknown";

function contextOwner(
	kind: string,
	id: string | null | undefined,
	teams?: TeamWorkspaces,
): Owner {
	if (kind === "workspace") return id || "unknown";
	if (kind === "team") return teamWorkspace(id, teams) ?? "unknown";
	return "personal";
}

function sheetOwner(sheet: ScopeSheet, teams?: TeamWorkspaces): Owner {
	if (sheet.scope_kind !== "workspace" && sheet.scope_kind !== "team") {
		return "personal";
	}
	if (sheet.policy_workspace_id) return sheet.policy_workspace_id;
	return contextOwner(
		sheet.scope_kind,
		sheet.scope_kind === "team"
			? (sheet.team_id ?? sheet.scope_ref)
			: sheet.scope_ref,
		teams,
	);
}

/** The workspace a waiting sheet belongs to, or null (an agreement's). */
export function waitingWorkspaceId(row: ScopeWaiting): string | null {
	return row.policy_workspace_id ?? row.policy_workspace?.id ?? null;
}

function inScope(owner: Owner, scope: WorkspaceScope): boolean {
	if (!scope.current) return true;
	if (owner === "unknown") return true;
	if (owner === "personal") return scope.isDefault;
	return same(owner, scope.current);
}

/** A logging context (overview context, `?for=`, an entry's context) on this page. */
export function contextInScope(
	context: { kind: string; id: string | null | undefined },
	scope: WorkspaceScope,
): boolean {
	return inScope(contextOwner(context.kind, context.id, scope.teams), scope);
}

/** A context that no workspace owns (personal time, an agreement). */
export function isPersonalContext(kind: string): boolean {
	return kind !== "workspace" && kind !== "team";
}

/** A timesheet card on this page. */
export function sheetInScope(
	sheet: ScopeSheet,
	scope: WorkspaceScope,
): boolean {
	return inScope(sheetOwner(sheet, scope.teams), scope);
}

/** A sheet no workspace owns (an agreement's). */
export function isPersonalSheet(sheet: ScopeSheet): boolean {
	return sheetOwner(sheet) === "personal";
}

/** A waiting row on this page. */
export function waitingInScope(
	row: ScopeWaiting,
	scope: WorkspaceScope,
): boolean {
	const owner = waitingWorkspaceId(row);
	return inScope(owner ?? "personal", scope);
}

export interface ElsewhereWaiting {
	workspaceId: string;
	name: string;
	count: number;
}

/**
 * Waiting rows counted per workspace other than the current one, named from
 * `names` or the row, in name order. Rows no workspace owns never count here.
 */
export function waitingElsewhere(
	rows: readonly ScopeWaiting[],
	current: string | null | undefined,
	names: Readonly<Record<string, string>> = {},
): ElsewhereWaiting[] {
	const out = new Map<string, ElsewhereWaiting>();
	for (const row of rows) {
		const id = waitingWorkspaceId(row);
		if (!id || (current && same(id, current))) continue;
		const key = id.toLowerCase();
		const known = out.get(key);
		if (known) {
			known.count += 1;
			continue;
		}
		out.set(key, {
			workspaceId: id,
			name:
				names[id]?.trim() ||
				row.policy_workspace?.name?.trim() ||
				WORKSPACE_GROUPS_COPY.unnamed,
			count: 1,
		});
	}
	return Array.from(out.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Rows waiting in this workspace (and, in the default one, agreement rows). */
export function waitingHereCount(
	rows: readonly ScopeWaiting[],
	scope: WorkspaceScope,
): number {
	return rows.filter((row) => waitingInScope(row, scope)).length;
}

/**
 * The sidebar's Time gate for the current workspace. Time shows when the
 * person has time there (a context, a sheet or a waiting row in it), is an
 * owner or admin of its time policy, or it is their default workspace and
 * they have personal or agreement contexts.
 */
export function timeVisibleInWorkspace(input: {
	scope: WorkspaceScope;
	contexts?: readonly Pick<OverviewContext, "kind" | "id">[] | null;
	admins?: readonly Pick<WorkspaceTimeAdmin, "workspace_id">[] | null;
	waiting?: readonly ScopeWaiting[];
	sheets?: readonly ScopeSheet[];
	/** The overview's `can_log`: "Just me" is always loggable in the default workspace. */
	canLog?: boolean | null;
}): boolean {
	const { scope } = input;
	const current = scope.current;
	if (!current) return false;
	if ((input.admins ?? []).some((item) => same(item.workspace_id, current))) {
		return true;
	}
	if (scope.isDefault && input.canLog === true) return true;
	for (const context of input.contexts ?? []) {
		// A team whose workspace isn't known yet counts here: never hide on a guess.
		if (contextInScope(context, scope)) return true;
	}
	if (
		(input.waiting ?? []).some((row) => same(waitingWorkspaceId(row), current))
	) {
		return true;
	}
	return (input.sheets ?? []).some((sheet) => {
		const owner = sheetOwner(sheet, scope.teams);
		return owner !== "personal" && owner !== "unknown" && same(owner, current);
	});
}

// ── Logging (what creates time on /time) ────────────────────────────────────
//
// Starting a timer, Quick add and Add time offer only this workspace's
// projects, and on them only For options of this workspace: its own
// workspace context, its teams, and agreements on its projects. "Just me" is
// offered in the default workspace only. A remembered default that points
// elsewhere is dropped with the option it named.

/** A project the pickers offer here. */
export function projectInScope(
	project: { workspace_id: string | null },
	scope: WorkspaceScope,
): boolean {
	if (!scope.current) return true;
	return project.workspace_id
		? same(project.workspace_id, scope.current)
		: scope.isDefault;
}

/** A For option offered here (on a project already in scope). */
export function forOptionInScope(
	option: {
		kind: string;
		id: string | null;
		workspace_tag?: string | null;
	},
	scope: WorkspaceScope,
): boolean {
	if (!scope.current) return true;
	if (option.kind === "personal") return scope.isDefault;
	if (option.kind === "assignment") return true;
	// Governed by another workspace (L57's tag), or a team that lives there.
	if (option.workspace_tag) return false;
	return contextInScope(option, scope);
}

/** A logging-for answer with only this workspace's options. */
export function scopeLoggingFor<
	O extends { kind: string; id: string | null; workspace_tag?: string | null },
	R extends { options: O[]; selected: O | null; prefill: O | null },
>(result: R, scope: WorkspaceScope | null | undefined): R {
	if (!scope?.current) return result;
	const options = result.options.filter((option) =>
		forOptionInScope(option, scope),
	);
	if (options.length === result.options.length) return result;
	const keep = (option: O | null) =>
		option && options.includes(option) ? option : null;
	return {
		...result,
		options,
		selected:
			keep(result.selected) ?? (options.length === 1 ? options[0] : null),
		prefill: keep(result.prefill),
	};
}
