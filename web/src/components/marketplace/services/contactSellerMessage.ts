import { formatPrice } from "@/components/marketplace/consultant/ConsultantServices";
import type { ServiceOfferingPackage } from "@/queries/serviceOfferings";

/**
 * The draft the contact CTA seeds into the DM composer. Pure so it can be
 * tested without a chat surface: the buyer sees exactly this in the input,
 * edits or sends it themselves — nothing is ever sent on their behalf.
 */
export function contactSellerMessage(
	serviceTitle: string,
	currency: string,
	pkg?: Pick<ServiceOfferingPackage, "title" | "price"> | null,
): string {
	if (!pkg) {
		return `Hi — I'm interested in your service "${serviceTitle}".`;
	}
	return `Hi — I'm interested in your service "${serviceTitle}" (${pkg.title}, ${formatPrice(pkg.price, currency)}).`;
}
