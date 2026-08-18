import { Link } from "@tanstack/react-router";
import {
	CONSULTANT_CARD_SKELETON_CLASS,
	ConsultantCard,
} from "@/components/marketplace/ConsultantCard";
import { useConsultantsQuery } from "@/hooks/useConsultants";

/**
 * Verified consultants, straight from the public `/api/consultants` endpoint,
 * which already filters to `consultant_profiles.status = 'verified'`.
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
								className={CONSULTANT_CARD_SKELETON_CLASS}
							/>
						))
					: items.map((consultant) => (
							<ConsultantCard key={consultant.id} consultant={consultant} />
						))}
			</div>
		</section>
	);
}
