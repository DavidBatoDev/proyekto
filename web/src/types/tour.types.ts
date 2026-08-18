/**
 * Product tour types
 *
 * Mirrors public.user_tour_progress (see
 * supabase/migrations/20260819120000_create_user_tour_progress.sql).
 */

/**
 * What a tour is attached to. `global` tours are account-wide (the dashboard
 * tour); the rest are remembered per target row, so a project tour can run once
 * per project without re-running everywhere.
 */
export type TourScopeType = "global" | "project" | "roadmap" | "team";

export interface TourScope {
	scopeType: TourScopeType;
	/** Null for `global`; required for every other scope type. */
	scopeId: string | null;
}

export type TourStatus = "completed" | "skipped";

export interface UserTourProgress {
	id: string;
	user_id: string;
	tour_key: string;
	scope_type: TourScopeType;
	scope_id: string | null;
	status: TourStatus;
	last_step: number;
	replay_count: number;
	completed_at: string;
	created_at: string;
	updated_at: string;
}

export const GLOBAL_TOUR_SCOPE: TourScope = {
	scopeType: "global",
	scopeId: null,
};
