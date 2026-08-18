import type { ConsultantService } from '../consultant-services.types';

export const CONSULTANT_SERVICES_REPOSITORY = Symbol(
  'CONSULTANT_SERVICES_REPOSITORY',
);

export interface CreateConsultantServiceInput {
  user_id: string;
  title: string;
  description?: string | null;
  subcategory_id?: string | null;
  cover_url?: string | null;
  starting_price?: number | null;
  currency?: string;
  price_unit?: string;
  delivery_days?: number | null;
  position: number;
}

export type UpdateConsultantServiceInput = Partial<
  Omit<CreateConsultantServiceInput, 'user_id' | 'position'>
> & { status?: string };

export interface ConsultantServicesRepository {
  /** The owner's whole catalog, drafts included, in their chosen order. */
  findAllByOwner(userId: string): Promise<ConsultantService[]>;

  /** Published only. Backs the public profile grid. */
  findPublishedByOwner(userId: string): Promise<ConsultantService[]>;

  /**
   * The cheapest published starting price per consultant, for the "From $X"
   * line on directory cards. Batched: the directory renders up to 48 cards and
   * one query per card would be 48 round trips.
   */
  findStartingPrices(
    userIds: string[],
  ): Promise<Map<string, { amount: number; currency: string; unit: string }>>;

  findById(id: string): Promise<ConsultantService | null>;

  create(input: CreateConsultantServiceInput): Promise<ConsultantService>;

  update(
    id: string,
    input: UpdateConsultantServiceInput,
  ): Promise<ConsultantService>;

  remove(id: string): Promise<void>;

  /** Highest existing position for a user, so a new row appends. */
  nextPosition(userId: string): Promise<number>;

  reorder(
    userId: string,
    items: Array<{ id: string; position: number }>,
  ): Promise<void>;
}
