export function ChatAvatar({
	name,
	avatarUrl,
	team,
	size = "md",
}: {
	name: string;
	avatarUrl?: string | null;
	team?: { name: string; avatar_url: string | null } | null;
	size?: "sm" | "md" | "lg";
}) {
	const initials = name
		.split(" ")
		.map((part) => part[0] || "")
		.join("")
		.slice(0, 2)
		.toUpperCase();

	const sizeClass =
		size === "sm"
			? "w-7 h-7 text-[11px]"
			: size === "lg"
				? "w-10 h-10 text-xs"
				: "w-8 h-8 text-[11px]";

	const avatar = avatarUrl ? (
		<img
			src={avatarUrl}
			alt={name}
			className={`${sizeClass} rounded-full object-cover object-top shrink-0`}
		/>
	) : (
		<div
			className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full bg-slate-100 font-semibold text-slate-700`}
		>
			{initials || "?"}
		</div>
	);

	if (!team) return avatar;

	const markSize = size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5";
	return (
		<span className="relative shrink-0" title={`On ${team.name}`}>
			{avatar}
			{team.avatar_url ? (
				<img
					src={team.avatar_url}
					alt=""
					className={`absolute -bottom-0.5 -right-0.5 ${markSize} rounded-[3px] object-cover ring-2 ring-white`}
				/>
			) : (
				<span
					className={`absolute -bottom-0.5 -right-0.5 ${markSize} flex items-center justify-center rounded-[3px] bg-primary text-[7px] font-bold uppercase text-white ring-2 ring-white`}
				>
					{team.name.charAt(0)}
				</span>
			)}
		</span>
	);
}
