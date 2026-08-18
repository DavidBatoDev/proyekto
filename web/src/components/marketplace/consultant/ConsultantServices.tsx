import { Clock } from "lucide-react";
import type { ConsultantPublicService } from "@/queries/consultants";

/**
 * "See my services" — the consultant's published catalog.
 *
 * A service is a CATALOG entry, not a product with a checkout. There is no
 * "order" button because Proyekto has no ordering flow: work is agreed in a
 * signed contract, and the price here is a starting point the contract
 * negotiates from. The card says "From" for exactly that reason.
 */
export function ConsultantServices({
	services,
	isOwner,
	name,
}: {
	services: ConsultantPublicService[];
	isOwner: boolean;
	name: string;
}) {
	if (services.length === 0) {
		return (
			<p className="mt-3 max-w-2xl text-[15px] text-muted-foreground">
				{isOwner
					? "You have not published a service yet. A service is a reusable offering with a starting price — publish one and clients can see what you do and what it costs to begin."
					: `${name} has not published any services yet.`}
			</p>
		);
	}

	return (
		<div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
			{services.map((service) => (
				<ServiceCard key={service.id} service={service} />
			))}
		</div>
	);
}

function ServiceCard({ service }: { service: ConsultantPublicService }) {
	return (
		<article className="flex flex-col overflow-hidden rounded-xl border border-border transition-colors hover:border-foreground/30">
			{/* Only when there is one. An empty band reserved for a cover the
			    consultant never uploaded is a third of the card doing nothing,
			    and a stock placeholder would imply they chose it. */}
			{service.cover_url && (
				<img
					src={service.cover_url}
					alt={service.title}
					className="h-32 w-full object-cover"
					loading="lazy"
				/>
			)}

			<div className="flex flex-1 flex-col p-4">
				<h3 className="text-[15px] font-semibold leading-snug text-foreground">
					{service.title}
				</h3>

				{service.description && (
					<p className="mt-1.5 line-clamp-3 text-[14px] leading-relaxed text-muted-foreground">
						{service.description}
					</p>
				)}

				{service.delivery_days !== null && (
					<p className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
						<Clock className="h-3.5 w-3.5 shrink-0" />
						{service.delivery_days} day
						{service.delivery_days === 1 ? "" : "s"} delivery
					</p>
				)}

				{/* Pinned to the bottom so prices line up across a ragged row of
				    cards, which is what makes them comparable at a glance. */}
				<div className="mt-auto pt-4">
					<p className="text-[13px] text-muted-foreground">From</p>
					<p className="text-[17px] font-bold text-foreground">
						{formatPrice(service.starting_price, service.currency)}
						<span className="ml-1 text-[14px] font-normal text-muted-foreground">
							/ {service.price_unit}
						</span>
					</p>
				</div>
			</div>
		</article>
	);
}

/**
 * Prices arrive as numbers in the service's own currency. Formatted with
 * `Intl` so a PHP rate reads as ₱ and a USD one as $ — the consultant sets the
 * currency, and showing every price with a dollar sign would misstate it.
 */
export function formatPrice(amount: number | null, currency: string): string {
	if (amount === null) return "—";
	try {
		return new Intl.NumberFormat(undefined, {
			style: "currency",
			currency,
			maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
		}).format(amount);
	} catch {
		// An unrecognised ISO code must not blank the price.
		return `${currency} ${amount}`;
	}
}
