/**
 * Team avatar — the team photo when `avatar_url` is set, otherwise a
 * rounded initial-letter fallback (first character of the team name).
 *
 * Shared across the left-rail team group, the dashboard "TEAMS" cards,
 * the team general-settings preview, and the team-detail header so the
 * same team always renders the same way.
 */

type TeamAvatarSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<
	TeamAvatarSize,
	{ box: string; radius: string; text: string }
> = {
	// Left-rail team group.
	sm: { box: "h-5 w-5", radius: "rounded-md", text: "text-[10px]" },
	// Dashboard cards + team-detail header.
	md: { box: "h-10 w-10", radius: "rounded-xl", text: "text-sm" },
	// Settings preview.
	lg: { box: "h-16 w-16", radius: "rounded-2xl", text: "text-2xl" },
};

export function TeamAvatar({
	team,
	size = "md",
	className = "",
}: {
	team: { name: string | null; avatar_url: string | null };
	size?: TeamAvatarSize;
	className?: string;
}) {
	const { box, radius, text } = SIZE_CLASSES[size];

	if (team.avatar_url) {
		return (
			<img
				src={team.avatar_url}
				alt={team.name ?? "Team"}
				className={`${box} ${radius} shrink-0 object-cover ${className}`}
			/>
		);
	}

	const initial = (team.name?.trim()[0] || "T").toUpperCase();
	return (
		<div
			className={`flex ${box} ${radius} shrink-0 items-center justify-center bg-slate-100 font-semibold text-slate-700 ${text} ${className}`}
		>
			{initial}
		</div>
	);
}
