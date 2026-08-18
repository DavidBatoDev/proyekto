import { Link } from "@tanstack/react-router";
import { BadgeCheck, MapPin } from "lucide-react";
import type { Profile } from "@/types/profile.types";

/**
 * The consultant card shared by the marketplace home strip and the category
 * landing pages.
 *
 * Shows only fields that actually exist on a consultant: name, headline,
 * location, bio. There are no ratings, rates or badges in the model yet, and
 * inventing them here would be the kind of placeholder that quietly becomes a
 * promise.
 */
export function ConsultantCard({ consultant }: { consultant: Profile }) {
	const name =
		consultant.display_name ||
		`${consultant.first_name ?? ""} ${consultant.last_name ?? ""}`.trim() ||
		"Consultant";
	const place = [consultant.city, consultant.country]
		.filter(Boolean)
		.join(", ");

	return (
		<Link
			to="/marketplace/consultant/$profileId"
			params={{ profileId: consultant.id }}
			preload="intent"
			className="flex flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
		>
			<span className="flex items-center gap-2.5">
				{consultant.avatar_url ? (
					<img
						src={consultant.avatar_url}
						alt=""
						className="h-9 w-9 rounded-full object-cover"
					/>
				) : (
					<span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-[13px] font-semibold text-primary">
						{name.charAt(0).toUpperCase()}
					</span>
				)}
				<span className="min-w-0">
					<span className="flex items-center gap-1">
						<span className="truncate text-[13.5px] font-semibold text-foreground">
							{name}
						</span>
						<BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
					</span>
					{place && (
						<span className="mt-0.5 flex items-center gap-1 text-[12px] text-muted-foreground">
							<MapPin className="h-3 w-3" />
							{place}
						</span>
					)}
				</span>
			</span>
			<span className="mt-2.5 line-clamp-2 text-[12.5px] text-muted-foreground">
				{consultant.headline || consultant.bio || "Consultant"}
			</span>
		</Link>
	);
}

/** Matches the card's rendered height so the grid does not jump on load. */
export const CONSULTANT_CARD_SKELETON_CLASS =
	"h-[124px] animate-pulse rounded-xl border border-border bg-card";
