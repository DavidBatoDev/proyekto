const SIZE = {
	sm: "h-8 w-8 text-xs",
	md: "h-10 w-10 text-sm",
	lg: "h-12 w-12 text-base",
} as const;

function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "?";
	return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : ""))
		.toUpperCase()
		.slice(0, 2);
}

/** A round avatar for the safety surfaces: the photo, or initials on a tint. */
export function PersonAvatar({
	name,
	avatarUrl,
	size = "md",
}: {
	name: string;
	avatarUrl?: string | null;
	size?: keyof typeof SIZE;
}) {
	if (avatarUrl) {
		return (
			<img
				src={avatarUrl}
				alt=""
				className={`${SIZE[size]} shrink-0 rounded-full object-cover ring-1 ring-border`}
			/>
		);
	}
	return (
		<span
			aria-hidden="true"
			className={`${SIZE[size]} flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary`}
		>
			{initials(name)}
		</span>
	);
}
