import { Link } from "@tanstack/react-router";
import { Star } from "lucide-react";
import { formatPrice } from "@/components/marketplace/consultant/ConsultantServices";
import type { PublicServiceOfferingDetail } from "@/queries/serviceOfferings";
import { ContactSellerButton } from "./ContactSellerButton";

/**
 * Who is selling, and the hourly side-offer. The rating chip renders only
 * when reviews exist — nothing writes ratings yet, and "0.0" would be an
 * invented number; a fresh seller reads "New seller" instead.
 */
export function ServiceSellerCard({
	serviceId,
	serviceTitle,
	currency,
	seller,
}: {
	serviceId: string;
	serviceTitle: string;
	currency: string;
	seller: PublicServiceOfferingDetail["seller"];
}) {
	const name = seller.display_name ?? "Seller";
	const initial = name.slice(0, 1).toUpperCase();

	return (
		<div className="space-y-4">
			<Link
				// A published offering guarantees the seller is an active
				// consultant or active talent; the flag picks the persona page.
				to={
					seller.is_verified_consultant
						? "/marketplace/consultant/$profileId"
						: "/marketplace/talent/$profileId"
				}
				params={{ profileId: seller.id }}
				className="flex items-center gap-3"
			>
				{seller.avatar_url ? (
					<img
						src={seller.avatar_url}
						alt={name}
						className="h-12 w-12 rounded-full object-cover"
					/>
				) : (
					<span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground">
						{initial}
					</span>
				)}
				<span className="min-w-0">
					<span className="block truncate text-sm font-semibold text-foreground">
						{name}
					</span>
					{seller.headline && (
						<span className="block truncate text-xs text-muted-foreground">
							{seller.headline}
						</span>
					)}
					<span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
						{seller.stats ? (
							<>
								<Star className="h-3.5 w-3.5 text-amber-500" />
								{seller.stats.avg_rating.toFixed(1)} (
								{seller.stats.total_reviews})
							</>
						) : (
							"New seller"
						)}
					</span>
				</span>
			</Link>

			{seller.rate && (
				<div className="rounded-xl border border-border bg-muted/40 p-4">
					<p className="text-sm font-semibold text-foreground">
						Need flexibility when hiring?
					</p>
					<p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
						{name} also works by the hour — ideal for longer projects with
						evolving scope.
					</p>
					<p className="mt-2 text-sm font-semibold text-foreground">
						{formatPrice(seller.rate.hourly_rate, seller.rate.currency)}/hour
					</p>
					<div className="mt-3">
						<ContactSellerButton
							serviceId={serviceId}
							sellerId={seller.id}
							serviceTitle={serviceTitle}
							currency={currency}
							selectedPackage={null}
							label="Ask about hourly work"
						/>
					</div>
				</div>
			)}
		</div>
	);
}
