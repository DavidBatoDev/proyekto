/**
 * Product tour query functions
 *
 * Reads and writes public.user_tour_progress directly through the Supabase
 * client under own-row RLS — the same access path `queries/profile.ts` uses.
 * There is no backend module: a tour record is one row of the user's own
 * private UI state, so a round-trip through NestJS would buy nothing.
 */

import { supabase } from "../lib/supabase";
import type { TourScope, TourStatus, UserTourProgress } from "../types";

const TABLE = "user_tour_progress";

/**
 * Query key factory. Scope is part of the key so a project tour's progress
 * never gets served from a different project's cache entry.
 */
export const tourKeys = {
	all: ["tours"] as const,
	byUser: (userId: string) => ["tours", userId] as const,
	progress: (userId: string, tourKey: string, scope: TourScope) =>
		[
			"tours",
			userId,
			tourKey,
			scope.scopeType,
			scope.scopeId ?? "global",
		] as const,
};

/**
 * Fetch one tour's progress. `null` means the user has never been through it —
 * that is the signal the auto-run looks for.
 */
export async function fetchTourProgress(
	userId: string,
	tourKey: string,
	scope: TourScope,
): Promise<UserTourProgress | null> {
	let query = supabase
		.from(TABLE)
		.select("*")
		.eq("user_id", userId)
		.eq("tour_key", tourKey)
		.eq("scope_type", scope.scopeType);

	// `.eq(col, null)` renders as `col=eq.null` and matches nothing; NULL scope
	// ids need the IS NULL form.
	query =
		scope.scopeId === null
			? query.is("scope_id", null)
			: query.eq("scope_id", scope.scopeId);

	const { data, error } = await query.maybeSingle();
	if (error) throw error;
	return (data as UserTourProgress | null) ?? null;
}

export interface RecordTourProgressInput {
	userId: string;
	tourKey: string;
	scope: TourScope;
	status: TourStatus;
	lastStep: number;
}

/**
 * Record a finished or skipped run.
 *
 * Upserts on the (user, tour, scope) unique index, so finishing a tour twice
 * in two tabs collapses into one row instead of racing. `replay_count` is
 * intentionally absent from the payload — the DB default keeps it at 0 on
 * insert, and `recordTourReplay` owns it from then on.
 */
export async function recordTourProgress({
	userId,
	tourKey,
	scope,
	status,
	lastStep,
}: RecordTourProgressInput): Promise<UserTourProgress | null> {
	const { data, error } = await supabase
		.from(TABLE)
		.upsert(
			{
				user_id: userId,
				tour_key: tourKey,
				scope_type: scope.scopeType,
				scope_id: scope.scopeId,
				status,
				last_step: lastStep,
				completed_at: new Date().toISOString(),
			},
			{ onConflict: "user_id,tour_key,scope_type,scope_id" },
		)
		.select("*")
		.single();

	if (error) throw error;
	return (data as UserTourProgress | null) ?? null;
}

/**
 * Note that the user re-watched a tour.
 *
 * Deliberately does not touch `status` or `completed_at`: a replay must never
 * resurrect the auto-run, and we want the original completion timestamp to
 * stay meaningful. Best-effort — a failed counter bump is not worth blocking
 * the replay the user just asked for.
 */
export async function recordTourReplay(
	userId: string,
	tourKey: string,
	scope: TourScope,
): Promise<void> {
	const existing = await fetchTourProgress(userId, tourKey, scope);
	if (!existing) return;

	const { error } = await supabase
		.from(TABLE)
		.update({ replay_count: existing.replay_count + 1 })
		.eq("id", existing.id);

	if (error) throw error;
}

/**
 * Local "already seen" cache.
 *
 * Completion is permanent and per-user, so once we know a tour has been taken
 * there is nothing left to learn from the server. Persisting that fact means a
 * reload does not re-query on every dashboard visit for the rest of the user's
 * life.
 *
 * Only the POSITIVE result is cached. "Not seen yet" is the state that can
 * still change elsewhere (another device, another tab), so that case keeps
 * asking the server until it flips.
 */
function seenStorageKey(
	userId: string,
	tourKey: string,
	scope: TourScope,
): string {
	return `proyekto.tour-seen.${userId}.${tourKey}.${scope.scopeType}.${scope.scopeId ?? "global"}`;
}

export function hasSeenTourLocally(
	userId: string,
	tourKey: string,
	scope: TourScope,
): boolean {
	if (typeof window === "undefined") return false;
	try {
		return (
			window.localStorage.getItem(seenStorageKey(userId, tourKey, scope)) !==
			null
		);
	} catch {
		// Private mode / storage disabled — fall back to querying.
		return false;
	}
}

export function markTourSeenLocally(
	userId: string,
	tourKey: string,
	scope: TourScope,
): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(
			seenStorageKey(userId, tourKey, scope),
			new Date().toISOString(),
		);
	} catch {
		// Non-fatal: the server row is the source of truth, this is only a
		// shortcut that saves a request.
	}
}

export function clearTourSeenLocally(
	userId: string,
	tourKey: string,
	scope: TourScope,
): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.removeItem(seenStorageKey(userId, tourKey, scope));
	} catch {
		// Ignore.
	}
}
