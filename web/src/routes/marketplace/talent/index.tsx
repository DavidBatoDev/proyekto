import { createFileRoute } from "@tanstack/react-router";
import { MarketplaceFooter } from "@/components/marketplace/MarketplaceFooter";
import { GoLiveChecklist } from "@/components/marketplace/talent/landing/GoLiveChecklist";
import { HowYouGetPaid } from "@/components/marketplace/talent/landing/HowYouGetPaid";
import { OpportunitiesByCategory } from "@/components/marketplace/talent/landing/OpportunitiesByCategory";
import { StartSellingCta } from "@/components/marketplace/talent/landing/StartSellingCta";
import { StartSellingHero } from "@/components/marketplace/talent/landing/StartSellingHero";
import { WhyStartSelling } from "@/components/marketplace/talent/landing/WhyStartSelling";

/**
 * The talent side's front door.
 *
 * Until this existed, the only route under `marketplace/talent/` was
 * `go-live.tsx` — an auth-gated six-step wizard — and the only way to discover
 * it was one link in the footer. `/marketplace/talent` is not the equivalent:
 * it is the consultant-only directory for browsing talent, which is the
 * opposite audience. Consultants have had a public landing page at
 * `/marketplace/consultant` all along; this is the same thing for Talent.
 *
 * Public, and no auth gate: it is a storefront, and the CTA handles the signed-
 * out case by routing through signup with a `redirect` back to go-live.
 *
 * Follows the marketplace-home pattern — global header via `pt-app-header`,
 * plus `MarketplaceFooter` — rather than the consultant landing's `root/Header`
 * + `RootFooter`. That keeps `/marketplace/*` visually one product and, in
 * passing, avoids `Header.tsx`'s double-header opt-out list entirely.
 *
 * Sections live in `components/marketplace/talent/` for the reason the
 * marketplace index gives: this repo already has two 1400-line route files.
 */
export const Route = createFileRoute("/marketplace/talent/")({
	component: StartSellingPage,
});

function StartSellingPage() {
	return (
		<div className="min-h-screen bg-background pt-app-header">
			<StartSellingHero />
			<WhyStartSelling />
			<OpportunitiesByCategory />
			<HowYouGetPaid />
			<GoLiveChecklist />
			<StartSellingCta />
			<MarketplaceFooter />
		</div>
	);
}
