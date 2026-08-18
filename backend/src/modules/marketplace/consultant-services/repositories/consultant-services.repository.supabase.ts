import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import type { ConsultantService } from '../consultant-services.types';
import type {
  ConsultantServicesRepository,
  CreateConsultantServiceInput,
  UpdateConsultantServiceInput,
} from './consultant-services.repository.interface';

const COLUMNS =
  'id, user_id, subcategory_id, title, description, cover_url, starting_price, currency, price_unit, delivery_days, status, position, created_at, updated_at';

type Row = Record<string, any>;

/**
 * `starting_price` is numeric(12,2), which PostgREST returns as a string to
 * avoid float rounding. Every read path goes through here so the API never
 * emits a price as a string.
 */
function toService(row: Row): ConsultantService {
  return {
    ...(row as ConsultantService),
    starting_price:
      row.starting_price === null || row.starting_price === undefined
        ? null
        : Number(row.starting_price),
  };
}

@Injectable()
export class SupabaseConsultantServicesRepository implements ConsultantServicesRepository {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async findAllByOwner(userId: string): Promise<ConsultantService[]> {
    const { data, error } = await this.supabase
      .from('consultant_services')
      .select(COLUMNS)
      .eq('user_id', userId)
      .neq('status', 'archived')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Row[]).map(toService);
  }

  async findPublishedByOwner(userId: string): Promise<ConsultantService[]> {
    const { data, error } = await this.supabase
      .from('consultant_services')
      .select(COLUMNS)
      .eq('user_id', userId)
      .eq('status', 'published')
      .order('position', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Row[]).map(toService);
  }

  async findStartingPrices(
    userIds: string[],
  ): Promise<Map<string, { amount: number; currency: string; unit: string }>> {
    const result = new Map<
      string,
      { amount: number; currency: string; unit: string }
    >();
    if (userIds.length === 0) return result;

    const { data, error } = await this.supabase
      .from('consultant_services')
      .select('user_id, starting_price, currency, price_unit')
      .in('user_id', userIds)
      .eq('status', 'published')
      .not('starting_price', 'is', null);
    if (error) throw new BadRequestException(error.message);

    // Reduced here rather than with a grouped query: PostgREST has no GROUP BY,
    // and the row count is bounded by (cards on a page x services per
    // consultant), which is small.
    for (const row of (data ?? []) as Row[]) {
      const amount = Number(row.starting_price);
      const current = result.get(row.user_id as string);
      if (!current || amount < current.amount) {
        result.set(row.user_id as string, {
          amount,
          currency: row.currency as string,
          unit: row.price_unit as string,
        });
      }
    }
    return result;
  }

  async findById(id: string): Promise<ConsultantService | null> {
    const { data, error } = await this.supabase
      .from('consultant_services')
      .select(COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return data ? toService(data as Row) : null;
  }

  async create(
    input: CreateConsultantServiceInput,
  ): Promise<ConsultantService> {
    const { data, error } = await this.supabase
      .from('consultant_services')
      .insert(input)
      .select(COLUMNS)
      .single();
    if (error || !data) {
      throw new BadRequestException(
        error?.message ?? 'Failed to create service',
      );
    }
    return toService(data as Row);
  }

  async update(
    id: string,
    input: UpdateConsultantServiceInput,
  ): Promise<ConsultantService> {
    const { data, error } = await this.supabase
      .from('consultant_services')
      .update(input)
      .eq('id', id)
      .select(COLUMNS)
      .single();
    if (error || !data) {
      throw new BadRequestException(
        error?.message ?? 'Failed to update service',
      );
    }
    return toService(data as Row);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('consultant_services')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
  }

  async nextPosition(userId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('consultant_services')
      .select('position')
      .eq('user_id', userId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return data ? Number((data as Row).position) + 1 : 0;
  }

  async reorder(
    userId: string,
    items: Array<{ id: string; position: number }>,
  ): Promise<void> {
    // Sequential rather than a bulk upsert: an upsert would need every NOT NULL
    // column present, so a partial payload would blank `title`. The list is
    // short and reordering is rare.
    for (const item of items) {
      const { error } = await this.supabase
        .from('consultant_services')
        .update({ position: item.position })
        .eq('id', item.id)
        .eq('user_id', userId);
      if (error) throw new BadRequestException(error.message);
    }
  }
}
