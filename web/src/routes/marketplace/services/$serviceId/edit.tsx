import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import { ArrowLeft, Eye, Globe2, Loader2, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getMarketplaceCategoryNavigation } from "@/api/endpoints/marketplace-taxonomy";
import { AutoTextarea } from "@/components/common/InlineEditable";
import { ServiceByline } from "@/components/marketplace/services/ServiceByline";
import { ServiceGalleryEditor } from "@/components/marketplace/services/ServiceGalleryEditor";
import type { PackageDraft } from "@/components/marketplace/services/ServicePackagesRailEditor";
import {
	emptyPackageDraft,
	ServicePackagesRailEditor,
} from "@/components/marketplace/services/ServicePackagesRailEditor";
import type { SectionDraft } from "@/components/marketplace/services/ServiceSectionsEditor";
import {
	ServiceSectionsEditor,
	toSectionDrafts,
	toSectionPayload,
} from "@/components/marketplace/services/ServiceSectionsEditor";
import { readError } from "@/components/marketplace/wizard/helpers";
import { usePendingImages } from "@/hooks/usePendingImages";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import {
	useDeleteServiceOfferingMutation,
	useMyServiceOfferingsQuery,
	useReplaceOfferingPackagesMutation,
	useUpdateServiceOfferingMutation,
} from "@/hooks/useServiceOfferings";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import type { ServiceOffering } from "@/queries/serviceOfferings";
import { uploadService } from "@/services/upload.service";
import { useAuthStore } from "@/stores/authStore";

/**
 * The service editor — WYSIWYG: the page IS the public service page
 * (title, gallery, about on the left; the tier rail on the right), with
 * every piece editable in place. Reads through /mine (drafts included —
 * the public read refuses them), saves details/gallery via PATCH and tiers
 * via the packages replace-set, and mirrors the server's publish rule on
 * the toolbar button.
 */
export const Route = createFileRoute("/marketplace/services/$serviceId/edit")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) throw redirect({ to: "/auth/login" });
	},
	component: ServiceEditPage,
});

/** Same set the rate card offers, so a seller sees one currency vocabulary. */
const CURRENCIES = ["USD", "EUR", "GBP", "PHP", "SGD", "AUD", "CAD", "INR"];

/** The tier names buyers already recognise; sellers rename or delete freely. */
const DEFAULT_TIERS = ["Basic", "Standard", "Premium"];

function startingTier(title: string): PackageDraft {
	return { ...emptyPackageDraft(), title };
}

const inline =
	"rounded-lg bg-transparent outline-none transition-colors placeholder:text-muted-foreground/50 hover:bg-muted/60 focus:bg-muted/60";

function toPackageDrafts(service: ServiceOffering): PackageDraft[] {
	return (service.packages ?? []).map((pkg) => ({
		...emptyPackageDraft(),
		title: pkg.title,
		description: pkg.description ?? "",
		price: String(pkg.price),
		deliveryDays: pkg.delivery_days === null ? "" : String(pkg.delivery_days),
		revisions: pkg.revisions === null ? "" : String(pkg.revisions),
		features: pkg.features,
	}));
}

