import { Link } from "@tanstack/react-router";
import { BadgeCheck, Star } from "lucide-react";

/**
 * The seller byline under the service title: avatar, name, and the one
 * credential worth carrying — verified-consultant status, then a rating once
 * reviews exist. No rating is rendered as "New seller" rather than 0.0,
 * since nothing writes ratings yet and an invented number is worse than none.
 *
 * `to` is optional: the editor shows the owner their own byline, where a link
 * back to their profile mid-edit is a trapdoor, not a feature.
 */
export function ServiceByline({
	name,
	avatarUrl,
	isVerifiedConsultant,
	stats,
	profileId,
	linkToProfile = true,
}: {
	name: string;
	avatarUrl: string | null;
	isVerifiedConsultant: boolean;
	stats: { avg_rating: number; total_reviews: number } | null;
	profileId: string;
	linkToProfile?: boolean;
}) {
	const initial = name.slice(0, 1).toUpperCase();

	const inner = (
		<>
			{avatarUrl ? (
				<img
					src={avatarUrl}
					alt={name}
					className="h-10 w-10 rounded-full object-cover"
				/>
			) : (
				<span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
					{initial}
				</span>
			)}
			<span className="min-w-0 truncate text-[15px] font-semibold text-foreground">
				{name}
			</span>
			{isVerifiedConsultant && (
				<span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-primary">
					<BadgeCheck className="h-4 w-4" />
					Verified consultant
				</span>
			)}
			<span className="inline-flex shrink-0 items-center gap-1 text-[13px] text-muted-foreground">
				{stats ? (
					<>
						<Star className="h-3.5 w-3.5 text-amber-500" />
						{stats.avg_rating.toFixed(1)}
						<span>({stats.total_reviews})</span>
					</>
				) : (
					"New seller"
				)}
			</span>
		</>
	);

	if (!linkToProfile) {
		return <div className="flex items-center gap-3">{inner}</div>;
	}

	return (
		<Link
			// A published offering guarantees the seller is an active consultant
			// or active talent; the flag picks the persona page.
			to={
				isVerifiedConsultant
					? "/marketplace/consultant/$profileId"
					: "/marketplace/talent/$profileId"
			}
			params={{ profileId }}
			className="flex items-center gap-3 transition-opacity hover:opacity-80"
		>
			{inner}
		</Link>
	);
}
