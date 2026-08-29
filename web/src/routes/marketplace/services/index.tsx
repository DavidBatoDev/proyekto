import {
	createFileRoute,
	Link,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import { Loader2, Plus } from "lucide-react";
import { MarketplaceFooter } from "@/components/marketplace/MarketplaceFooter";
import { ServiceMineCard } from "@/components/marketplace/services/ServiceMineCard";
import { readError } from "@/components/marketplace/wizard/helpers";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import {
	useCreateServiceOfferingMutation,
	useMyServiceOfferingsQuery,
} from "@/hooks/useServiceOfferings";
import { useToast } from "@/hooks/useToast";
import { isActiveConsultant } from "@/lib/auth-utils";
import { useAuthStore } from "@/stores/authStore";

/**
 * The seller's service catalog — "My services". The server guard
 * (SellerOnlyGuard) is the real boundary; this page's eligibility check is
 * UX only, pointing non-sellers at the storefront instead of a 403.
 */
export const Route = createFileRoute("/marketplace/services/")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) throw redirect({ to: "/auth/login" });
	},
	component: MyServicesPage,
});

function MyServicesPage() {
	const navigate = useNavigate();
	const toast = useToast();
	const { data: profile, isLoading: profileLoading } = useProfileQuery();

	const isSeller =
		isActiveConsultant(profile) || profile?.talent_status === "active";
	const isPausedTalent = profile?.talent_status === "paused";

	const offeringsQuery = useMyServiceOfferingsQuery(!!isSeller);
	const createMutation = useCreateServiceOfferingMutation();

	const createService = async () => {
		try {
			const service = await createMutation.mutateAsync({
				title: "Untitled service",
			});
			await navigate({
				to: "/marketplace/services/$serviceId/edit",
				params: { serviceId: service.id },
			});
		} catch (cause) {
			toast.error(readError(cause));
		}
	};

	if (profileLoading) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background pt-app-header">
				<Loader2 className="h-8 w-8 animate-spin text-primary" />
			</div>
		);
	}

	if (!isSeller) {
		return (
			<div className="flex min-h-screen flex-col bg-background pt-app-header">
				<div className="flex flex-1 items-center justify-center px-4">
					<div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center">
						<h1 className="text-lg font-semibold text-foreground">
							Service offerings are for sellers on Proyekto
						</h1>
						<p className="mt-1 text-sm leading-relaxed text-muted-foreground">
							{isPausedTalent
								? "Your talent listing is paused — resume it from your profile to sell services again."
								: "List your work as talent, or become a verified consultant, and you can sell productised services here."}
						</p>
						<Link
							to="/start-selling"
							className="mt-5 inline-block rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
						>
							Start selling
						</Link>
					</div>
				</div>
				<MarketplaceFooter />
			</div>
		);
	}

	const offerings = offeringsQuery.data ?? [];

	return (
		<div className="flex min-h-screen flex-col bg-background pt-app-header">
			<div className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
				<div className="flex items-center justify-between gap-3">
					<div>
						<h1 className="text-2xl font-semibold tracking-tight text-foreground">
							Your services
						</h1>
						<p className="mt-1 text-sm text-muted-foreground">
							Productised offerings buyers can compare and contact you about.
						</p>
					</div>
					<button
						type="button"
						onClick={() => void createService()}
						disabled={createMutation.isPending}
						className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
					>
						{createMutation.isPending ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Plus className="h-4 w-4" />
						)}
						New service
					</button>
				</div>

				<div className="mt-6 space-y-3">
					{offeringsQuery.isLoading && (
						<div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
							<Loader2 className="h-4 w-4 animate-spin" />
							Loading your services…
						</div>
					)}
					{!offeringsQuery.isLoading && offerings.length === 0 && (
						<div className="rounded-2xl border border-dashed border-input p-10 text-center text-sm text-muted-foreground">
							Nothing listed yet. Create your first service and add its packages
							— it stays a draft until you publish.
						</div>
					)}
					{offerings.map((service) => (
						<ServiceMineCard key={service.id} service={service} />
					))}
				</div>
			</div>
			<MarketplaceFooter />
		</div>
	);
}
