import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  isActiveConsultantEnrollment,
  isActiveTalentEnrollment,
} from '../../../../common/auth/consultant-capability';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import type {
  PublicServiceOfferingDetail,
  ServiceDescriptionSection,
  ServiceOffering,
  ServiceOfferingPackage,
} from '../service-offerings.types';
import type {
  ServiceOfferingsRepository,
  CreateServiceOfferingInput,
  OfferingPackageInput,
  UpdateServiceOfferingInput,
} from './service-offerings.repository.interface';

const COLUMNS =
  'id, user_id, subcategory_id, title, description, description_sections, cover_url, gallery_urls, starting_price, currency, price_unit, delivery_days, status, like_count, position, created_at, updated_at';

const PACKAGE_COLUMNS =
  'id, offering_id, title, description, price, delivery_days, revisions, features, position';

/**
 * What the anonymous internet may see of an offering — a named allowlist,
 * same philosophy as consultants.service: this module's client is
 * SUPABASE_ADMIN, so the select IS the boundary.
 */
const PUBLIC_DETAIL_COLUMNS =
  'id, user_id, title, description, description_sections, cover_url, gallery_urls, starting_price, currency, price_unit, delivery_days, status, like_count, subcategory:marketplace_subcategories(slug, name, category:marketplace_categories(slug))';

type Row = Record<string, any>;

/**
 * `starting_price` is numeric(12,2), which PostgREST returns as a string to
 * avoid float rounding. Every read path goes through here so the API never
 * emits a price as a string.
 */
function toService(row: Row): ServiceOffering {
  return {
    ...(row as ServiceOffering),
    description_sections: (row.description_sections ??
      []) as ServiceDescriptionSection[],
    starting_price:
      row.starting_price === null || row.starting_price === undefined
        ? null
        : Number(row.starting_price),
  };
}

/** `price` is numeric(12,2) — same string-from-PostgREST coercion as above. */
function toPackage(row: Row): ServiceOfferingPackage {
  return {
    ...(row as ServiceOfferingPackage),
    price: Number(row.price),
    features: (row.features ?? []) as string[],
  };
}

/** PostgREST types a many-to-one embed as array-or-object; take the one. */
function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

