import type { MentionUser } from "./types";

/**
 * What an @mention resolves to. A discriminated union rather than an optional
 * field on MentionUser, so the two cases cannot be confused at the insert site —
 * they emit different attributes and the backend reads them with different
 * extractors.
 */
export type MentionTarget =
	| { kind: "user"; user: MentionUser }
	| { kind: "email"; email: string };

/**
 * Where the @ sits and what has been typed after it.
 *
 * Two things this must get right, both of which the previous `/@(\w*)$/` did
 * not:
 *
 * 1. **The query may contain an `@`**, because an email address does. `\w`
 *    excludes `@` and `.`, so an address could never be typed into the picker.
 * 2. **The trigger must start a word.** Without the leading `(^|\s)`, typing
 *    "mail me at bob@x.co" matches `@x.co` and opens the picker mid-word. That
 *    was already true and merely invisible, because the dropdown renders
 *    nothing when no member matches — the moment an "Invite" row appears on a
 *    non-match, it would surface on every address anyone types in prose.
 */
export function matchMentionQuery(
	beforeCursor: string,
): { query: string; atOffset: number } | null {
	const match = beforeCursor.match(/(^|\s)@([^\s@]*(?:@[^\s@]*)?)$/);
	if (!match) return null;

	const [full, lead, query] = match;
	return {
		query: query ?? "",
		// `full` includes the leading whitespace, which is not part of the mention.
		atOffset: beforeCursor.length - full.length + (lead?.length ?? 0),
	};
}

/**
 * Deliberately loose. The authoritative check is server-side, in
 * `extractMentionedEmails` — this only decides whether to offer the affordance,
 * and refusing to show it for an address the backend would accept is a worse
 * failure than showing it for one the backend will reject.
 */
export function isLikelyEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

/**
 * The single source of truth for what the picker shows.
 *
 * Previously the same filter was written three times — the ArrowDown handler,
 * the Enter handler, and the dropdown's render — which was survivable only
 * because all three produced the same list. Adding a synthetic "invite" row to
 * one of them would have made Enter select a different entry than the one
 * highlighted. Everything now indexes into this one array.
 */
export function buildMentionCandidates(
	users: MentionUser[] | undefined,
	query: string,
	canInviteByEmail: boolean,
): MentionTarget[] {
	const needle = query.trim().toLowerCase();

	const matches: MentionTarget[] = (users ?? [])
		.filter((u) => u.display_name.toLowerCase().includes(needle))
		.map((user) => ({ kind: "user", user }));

	if (!canInviteByEmail || !isLikelyEmail(needle)) return matches;

	// Someone already in the project should be mentioned, not re-invited.
	const alreadyAMember = (users ?? []).some(
		(u) => u.display_name.toLowerCase() === needle,
	);
	if (alreadyAMember) return matches;

	return [...matches, { kind: "email", email: needle }];
}
