import { useMemo } from "react";
import type { MentionUser } from "@/components/common/RichTextEditor/types";
import {
	useProjectMembersQuery,
	useProjectMyPermissionsQuery,
} from "./useProjectQueries";

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
 * `canInviteByEmail` gates only the affordance, and comes straight from the
 * permissions payload — one boolean the server computed from the caller's role
 * AND whether the feature is on, so a single database flip moves the server
 * behaviour and this affordance together. The write path re-checks the role
 * regardless, so a stale or spoofed `true` here buys nothing.
 */
export function useMentionUsers(projectId?: string | null): {
	mentionUsers: MentionUser[];
	canInviteByEmail: boolean;
} {
	const { data: members } = useProjectMembersQuery(projectId ?? "");
	const { data: permissions } = useProjectMyPermissionsQuery(projectId ?? "");

	// Server-computed: admin-or-stronger AND the feature switched on. Optional
	// chained so an older cached payload — or a failed fetch — degrades to "no
	// affordance" rather than offering an invite the server would refuse.
	const canInviteByEmail = Boolean(permissions?.mentions?.invite_by_email);

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

		return { mentionUsers, canInviteByEmail };
	}, [members, canInviteByEmail]);
}
