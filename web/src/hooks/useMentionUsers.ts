import { useMemo } from "react";
import type { MentionUser } from "@/components/common/RichTextEditor/types";
import { useProjectMembersQuery } from "./useProjectQueries";

/**
 * Mention candidates for a project's comment boxes.
 *
 * Exists because the same derivation was previously inlined in exactly one
 * place (the task side panel) and simply absent from the other five comment
 * boxes, so `@` did nothing in epic and feature comments. Going through
 * `useProjectMembersQuery` also means the member list is fetched once and
 * shared across every comment box on the page, rather than re-fetched per
 * panel.
 *
 * `canInviteByEmail` gates only the affordance. The server re-checks that the
 * author is a project admin before creating an invite, so a stale or spoofed
 * `true` here buys nothing.
 */
export function useMentionUsers(projectId?: string | null): {
	mentionUsers: MentionUser[];
	canInviteByEmail: boolean;
} {
	const { data: members } = useProjectMembersQuery(projectId ?? "");

	return useMemo(() => {
		const list = (members ?? []) as {
			user_id?: string | null;
			role?: string | null;
			user?: { display_name?: string | null; avatar_url?: string | null };
		}[];

		const mentionUsers: MentionUser[] = list
			.filter((m) => Boolean(m.user_id))
			.map((m) => ({
				id: m.user_id as string,
				display_name: m.user?.display_name || "Unknown",
				avatar_url: m.user?.avatar_url ?? null,
			}));

		return {
			mentionUsers,
			// Hardcoded false until activation, on purpose. Showing "Invite
			// <address>" while the server flag is off would render an affordance
			// that silently does nothing — worse than not offering it. Wiring this
			// to the real value (project admin AND the server flag, surfaced on the
			// permissions payload) is part of turning the feature on, so that one
			// lever moves both sides at once.
			canInviteByEmail: false,
		};
	}, [members]);
}
