/**
 * A consultant's own catalog entry.
 *
 * A catalog entry is not an order and not a legal record. Picking one on the
 * Contract tab copies a snapshot into `contracts.services`, and that copy is
 * what the agreement is made of — editing the entry afterwards must never
 * change what somebody signed.
 */
export interface ConsultantService {
  id: string;
  user_id: string;
  subcategory_id: string | null;
  title: string;
  description: string | null;
  cover_url: string | null;
  starting_price: number | null;
  currency: string;
  price_unit: ConsultantServicePriceUnit;
  delivery_days: number | null;
  status: ConsultantServiceStatus;
  position: number;
  created_at: string;
  updated_at: string;
}

export type ConsultantServicePriceUnit = 'project' | 'hour' | 'month';
export type ConsultantServiceStatus = 'draft' | 'published' | 'archived';

/** The published projection the public profile renders. */
export interface PublicConsultantService {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  starting_price: number | null;
  currency: string;
  price_unit: ConsultantServicePriceUnit;
  delivery_days: number | null;
  subcategory: { slug: string; name: string; category_slug: string } | null;
}
