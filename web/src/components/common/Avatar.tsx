import { Building2, User } from "lucide-react";
import type { ProfileSummary } from "@/services/teams.service";

/**
 * A person's avatar, optionally carrying a corner badge.
 *
 * The badge is the Slack pattern: a small square in the bottom-right that says
 * *where this person comes from*. On the project People surface that is what
 * distinguishes an internal teammate (their team's logo) from an external
 * client — a distinction the data has always carried in `project_access.origin`
 * but which never surfaced anywhere the eye could catch it.
 *
 * `MemberDisplay` renders this internally, so its existing call sites get the
 * capability without changing.
 */

export type AvatarSize = "xs" | "sm" | "md" | "lg";

export type AvatarBadge =
	| {
			kind: "team";
			team: { name: string | null; avatar_url: string | null };
			title?: string;
	  }
	| { kind: "external"; title?: string };

const BOX: Record<AvatarSize, string> = {
	xs: "h-6 w-6 text-[10px]",
	sm: "h-7 w-7 text-[11px]",
	md: "h-9 w-9 text-xs",
	lg: "h-11 w-11 text-sm",
};

const BADGE_BOX: Record<AvatarSize, string> = {
	xs: "h-2.5 w-2.5 text-[6px]",
	sm: "h-3 w-3 text-[7px]",
	md: "h-3.5 w-3.5 text-[8px]",
	lg: "h-4 w-4 text-[9px]",
};

export function Avatar({
	user,
	fallbackId,
	size = "md",
	badge,
	className,
}: {
	user: ProfileSummary | null | undefined;
	fallbackId?: string;
	size?: AvatarSize;
	badge?: AvatarBadge | null;
	className?: string;
}) {
	const name = displayNameOf(user, fallbackId);
	const initials = initialsOf(name);

	return (
		<div className={`relative shrink-0 ${className ?? ""}`}>
			<div
				className={`flex items-center justify-center rounded-full bg-muted text-muted-foreground ${BOX[size]}`}
			>
				{user?.avatar_url ? (
					<img
						src={user.avatar_url}
						alt={name}
						className="h-full w-full rounded-full object-cover"
					/>
				) : initials ? (
					<span className="font-semibold uppercase">{initials}</span>
				) : (
					<User className="h-4 w-4" />
				)}
			</div>
			{badge && <AvatarBadgeMark badge={badge} size={size} />}
		</div>
	);
}

function AvatarBadgeMark({
	badge,
	size,
}: {
	badge: AvatarBadge;
	size: AvatarSize;
}) {
	// ring-card, not ring-white: the badge has to read as separate from the
	// avatar in both themes.
	const base = `absolute -bottom-0.5 -right-0.5 flex items-center justify-center overflow-hidden rounded-[3px] ring-2 ring-card ${BADGE_BOX[size]}`;

	if (badge.kind === "external") {
		return (
			<span
				className={`${base} bg-amber-500 font-bold text-white`}
				title={badge.title ?? "External — not part of your organisation"}
			>
				<Building2 className="h-2 w-2" />
			</span>
		);
	}

	const label = badge.team.name?.trim() || "Team";
	return badge.team.avatar_url ? (
		<img
			src={badge.team.avatar_url}
			alt=""
			title={badge.title ?? label}
			className={`${base} object-cover`}
		/>
	) : (
		<span
			className={`${base} bg-primary font-bold uppercase text-primary-foreground`}
			title={badge.title ?? label}
		>
			{label.charAt(0)}
		</span>
	);
}

export function displayNameOf(
	user: ProfileSummary | null | undefined,
	fallbackId?: string,
): string {
	if (user?.display_name) return user.display_name;
	const composed = [user?.first_name, user?.last_name]
		.filter(Boolean)
		.join(" ");
	if (composed) return composed;
	if (user?.email) return user.email;
	if (fallbackId) return fallbackId.slice(0, 8);
	return "Unknown";
}

export function initialsOf(name: string): string {
	return name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0])
		.join("")
		.toUpperCase();
}
