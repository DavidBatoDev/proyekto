import { Link } from "@tanstack/react-router";
import { Clock, Layers, Settings2 } from "lucide-react";
import { formatPrice } from "@/components/marketplace/consultant/ConsultantServices";
import { usePublicServiceOfferingsByUserQuery } from "@/hooks/useServiceOfferings";

/**
 * "Services" on a public profile — the talent-page counterpart of the
 * consultant profile's catalog grid, fed by the anonymous by-user read
 * (published offerings only). Self-contained so the 2000-line profile route
 * only mounts it: renders nothing for visitors when the seller has no
 * published services, and a manage prompt for the owner.
 */
export function ProfileServicesSection({
	userId,
	isOwner,
}: {
	userId: string;
	isOwner: boolean;
}) {
	const query = usePublicServiceOfferingsByUserQuery(userId);
	const services = query.data ?? [];

	if (!isOwner && services.length === 0) return null;

	return (
		<div className="rounded-2xl border border-border bg-card p-6">
			<div className="mb-4 flex items-center justify-between gap-3">
				<h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
					<Layers className="h-4.5 w-4.5 text-primary" />
					Services
				</h2>
				{isOwner && (
					<Link
						to="/marketplace/services"
						className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
					>
						<Settings2 className="h-3.5 w-3.5" />
						Manage services
					</Link>
				)}
			</div>

			{services.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					Offer productised services — a fixed scope with tiered pricing that
					buyers can compare and contact you about.{" "}
					<Link
						to="/marketplace/services"
						className="font-medium text-primary hover:underline"
					>
						Create your first service
					</Link>
					.
				</p>
			) : (
				<div className="grid gap-4 sm:grid-cols-2">
					{services.map((service) => (
						<Link
							key={service.id}
							to="/marketplace/services/$serviceId"
							params={{ serviceId: service.id }}
							className="flex flex-col overflow-hidden rounded-xl border border-border transition-colors hover:border-foreground/30"
						>
							{service.cover_url && (
								<img
									src={service.cover_url}
									alt={service.title}
									className="h-28 w-full object-cover"
									loading="lazy"
								/>
							)}
							<div className="flex flex-1 flex-col p-4">
								<h3 className="text-[15px] font-semibold leading-snug text-foreground">
									{service.title}
								</h3>
								{service.delivery_days !== null && (
									<p className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
										<Clock className="h-3.5 w-3.5 shrink-0" />
										{service.delivery_days} day
										{service.delivery_days === 1 ? "" : "s"} delivery
									</p>
								)}
								<div className="mt-auto pt-3">
									<p className="text-[13px] text-muted-foreground">From</p>
									<p className="text-[17px] font-bold text-foreground">
										{formatPrice(service.starting_price, service.currency)}
									</p>
								</div>
							</div>
						</Link>
					))}
				</div>
			)}
		</div>
	);
}
