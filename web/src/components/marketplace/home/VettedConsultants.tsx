import { Link } from "@tanstack/react-router";
import { BadgeCheck, MapPin } from "lucide-react";
import { useConsultantsQuery } from "@/hooks/useConsultants";

/**
 * Verified consultants, straight from the public `/api/consultants` endpoint,
 * which already filters to `consultant_profiles.status = 'verified'`.
 *
 * Cards show only fields that exist: name, headline, location, bio. There are
 * no ratings, rates or badges on a consultant yet, and inventing them here
 * would be the kind of placeholder that quietly becomes a promise.
 */
export function VettedConsultants() {
	const { data: consultants, isPending } = useConsultantsQuery();
	const items = consultants?.slice(0, 4) ?? [];
	if (!isPending && items.length === 0) return null;

	return (
		<section className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
			<div className="flex items-end justify-between gap-4">
				<div>
					<h2 className="text-[17px] font-semibold text-foreground">
						Vetted consultants
					</h2>
					<p className="mt-0.5 text-[13px] text-muted-foreground">
						Every one reviewed and verified before they can take work.
					</p>
				</div>
				<Link
					to="/marketplace/consultant/browse"
					className="shrink-0 text-[13px] font-medium text-primary hover:underline"
				>
					See all
				</Link>
			</div>

			<div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{isPending
					? Array.from({ length: 4 }, (_, index) => (
							<div
								key={`consultant-skeleton-${index}`}
								className="h-[124px] animate-pulse rounded-xl border border-border bg-card"
							/>
						))
					: items.map((consultant) => {
							const name =
								consultant.display_name ||
								`${consultant.first_name ?? ""} ${consultant.last_name ?? ""}`.trim() ||
								"Consultant";
							const place = [consultant.city, consultant.country]
								.filter(Boolean)
								.join(", ");
							return (
								<Link
									key={consultant.id}
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
						})}
			</div>
		</section>
	);
}
