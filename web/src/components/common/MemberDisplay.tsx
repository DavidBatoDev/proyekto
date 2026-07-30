import type { ReactNode } from "react";
import {
	Avatar,
	type AvatarBadge,
	displayNameOf,
} from "@/components/common/Avatar";
import type { ProfileSummary } from "@/services/teams.service";

interface MemberDisplayProps {
	user: ProfileSummary | null | undefined;
	fallbackId?: string;
	subtitle?: string;
	/** Optional rich subtitle (e.g. chips). Takes precedence over `subtitle`. */
	subtitleSlot?: ReactNode;
	size?: "sm" | "md";
	/** Corner mark on the avatar — team logo, or an external marker. */
	badge?: AvatarBadge | null;
}

/**
 * Compact "avatar + name + (subtitle)" row for team / project members.
 * Falls back to email or user_id when display_name is missing.
 *
 * The avatar itself lives in `Avatar` so the badge behaviour is shared with
 * surfaces that render an avatar without this wrapper.
 */
export function MemberDisplay({
	user,
	fallbackId,
	subtitle,
	subtitleSlot,
	size = "md",
	badge,
}: MemberDisplayProps) {
	const name = displayNameOf(user, fallbackId);
	const nameClass =
		size === "sm" ? "text-xs font-medium" : "text-sm font-medium";

	return (
		<div className="flex min-w-0 items-center gap-3">
			<Avatar user={user} fallbackId={fallbackId} size={size} badge={badge} />
			<div className="min-w-0">
				<p className={`${nameClass} truncate text-foreground`}>{name}</p>
				{subtitleSlot ? (
					<div className="mt-1 flex flex-wrap items-center gap-1.5">
						{subtitleSlot}
					</div>
				) : subtitle ? (
					<p className="mt-0.5 truncate text-xs uppercase tracking-wide text-muted-foreground">
						{subtitle}
					</p>
				) : null}
			</div>
		</div>
	);
}

// Re-exported from here for the call sites that already import it from this
// module; the implementation lives in Avatar.tsx.
export { displayNameOf };
