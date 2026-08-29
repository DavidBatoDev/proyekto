/**
 * A consultant's own catalog entry.
 *
 * A catalog entry is not an order and not a legal record. Picking one on the
 * Contract tab copies a snapshot into `contracts.services`, and that copy is
 * what the agreement is made of — editing the entry afterwards must never
 * change what somebody signed.
 */
/** One labelled column of a `columns` section. */
export interface ServiceSectionColumn {
  label: string;
  body: string;
}

/**
 * One block of the About area. `prose` is a heading over a markdown body;
 * `columns` is up to three labelled columns of short text. A section with no
 * layout is prose — that is what every section written before layouts is.
 */
export interface ServiceDescriptionSection {
  layout?: 'prose' | 'columns';
  heading?: string;
  body?: string;
  columns?: ServiceSectionColumn[];
}

export interface ServiceOffering {
  id: string;
  user_id: string;
  subcategory_id: string | null;
  title: string;
  /**
   * Plain-text blurb for catalog cards and the contract snapshot. Derived
   * from the first section on write — sellers edit sections, not this.
   */
  description: string | null;
  description_sections: ServiceDescriptionSection[];
  cover_url: string | null;
  gallery_urls: string[];
  starting_price: number | null;
  currency: string;
  price_unit: ServiceOfferingPriceUnit;
  delivery_days: number | null;
  status: ServiceOfferingStatus;
  /** Maintained by DB trigger from service_offering_likes; never written here. */
  like_count: number;
  position: number;
  created_at: string;
  updated_at: string;
  /** Seller-titled tiers, in position order. Embedded on owner + public reads. */
  packages?: ServiceOfferingPackage[];
}

export interface ServiceOfferingPackage {
  id: string;
  offering_id: string;
  title: string;
  description: string | null;
  price: number;
  delivery_days: number | null;
  /** null = unlimited revisions; 0 = none. */
  revisions: number | null;
  features: string[];
  position: number;
}

export type ServiceOfferingPriceUnit = 'project' | 'hour' | 'month';
export type ServiceOfferingStatus = 'draft' | 'published' | 'archived';

/** The published projection the public profile renders. */
export interface PublicServiceOffering {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  starting_price: number | null;
  currency: string;
  price_unit: ServiceOfferingPriceUnit;
  delivery_days: number | null;
  subcategory: { slug: string; name: string; category_slug: string } | null;
}

/**
 * The service detail page's payload. Every field is a named allowlist —
 * this read is @Public() and the module's client is SUPABASE_ADMIN, so what
 * is selected here IS what the internet sees.
 */
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
    /**
     * Routes the seller link: true → the consultant profile page, false → the
     * talent one (a published offering guarantees one of the two is active).
     */
    is_verified_consultant: boolean;
    /** null until a review system exists — never render an invented 0.0. */
    stats: { avg_rating: number; total_reviews: number } | null;
    rate: {
      hourly_rate: number;
      currency: string;
      availability: string;
    } | null;
  };
}