function ServiceEditPage() {
	const { serviceId } = Route.useParams();
	const navigate = useNavigate();
	const toast = useToast();

	const { data: ownerProfile } = useProfileQuery();
	const mineQuery = useMyServiceOfferingsQuery();
	const service = mineQuery.data?.find((item) => item.id === serviceId);

	const navigation = useQuery({
		queryKey: ["marketplace", "category-navigation"],
		queryFn: getMarketplaceCategoryNavigation,
		staleTime: 5 * 60 * 1000,
	});
	const categories = navigation.data ?? [];

	const [title, setTitle] = useState("");
	const [sections, setSections] = useState<SectionDraft[]>([]);
	const [subcategoryId, setSubcategoryId] = useState("");
	const [currency, setCurrency] = useState("USD");
	// Picked images stay local until save — see @/lib/pendingImages.
	const gallery = usePendingImages();
	const [packages, setPackages] = useState<PackageDraft[]>([]);
	// A stored currency outside the list stays selectable, so opening an old
	// service never silently re-prices it in USD.
	const currencyOptions =
		currency && !CURRENCIES.includes(currency)
			? [...CURRENCIES, currency]
			: CURRENCIES;
	const [hydrated, setHydrated] = useState(false);
	const [uploading, setUploading] = useState(false);

	useEffect(() => {
		if (!service || hydrated) return;
		setTitle(service.title);
		setSections(toSectionDrafts(service.description_sections ?? []));
		setSubcategoryId(service.subcategory_id ?? "");
		setCurrency(service.currency);
		gallery.hydrate([service.cover_url, ...service.gallery_urls]);
		const existing = toPackageDrafts(service);
		// A service with no tiers opens on the familiar three rather than an
		// empty rail — a starting shape is easier than a blank page, and any
		// tier left untouched is dropped on save.
		setPackages(existing.length ? existing : DEFAULT_TIERS.map(startingTier));
		setHydrated(true);
	}, [service, hydrated]);

	const updateMutation = useUpdateServiceOfferingMutation();
	const packagesMutation = useReplaceOfferingPackagesMutation();
	const deleteMutation = useDeleteServiceOfferingMutation();
	const isSaving =
		uploading ||
		updateMutation.isPending ||
		packagesMutation.isPending ||
		deleteMutation.isPending;

	// A tier nobody typed into is not an error, it is an unused slot — the
	// starter trio would otherwise make saving one tier impossible.
	const isBlankTier = (pkg: PackageDraft) =>
		!pkg.price.trim() &&
		!pkg.description.trim() &&
		!pkg.deliveryDays.trim() &&
		!pkg.revisions.trim() &&
		pkg.features.length === 0 &&
		(!pkg.title.trim() || DEFAULT_TIERS.includes(pkg.title.trim()));

	const filledPackages = packages.filter((pkg) => !isBlankTier(pkg));
	const validPackages = filledPackages.filter(
		(pkg) => pkg.title.trim().length >= 2 && Number.parseFloat(pkg.price) >= 0,
	);

	const save = async (statusOverride?: "published" | "draft") => {
		if (!service) return;
		if (title.trim().length < 3) {
			toast.error("Give the service a title (at least 3 characters).");
			return;
		}
		if (filledPackages.length !== validPackages.length) {
			toast.error("Every tier you filled in needs both a name and a price.");
			return;
		}
		let galleryUrls: string[];
		try {
			// Uploads happen HERE, not at pick time: validation above has already
			// passed, so nothing reaches R2 for a save that would be rejected.
			setUploading(true);
			galleryUrls = await gallery.flush((file) =>
				uploadService.uploadPortfolioImage(file),
			);
		} catch (cause) {
			toast.error(readError(cause));
			return;
		} finally {
			setUploading(false);
		}

		try {
			await packagesMutation.mutateAsync({
				id: service.id,
				packages: validPackages.map((pkg) => ({
					title: pkg.title.trim(),
					description: pkg.description.trim() || undefined,
					price: Number.parseFloat(pkg.price),
					delivery_days: pkg.deliveryDays
						? Number.parseInt(pkg.deliveryDays, 10)
						: undefined,
					revisions: pkg.revisions
						? Number.parseInt(pkg.revisions, 10)
						: undefined,
					features: pkg.features,
				})),
			});
			await updateMutation.mutateAsync({
				id: service.id,
				payload: {
					title: title.trim(),
					description_sections: toSectionPayload(sections),
					subcategory_id: subcategoryId || undefined,
					currency: currency || "USD",
					// Explicit null, not undefined: the whitelist pipe drops absent
					// keys, so `undefined` could never clear a cover.
					cover_url: galleryUrls[0] ?? null,
					gallery_urls: galleryUrls.slice(1),
					...(statusOverride ? { status: statusOverride } : {}),
				},
			});
			toast.success(
				statusOverride === "published"
					? "Service published."
					: "Service saved.",
			);
		} catch (cause) {
			toast.error(readError(cause));
		}
	};

	const remove = async () => {
		if (!service) return;
		try {
			await deleteMutation.mutateAsync(service.id);
			toast.success("Service deleted.");
			await navigate({ to: "/marketplace/services" });
		} catch (cause) {
			toast.error(readError(cause));
		}
	};

	if (mineQuery.isLoading) {
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
						Service not found
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						It may have been deleted, or it belongs to another account.
					</p>
					<Link
						to="/marketplace/services"
						className="mt-5 inline-block rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
					>
						Your services
					</Link>
				</div>
			</div>
		);
	}

	const isPublished = service.status === "published";

	return (
		<div className="min-h-screen bg-background pt-app-header">
			{/* The editor's own header, pinned under the global one — actions stay
			    in reach however far the page scrolls. */}
			<div className="sticky top-app-header z-30 border-b border-border bg-background/95 backdrop-blur">
				<div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-10">
					<div className="flex min-w-0 items-center gap-3">
						<Link
							to="/marketplace/services"
							className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
						>
							<ArrowLeft className="h-4 w-4" />
							Your services
						</Link>
						<span
							className={cn(
								"rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
								isPublished
									? "bg-primary/10 text-primary"
									: "bg-muted text-muted-foreground",
							)}
						>
							{service.status}
						</span>
					</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => void remove()}
							disabled={isSaving}
							aria-label="Delete service"
							title="Delete service"
							className="cursor-pointer rounded-xl border border-border p-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-50"
						>
							<Trash2 className="h-4 w-4" />
						</button>
						{isPublished && (
							<Link
								to="/marketplace/services/$serviceId"
								params={{ serviceId: service.id }}
								className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
							>
								<Eye className="h-4 w-4" />
								View live
							</Link>
						)}
						<button
							type="button"
							onClick={() => void save()}
							disabled={isSaving}
							className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
						>
							{isSaving ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Save className="h-4 w-4" />
							)}
							Save
						</button>
						<button
							type="button"
							onClick={() => void save(isPublished ? "draft" : "published")}
							disabled={
								isSaving || (!isPublished && validPackages.length === 0)
							}
							title={
								!isPublished && validPackages.length === 0
									? "Add at least one tier with a title and price before publishing."
									: undefined
							}
							className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
						>
							<Globe2 className="h-4 w-4" />
							{isPublished ? "Unpublish" : "Publish"}
						</button>
					</div>
				</div>
			</div>

			<div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-10">
				{/* Where the breadcrumb sits on the live page: placement + currency. */}
				<div className="mb-4 flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground">
					<select
						value={subcategoryId}
						onChange={(event) => setSubcategoryId(event.target.value)}
						aria-label="Speciality"
						className={cn(inline, "max-w-72 cursor-pointer px-2 py-1")}
					>
						<option value="">Pick where this belongs…</option>
						{categories.map((category) => (
							<optgroup key={category.id} label={category.name}>
								{category.subcategories.map((subcategory) => (
									<option key={subcategory.id} value={subcategory.id}>
										{subcategory.name}
									</option>
								))}
							</optgroup>
						))}
					</select>
					<span className="inline-flex items-center gap-1.5">
						Priced in
						<select
							value={currency}
							onChange={(event) => setCurrency(event.target.value)}
							aria-label="Currency"
							className={cn(
								inline,
								"cursor-pointer px-1.5 py-1 font-medium text-foreground",
							)}
						>
							{currencyOptions.map((code) => (
								<option key={code} value={code}>
									{code}
								</option>
							))}
						</select>
					</span>
				</div>

				<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
					<div className="min-w-0 space-y-8">
						<div className="space-y-4">
							<AutoTextarea
								value={title}
								maxLength={120}
								onChange={(event) =>
									setTitle(event.target.value.replace(/\n/g, " "))
								}
								placeholder="I will build and launch your online store"
								aria-label="Service title"
								className={cn(
									inline,
									"-mx-2 block w-[calc(100%+1rem)] resize-none px-2 py-1 text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl",
								)}
							/>
							{/* The byline buyers see. Not editable here — it is the
							    seller's profile, edited on the profile page. */}
							{ownerProfile && (
								<ServiceByline
									name={
										ownerProfile.display_name ??
										[ownerProfile.first_name, ownerProfile.last_name]
											.filter(Boolean)
											.join(" ") ??
										"You"
									}
									avatarUrl={ownerProfile.avatar_url ?? null}
									isVerifiedConsultant={!!ownerProfile.is_consultant_verified}
									stats={null}
									profileId={ownerProfile.id}
									linkToProfile={false}
								/>
							)}
						</div>

						<ServiceGalleryEditor
							items={gallery.items}
							busy={isSaving}
							onAdd={gallery.add}
							onRemove={gallery.remove}
							onPromote={gallery.promote}
						/>

						<ServiceSectionsEditor sections={sections} onChange={setSections} />
					</div>

					{/* 88px clears the global header alone; the editor adds its own
					    sub-header, so the rail pins a bar-height lower. */}
					<div className="space-y-3 lg:sticky lg:top-[132px] lg:self-start">
						<ServicePackagesRailEditor
							packages={packages}
							currency={currency}
							onChange={setPackages}
						/>
						<p className="text-center text-[11px] text-muted-foreground">
							Everything on this page is exactly what buyers see.
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}