@Injectable()
export class SupabaseServiceOfferingsRepository implements ServiceOfferingsRepository {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async findAllByOwner(userId: string): Promise<ServiceOffering[]> {
    const { data, error } = await this.supabase
      .from('service_offerings')
      .select(COLUMNS)
      .eq('user_id', userId)
      .neq('status', 'archived')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Row[]).map(toService);
  }

  async findPublishedByOwner(userId: string): Promise<ServiceOffering[]> {
    const { data, error } = await this.supabase
      .from('service_offerings')
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
      .from('service_offerings')
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

  async findById(id: string): Promise<ServiceOffering | null> {
    const { data, error } = await this.supabase
      .from('service_offerings')
      .select(COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return data ? toService(data as Row) : null;
  }

  async create(input: CreateServiceOfferingInput): Promise<ServiceOffering> {
    const { data, error } = await this.supabase
      .from('service_offerings')
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
    input: UpdateServiceOfferingInput,
  ): Promise<ServiceOffering> {
    const { data, error } = await this.supabase
      .from('service_offerings')
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
      .from('service_offerings')
      .delete()
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
  }

  async nextPosition(userId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('service_offerings')
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
        .from('service_offerings')
        .update({ position: item.position })
        .eq('id', item.id)
        .eq('user_id', userId);
      if (error) throw new BadRequestException(error.message);
    }
  }

  async replacePackages(
    offeringId: string,
    rows: OfferingPackageInput[],
  ): Promise<ServiceOfferingPackage[]> {
    // Replace-set: the editor always sends the whole intended tier list, so
    // delete + insert keeps titles, ordering and prices exact without diffing.
    const { error: deleteError } = await this.supabase
      .from('service_offering_packages')
      .delete()
      .eq('offering_id', offeringId);
    if (deleteError) throw new BadRequestException(deleteError.message);

    if (rows.length === 0) return [];

    const { data, error } = await this.supabase
      .from('service_offering_packages')
      .insert(rows.map((row) => ({ offering_id: offeringId, ...row })))
      .select(PACKAGE_COLUMNS);
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Row[])
      .map(toPackage)
      .sort((a, b) => a.position - b.position);
  }

  async findPackagesByOfferingIds(
    offeringIds: string[],
  ): Promise<Map<string, ServiceOfferingPackage[]>> {
    const result = new Map<string, ServiceOfferingPackage[]>();
    if (offeringIds.length === 0) return result;

    const { data, error } = await this.supabase
      .from('service_offering_packages')
      .select(PACKAGE_COLUMNS)
      .in('offering_id', offeringIds)
      .order('position', { ascending: true });
    if (error) throw new BadRequestException(error.message);

    for (const row of (data ?? []) as Row[]) {
      const pkg = toPackage(row);
      const list = result.get(pkg.offering_id) ?? [];
      list.push(pkg);
      result.set(pkg.offering_id, list);
    }
    return result;
  }

  async findPublicDetailById(
    id: string,
  ): Promise<PublicServiceOfferingDetail | null> {
    const { data, error } = await this.supabase
      .from('service_offerings')
      .select(PUBLIC_DETAIL_COLUMNS)
      .eq('id', id)
      .eq('status', 'published')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) return null;
    const row = data as Row;
    const sellerId = row.user_id as string;

    // Seller-activity restated here because this client bypasses RLS: a
    // suspended consultant's or paused talent's page must 404, not linger.
    const [isConsultant, isTalent] = await Promise.all([
      isActiveConsultantEnrollment(this.supabase, sellerId),
      isActiveTalentEnrollment(this.supabase, sellerId),
    ]);
    if (!isConsultant && !isTalent) return null;

    const [packages, profileRes, rateRes, statsRes] = await Promise.all([
      this.findPackagesByOfferingIds([id]),
      this.supabase
        .from('profiles')
        .select('id, display_name, avatar_url, headline')
        .eq('id', sellerId)
        .maybeSingle(),
      this.supabase
        .from('user_rate_settings')
        // Same allowlist as CONSULTANT_RATE_PUBLIC_COLUMNS: budget floor and
        // weekly hours are negotiating positions and stay private.
        .select('hourly_rate, currency, availability')
        .eq('user_id', sellerId)
        .maybeSingle(),
      this.supabase
        .from('user_stats')
        .select('avg_rating, total_reviews')
        .eq('user_id', sellerId)
        .maybeSingle(),
    ]);

    const profile = (profileRes.data ?? null) as Row | null;
    const rate = (rateRes.data ?? null) as Row | null;
    const stats = (statsRes.data ?? null) as Row | null;
    const subcategory = firstOf(
      row.subcategory as
        | { slug: string; name: string; category: unknown }
        | Array<{ slug: string; name: string; category: unknown }>
        | null,
    );
    const category = firstOf(
      subcategory?.category as
        | { slug: string }
        | Array<{ slug: string }>
        | null,
    );
    const totalReviews = Number(stats?.total_reviews ?? 0);

    return {
      id: row.id as string,
      title: row.title as string,
      description: (row.description ?? null) as string | null,
      description_sections: (row.description_sections ??
        []) as ServiceDescriptionSection[],
      cover_url: (row.cover_url ?? null) as string | null,
      gallery_urls: (row.gallery_urls ?? []) as string[],
      starting_price:
        row.starting_price === null || row.starting_price === undefined
          ? null
          : Number(row.starting_price),
      currency: row.currency as string,
      price_unit: row.price_unit as PublicServiceOfferingDetail['price_unit'],
      delivery_days: (row.delivery_days ?? null) as number | null,
      like_count: Number(row.like_count ?? 0),
      subcategory: subcategory
        ? {
            slug: subcategory.slug,
            name: subcategory.name,
            category_slug: category?.slug ?? '',
          }
        : null,
      packages: packages.get(id) ?? [],
      seller: {
        id: sellerId,
        display_name: (profile?.display_name ?? null) as string | null,
        avatar_url: (profile?.avatar_url ?? null) as string | null,
        headline: (profile?.headline ?? null) as string | null,
        // Which public profile the seller card links to: consultants have a
        // consultant page; every other seller passed the talent gate above.
        is_verified_consultant: isConsultant,
        // Nothing writes ratings yet — null at zero reviews so the web
        // renders "New seller" rather than an invented 0.0.
        stats:
          stats && totalReviews > 0
            ? {
                avg_rating: Number(stats.avg_rating ?? 0),
                total_reviews: totalReviews,
              }
            : null,
        rate:
          rate && rate.hourly_rate !== null && rate.hourly_rate !== undefined
            ? {
                hourly_rate: Number(rate.hourly_rate),
                currency: (rate.currency ?? 'USD') as string,
                availability: (rate.availability ?? 'available') as string,
              }
            : null,
      },
    };
  }

  async hasLiked(offeringId: string, userId: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('service_offering_likes')
      .select('offering_id', { count: 'exact', head: true })
      .eq('offering_id', offeringId)
      .eq('user_id', userId);
    if (error) throw new BadRequestException(error.message);
    return (count ?? 0) > 0;
  }

  async like(offeringId: string, userId: string): Promise<void> {
    // Upsert, not insert: a double-tap is the same single row, and the
    // count trigger only fires when a row is genuinely created.
    const { error } = await this.supabase
      .from('service_offering_likes')
      .upsert(
        { offering_id: offeringId, user_id: userId },
        { onConflict: 'offering_id,user_id', ignoreDuplicates: true },
      );
    if (error) throw new BadRequestException(error.message);
  }

  async unlike(offeringId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('service_offering_likes')
      .delete()
      .eq('offering_id', offeringId)
      .eq('user_id', userId);
    if (error) throw new BadRequestException(error.message);
  }

  async likeCount(offeringId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('service_offerings')
      .select('like_count')
      .eq('id', offeringId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return Number((data as { like_count?: number } | null)?.like_count ?? 0);
  }
}
