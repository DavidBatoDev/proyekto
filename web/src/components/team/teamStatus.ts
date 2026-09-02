import type { TeamStatus } from "@/services/teams.service";

/**
 * The team lifecycle vocabulary, kept as a pure module so the labels can be
 * tested without mounting anything.
 *
 * Deliberately not reusing `PROJECT_STATUS_CONFIG` from `components/home/
 * ProjectsGrid`: that carries six project states (draft, bidding, completed…)
 * which mean nothing for a team, and importing a UI module for a label map
 * would drag the projects grid into the teams chunk.
 */
export const TEAM_STATUSES = ["active", "paused", "archived"] as const;

export const TEAM_STATUS_CONFIG: Record<
	TeamStatus,
	{ label: string; hint: string }
> = {
	active: { label: "Active", hint: "Working normally" },
	paused: { label: "Paused", hint: "Temporarily not taking work" },
	archived: { label: "Archived", hint: "Kept for reference only" },
};

/**
 * Coerce whatever the API or a stale query-cache entry hands us into a status
 * we can render. `status` is optional on the `Team` type because cache entries
 * persisted before the column shipped carry no value, so "missing" is a normal
 * input here, not an error.
 */
export function normalizeTeamStatus(
	value: string | null | undefined,
): TeamStatus {
	const candidate = (value ?? "").trim().toLowerCase();
	return (TEAM_STATUSES as readonly string[]).includes(candidate)
		? (candidate as TeamStatus)
		: "active";
}

export function teamStatusLabel(value: string | null | undefined): string {
	return TEAM_STATUS_CONFIG[normalizeTeamStatus(value)].label;
}
