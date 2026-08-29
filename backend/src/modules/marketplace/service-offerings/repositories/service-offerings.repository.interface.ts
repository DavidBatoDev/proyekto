import type {
  PublicServiceOfferingDetail,
  ServiceDescriptionSection,
  ServiceOffering,
  ServiceOfferingPackage,
} from '../service-offerings.types';

export const SERVICE_OFFERINGS_REPOSITORY = Symbol(
  'SERVICE_OFFERINGS_REPOSITORY',
);

export interface OfferingPackageInput {
  title: string;
  description: string | null;
  price: number;
  delivery_days: number | null;
  revisions: number | null;
  features: string[];
  position: number;
}

export interface CreateServiceOfferingInput {
  user_id: string;
  title: string;
  description?: string | null;
  description_sections?: ServiceDescriptionSection[];
  subcategory_id?: string | null;
  cover_url?: string | null;
  starting_price?: number | null;
  currency?: string;
  price_unit?: string;
  delivery_days?: number | null;
  position: number;
}

export type UpdateServiceOfferingInput = Partial<
  Omit<CreateServiceOfferingInput, 'user_id' | 'position'>
> & { status?: string };

export interface ServiceOfferingsRepository {
  /** The owner's whole catalog, drafts included, in their chosen order. */
  findAllByOwner(userId: string): Promise<ServiceOffering[]>;

  /** Published only. Backs the public profile grid. */
  findPublishedByOwner(userId: string): Promise<ServiceOffering[]>;

  /**
   * The cheapest published starting price per consultant, for the "From $X"
   * line on directory cards. Batched: the directory renders up to 48 cards and
   * one query per card would be 48 round trips.
   */
  findStartingPrices(
    userIds: string[],
  ): Promise<Map<string, { amount: number; currency: string; unit: string }>>;

  findById(id: string): Promise<ServiceOffering | null>;

  create(input: CreateServiceOfferingInput): Promise<ServiceOffering>;

  update(
    id: string,
    input: UpdateServiceOfferingInput,
  ): Promise<ServiceOffering>;

  remove(id: string): Promise<void>;

  /** Highest existing position for a user, so a new row appends. */
  nextPosition(userId: string): Promise<number>;

  reorder(
    userId: string,
    items: Array<{ id: string; position: number }>,
  ): Promise<void>;

  /** Replace-set the seller-titled tiers; position from array order. */
  replacePackages(
    offeringId: string,
    rows: OfferingPackageInput[],
  ): Promise<ServiceOfferingPackage[]>;

  /** Packages for a set of offerings, position-ordered, grouped by offering. */
  findPackagesByOfferingIds(
    offeringIds: string[],
  ): Promise<Map<string, ServiceOfferingPackage[]>>;

  /**
   * The public detail-page read: published offering + packages + seller
   * card, or null. Seller-activity (verified consultant OR active talent) is
   * restated in the query because this client bypasses RLS.
   */
  findPublicDetailById(id: string): Promise<PublicServiceOfferingDetail | null>;

  /** Has this viewer already liked the offering? */
  hasLiked(offeringId: string, userId: string): Promise<boolean>;

  /**
   * Idempotent by primary key: liking twice is one row, and the trigger that
   * maintains like_count only fires on a real insert.
   */
  like(offeringId: string, userId: string): Promise<void>;

  unlike(offeringId: string, userId: string): Promise<void>;

  /** Reads back the trigger-maintained counter after a like/unlike. */
  likeCount(offeringId: string): Promise<number>;
}
