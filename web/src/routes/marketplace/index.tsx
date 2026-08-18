import { createFileRoute } from "@tanstack/react-router";
import { FeaturedSolutions } from "@/components/marketplace/home/FeaturedSolutions";
import { MarketplaceCategoryBar } from "@/components/marketplace/home/MarketplaceCategoryBar";
import { MarketplaceHero } from "@/components/marketplace/home/MarketplaceHero";
import { VettedConsultants } from "@/components/marketplace/home/VettedConsultants";
import { WhyProyekto } from "@/components/marketplace/home/WhyProyekto";
import { MarketplaceFooter } from "@/components/marketplace/MarketplaceFooter";

/**
 * The marketplace home.
 *
 * Public on purpose — it is the storefront, so it renders for anonymous
 * visitors as well as signed-in ones, and every section degrades to nothing
 * rather than erroring when its data is empty. It deliberately does NOT use
 * MarketplaceShell: the shell carries ProtectedRoute and the authenticated
 * sidebar, neither of which belongs on a page whose job is to be the front
 * door. The global header still renders above it.
 *
 * Sections live in components/marketplace/home/ rather than inline, because
 * this repo already has two 1400-line route files and neither is a pleasure.
 */
export const Route = createFileRoute("/marketplace/")({
	component: MarketplaceHome,
});

function MarketplaceHome() {
	return (
		<div className="min-h-screen bg-background pt-app-header">
			<MarketplaceCategoryBar />
			<MarketplaceHero />
			<FeaturedSolutions />
			<VettedConsultants />
			<WhyProyekto />
			<MarketplaceFooter />
		</div>
	);
}
