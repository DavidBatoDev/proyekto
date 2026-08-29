import { Check, Clock, RefreshCw } from "lucide-react";
import { useState } from "react";
import { formatPrice } from "@/components/marketplace/consultant/ConsultantServices";
import { cn } from "@/lib/utils";
import type { ServiceOfferingPackage } from "@/queries/serviceOfferings";
import { ContactSellerButton } from "./ContactSellerButton";

/**
 * The sticky right rail: the seller's tiers as tabs (their own titles — the
 * tier list is whatever they defined, not a fixed trio), then the selected
 * tier's price, delivery, revisions and inclusions, and the contact CTA
 * carrying that tier.
 */
export function ServicePackagesRail({
	serviceId,
	sellerId,
	serviceTitle,
	currency,
	packages,
}: {
	serviceId: string;
	sellerId: string;
	serviceTitle: string;
	currency: string;
	packages: ServiceOfferingPackage[];
}) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selected =
		packages.find((pkg) => pkg.id === selectedId) ?? packages[0] ?? null;

	if (!selected) {
		return (
			<div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
				This seller has not published packages for this service yet.
			</div>
		);
	}

	return (
		<div className="overflow-hidden rounded-2xl border border-border bg-card">
			{packages.length > 1 && (
				<div className="flex overflow-x-auto border-b border-border hide-scrollbar">
					{packages.map((pkg) => (
						<button
							key={pkg.id}
							type="button"
							onClick={() => setSelectedId(pkg.id)}
							aria-pressed={pkg.id === selected.id}
							className={cn(
								"min-w-0 flex-1 cursor-pointer whitespace-nowrap border-b-2 px-4 py-3 text-[13px] font-semibold transition-colors",
								pkg.id === selected.id
									? "border-primary text-foreground"
									: "border-transparent text-muted-foreground hover:text-foreground",
							)}
						>
							{pkg.title}
						</button>
					))}
				</div>
			)}

			<div className="space-y-4 p-5">
				<div className="flex items-baseline justify-between gap-3">
					<h3 className="min-w-0 truncate text-[15px] font-semibold text-foreground">
						{selected.title}
					</h3>
					<p className="shrink-0 text-2xl font-semibold tracking-tight text-foreground">
						{formatPrice(selected.price, currency)}
					</p>
				</div>

				{selected.description && (
					<p className="text-[13px] leading-relaxed text-muted-foreground">
						{selected.description}
					</p>
				)}

				<div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
					{selected.delivery_days !== null && (
						<span className="inline-flex items-center gap-1.5">
							<Clock className="h-3.5 w-3.5" />
							{selected.delivery_days}-day delivery
						</span>
					)}
					<span className="inline-flex items-center gap-1.5">
						<RefreshCw className="h-3.5 w-3.5" />
						{selected.revisions === null
							? "Unlimited revisions"
							: `${selected.revisions} revision${selected.revisions === 1 ? "" : "s"}`}
					</span>
				</div>

				{selected.features.length > 0 && (
					<ul className="space-y-1.5">
						{selected.features.map((feature) => (
							<li
								key={feature}
								className="flex items-start gap-2 text-[13px] text-foreground"
							>
								<Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
								{feature}
							</li>
						))}
					</ul>
				)}

				<ContactSellerButton
					serviceId={serviceId}
					sellerId={sellerId}
					serviceTitle={serviceTitle}
					currency={currency}
					selectedPackage={selected}
				/>
			</div>
		</div>
	);
}
