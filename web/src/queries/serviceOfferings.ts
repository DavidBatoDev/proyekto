import { apiClient } from "@/api";

/**
 * Service offerings — the Fiverr-style productised services both verified
 * consultants and active talent sell. Owner CRUD is seller-gated; the two
 * `public/*` reads are anonymous.
 */

export type ServiceOfferingStatus = "draft" | "published" | "archived";
export type ServiceOfferingPriceUnit = "project" | "hour" | "month";

export interface ServiceOfferingPackage {
	id: string;
	offering_id: string;
	/** Seller-titled tier ("Starter site", "Full store") — no fixed enum. */
	title: string;
	description: string | null;
	price: number;
	delivery_days: number | null;
	/** null = unlimited revisions; 0 = none. */
	revisions: number | null;
	features: string[];
	position: number;
}

/** One labelled column of a `columns` section. */
export interface ServiceSectionColumn {
	label: string;
	body: string;
}

/**
 * One block of the About area: `prose` is a heading over a markdown body,
 * `columns` is up to three labelled facts side by side. No layout means
 * prose — that is every section written before layouts existed.
 */
export interface ServiceDescriptionSection {
	layout?: "prose" | "columns";
	heading?: string;
	body?: string;
	columns?: ServiceSectionColumn[];
}

export interface ServiceOffering {
	id: string;
	user_id: string;
	subcategory_id: string | null;
	title: string;
	/** Derived plain-text blurb for cards — sellers edit sections, not this. */
	description: string | null;
	description_sections: ServiceDescriptionSection[];
	cover_url: string | null;
	gallery_urls: string[];
	starting_price: number | null;
	currency: string;
	price_unit: ServiceOfferingPriceUnit;
	delivery_days: number | null;
	status: ServiceOfferingStatus;
	like_count: number;
	position: number;
	created_at: string;
	updated_at: string;
	packages?: ServiceOfferingPackage[];
}

export interface PublicServiceOfferingDetail {
	id: string;
	title: string;
	description: string | null;
	description_sections: ServiceDescriptionSection[];
	cover_url: string | null;
	gallery_urls: string[];
	starting_price: number | null;
	currency: string;
	price_unit: ServiceOfferingPriceUnit;
	delivery_days: number | null;
	like_count: number;
	subcategory: { slug: string; name: string; category_slug: string } | null;
	packages: ServiceOfferingPackage[];
	seller: {
		id: string;
		display_name: string | null;
		avatar_url: string | null;
		headline: string | null;
		/** Routes the seller link: consultant page when true, talent page otherwise. */
		is_verified_consultant: boolean;
		/** null until reviews exist — render "New seller", never 0.0. */
		stats: { avg_rating: number; total_reviews: number } | null;
		rate: {
			hourly_rate: number;
			currency: string;
			availability: string;
		} | null;
	};
}

export interface CreateServiceOfferingPayload {
	title: string;
	description?: string;
	subcategory_id?: string;
	cover_url?: string;
	currency?: string;
	price_unit?: ServiceOfferingPriceUnit;
	delivery_days?: number;
}

export interface UpdateServiceOfferingPayload
	extends Partial<CreateServiceOfferingPayload> {
	status?: ServiceOfferingStatus;
	gallery_urls?: string[];
	/** Full replace, like gallery_urls. */
	description_sections?: ServiceDescriptionSection[];
}

export interface OfferingPackagePayload {
	title: string;
	description?: string;
	price: number;
	delivery_days?: number;
	revisions?: number;
	features?: string[];
}

export interface ServiceLikeState {
	liked: boolean;
	like_count: number;
}

export const serviceOfferingKeys = {
	mine: () => ["service-offerings", "mine"] as const,
	publicDetail: (id: string) => ["service-offerings", "public", id] as const,
	publicByUser: (userId: string) =>
		["service-offerings", "public-by-user", userId] as const,
	like: (id: string) => ["service-offerings", "like", id] as const,
};

export async function fetchMyServiceOfferings(): Promise<ServiceOffering[]> {
	const response = await apiClient.get("/api/service-offerings/mine");
	return response.data.data;
}

export async function fetchPublicServiceOffering(
	id: string,
): Promise<PublicServiceOfferingDetail> {
	const response = await apiClient.get(`/api/service-offerings/public/${id}`);
	return response.data.data;
}

export async function fetchPublicServiceOfferingsByUser(
	userId: string,
): Promise<ServiceOffering[]> {
	const response = await apiClient.get(
		`/api/service-offerings/public/by-user/${userId}`,
	);
	return response.data.data;
}

export async function createServiceOffering(
	payload: CreateServiceOfferingPayload,
): Promise<ServiceOffering> {
	const response = await apiClient.post("/api/service-offerings", payload);
	return response.data.data;
}

export async function updateServiceOffering(
	id: string,
	payload: UpdateServiceOfferingPayload,
): Promise<ServiceOffering> {
	const response = await apiClient.patch(
		`/api/service-offerings/${id}`,
		payload,
	);
	return response.data.data;
}

export async function replaceServiceOfferingPackages(
	id: string,
	packages: OfferingPackagePayload[],
): Promise<ServiceOffering> {
	const response = await apiClient.put(
		`/api/service-offerings/${id}/packages`,
		{ packages },
	);
	return response.data.data;
}

export async function deleteServiceOffering(id: string): Promise<void> {
	await apiClient.delete(`/api/service-offerings/${id}`);
}

export async function fetchServiceLikeState(
	id: string,
): Promise<ServiceLikeState> {
	const response = await apiClient.get(`/api/service-offerings/${id}/like`);
	return response.data.data;
}

export async function setServiceLiked(
	id: string,
	liked: boolean,
): Promise<ServiceLikeState> {
	const response = liked
		? await apiClient.put(`/api/service-offerings/${id}/like`)
		: await apiClient.delete(`/api/service-offerings/${id}/like`);
	return response.data.data;
}
