import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Loader2 } from "lucide-react";
import { MarketplaceFooter } from "@/components/marketplace/MarketplaceFooter";
import { ServiceActionsBar } from "@/components/marketplace/services/ServiceActionsBar";
import { ServiceByline } from "@/components/marketplace/services/ServiceByline";
import { ServiceGallery } from "@/components/marketplace/services/ServiceGallery";
import { ServicePackagesRail } from "@/components/marketplace/services/ServicePackagesRail";
import { ServiceSectionView } from "@/components/marketplace/services/ServiceSectionView";
import { ServiceSellerCard } from "@/components/marketplace/services/ServiceSellerCard";
import { usePublicServiceOfferingQuery } from "@/hooks/useServiceOfferings";

/**
 * A service offering's public page — the Fiverr-gig shape: gallery + about
 * on the left, seller-titled package tiers and the contact CTA in a sticky
 * right rail. Public and anonymous-readable; the backend already refuses
 * drafts and inactive sellers, so a 404 here is the only failure mode.
 */
export const Route = createFileRoute("/marketplace/services/$serviceId/")({
	component: ServiceDetailPage,
});

function ServiceDetailPage() {
	const { serviceId } = Route.useParams();
	const query = usePublicServiceOfferingQuery(serviceId);
	const service = query.data;

	if (query.isLoading) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background pt-app-header">
				<Loader2 className="h-8 w-8 animate-spin text-primary" />
			</div>
		);
	}

	if (!service) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background px-4 pt-app-header">
				<div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center">
					<h1 className="text-lg font-semibold text-foreground">
						This service is not available
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						It may be unpublished, or its seller is no longer listed.
					</p>
					<Link
						to="/marketplace"
						className="mt-5 inline-block rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
					>
						Back to the marketplace
					</Link>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-background pt-app-header">
			<div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-10">
				{service.subcategory && (
					<nav
						aria-label="Breadcrumb"
						className="mb-4 flex items-center gap-1 text-[13px] text-muted-foreground"
					>
						<Link
							to="/marketplace/category/$categorySlug"
							params={{ categorySlug: service.subcategory.category_slug }}
							className="hover:text-foreground"
						>
							{service.subcategory.category_slug.replace(/-/g, " ")}
						</Link>
						<ChevronRight className="h-3.5 w-3.5" />
						<Link
							to="/marketplace/category/$categorySlug/$subcategorySlug"
							params={{
								categorySlug: service.subcategory.category_slug,
								subcategorySlug: service.subcategory.slug,
							}}
							className="hover:text-foreground"
						>
							{service.subcategory.name}
						</Link>
					</nav>
				)}

				<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
					<div className="min-w-0 space-y-8">
						<div className="space-y-4">
							<h1 className="text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">
								{service.title}
							</h1>
							<ServiceByline
								name={service.seller.display_name ?? "Seller"}
								avatarUrl={service.seller.avatar_url}
								isVerifiedConsultant={service.seller.is_verified_consultant}
								stats={service.seller.stats}
								profileId={service.seller.id}
							/>
						</div>

						<ServiceGallery
							title={service.title}
							coverUrl={service.cover_url}
							galleryUrls={service.gallery_urls}
						/>

						{(service.description_sections ?? []).map((section, index) => (
							<ServiceSectionView
								key={`${section.heading ?? "section"}-${index}`}
								section={section}
							/>
						))}
					</div>

					<div className="space-y-4 lg:sticky lg:top-[88px] lg:self-start">
						<ServiceActionsBar
							serviceId={service.id}
							publicLikeCount={service.like_count ?? 0}
						/>
						<ServicePackagesRail
							serviceId={service.id}
							sellerId={service.seller.id}
							serviceTitle={service.title}
							currency={service.currency}
							packages={service.packages}
						/>
						<ServiceSellerCard
							serviceId={service.id}
							serviceTitle={service.title}
							currency={service.currency}
							seller={service.seller}
						/>
					</div>
				</div>
			</div>
			<MarketplaceFooter />
		</div>
	);
}
