import { User } from "lucide-react";
import type { ProfileSummary } from "@/services/teams.service";

interface MemberDisplayProps {
	user: ProfileSummary | null | undefined;
	fallbackId?: string;
	subtitle?: string;
	size?: "sm" | "md";
}

/**
 * Compact "avatar + name + (subtitle)" row for team / project members.
 * Falls back to email or user_id when display_name is missing.
 */
export function MemberDisplay({
	user,
	fallbackId,
	subtitle,
	size = "md",
}: MemberDisplayProps) {
	const name = displayNameOf(user, fallbackId);
	const initials = initialsOf(name);
	const avatarSize = size === "sm" ? "h-7 w-7 text-[11px]" : "h-9 w-9 text-xs";
	const nameClass =
		size === "sm" ? "text-xs font-medium" : "text-sm font-medium";

	return (
		<div className="flex items-center gap-3 min-w-0">
			<div
				className={`flex shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 ${avatarSize}`}
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
			<div className="min-w-0">
				<p className={`${nameClass} truncate text-slate-900`}>{name}</p>
				{subtitle && (
					<p className="mt-0.5 truncate text-xs uppercase tracking-wide text-slate-500">
						{subtitle}
					</p>
				)}
			</div>
		</div>
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

function initialsOf(name: string): string {
	return name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0])
		.join("")
		.toUpperCase();
}
