import type { QueryClient } from "@tanstack/react-query";
import type {
	ConsultantPublicExperience,
	ConsultantPublicLanguage,
	ConsultantPublicPortfolio,
	ConsultantPublicRates,
} from "@/queries/consultants";
import { consultantKeys } from "@/queries/consultants";
import { type TalentPublicSpecialization, talentKeys } from "@/queries/talent";

/**
 * Optimistic cache surgery for the WYSIWYG seller profiles.
 *
 * The owner edits the page a client sees, so a save that only invalidates
 * leaves them watching their own edit arrive a round trip later — on a page
 * whose whole premise is "this is what it looks like". These helpers write the
 * change into the rendered cache first, and the mutation rolls back if the
 * server disagrees.
 *
 * Both public payloads are patched unconditionally: a consultant profile and a
 * talent profile share these sections, one account can be both, and writing to
 * a key nobody observes is a no-op — the same reasoning the invalidation
 * already uses.
 */

/** The slice of both public payloads the editor can change. */
export interface EditableSellerProfile {
	headline?: string | null;
	bio?: string | null;
	rates: ConsultantPublicRates | null;
	languages: ConsultantPublicLanguage[];
	experiences: ConsultantPublicExperience[];
	portfolios: ConsultantPublicPortfolio[];
	/** Talent only; consultants carry `expertise` instead. */
	specializations?: TalentPublicSpecialization[];
}

export type SellerCacheSnapshot = Array<{
	key: readonly unknown[];
	data: unknown;
}>;

function sellerKeys(profileId: string): Array<readonly unknown[]> {
	return [consultantKeys.detail(profileId), talentKeys.detail(profileId)];
}

/**
 * Apply `patch` to every mounted public seller cache and hand back a snapshot
 * for rollback. In-flight refetches are cancelled first, or one landing mid-
 * edit would overwrite the optimistic value with the pre-edit server payload.
 */
export async function applySellerPatch(
	qc: QueryClient,
	profileId: string,
	patch: (previous: EditableSellerProfile) => EditableSellerProfile,
): Promise<SellerCacheSnapshot> {
	const keys = sellerKeys(profileId);
	await Promise.all(keys.map((key) => qc.cancelQueries({ queryKey: key })));

	const snapshot: SellerCacheSnapshot = keys.map((key) => ({
		key,
		data: qc.getQueryData(key),
	}));

	for (const key of keys) {
		qc.setQueryData(key, (previous: unknown) =>
			previous ? patch(previous as EditableSellerProfile) : previous,
		);
	}

	return snapshot;
}

export function restoreSellerCaches(
	qc: QueryClient,
	snapshot: SellerCacheSnapshot | undefined,
): void {
	if (!snapshot) return;
	for (const entry of snapshot) qc.setQueryData(entry.key, entry.data);
}

/**
 * A placeholder id for a row that exists only in the cache. Swapped for the
 * server's row in `onSuccess`, so the window where a delete could be aimed at
 * a row the server has never heard of is a single response long.
 */
export function tempId(): string {
	return `temp-${Math.random().toString(36).slice(2, 10)}`;
}

export function isTempId(id: string): boolean {
	return id.startsWith("temp-");
}

/** Replace a placeholder row with the persisted one, in place. */
export function replaceById<T extends { id: string }>(
	rows: T[],
	targetId: string,
	replacement: T,
): T[] {
	return rows.map((row) => (row.id === targetId ? replacement : row));
}
