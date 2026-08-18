import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import {
  AppCacheStatus,
  RedisDataCacheService,
} from '../../../common/cache/redis-data-cache.service';
import {
  hashNormalizedQuery,
  REDIS_CACHE_KEYS,
} from '../../../common/cache/redis-cache.keys';
import {
  attachMarketplaceEnrollmentFields,
  type MarketplaceEnrollmentFields,
} from '../../../common/auth/consultant-capability';
import { TaxonomyService } from '../taxonomy/taxonomy.service';
import { ConsultantDirectoryQueryDto } from './dto/consultants.dto';

export const CONSULTANTS_REPOSITORY = Symbol('CONSULTANTS_REPOSITORY');

/**
 * The public column allowlist. Both the legacy list and the paginated directory
 * select exactly this, so a column can never leak through one endpoint but not
 * the other.
 */
const CONSULTANT_PUBLIC_COLUMNS =
  'id, display_name, avatar_url, banner_url, headline, bio, country, city, created_at, consultant_profile:consultant_profiles!consultant_profiles_user_id_fkey!inner(status, verified_at)';

/**
 * A consultant's declared expertise, for the public profile.
 *
 * `consultant_subcategories` is otherwise readable only by the backend (RLS
 * denies everyone), and this is the one place its contents are meant to be
 * seen: the taxonomy leaf pages list who is in a category, and this is the
 * reverse view of the same rows.
 */
const CONSULTANT_EXPERTISE_SELECT =
  'is_primary, position, subcategory:marketplace_subcategories!inner(slug, name, is_active, category:marketplace_categories!inner(slug, name, is_active))';

export interface ConsultantExpertise {
  categorySlug: string;
  categoryName: string;
  subcategorySlug: string;
  subcategoryName: string;
  isPrimary: boolean;
}

/**
 * Shapes for the expertise embed. The shared SupabaseClient is not generated
 * from a Database schema, so embedded rows arrive untyped; declaring them here
 * keeps the narrowing local instead of disabling the `any` rules file-wide.
 *
 * PostgREST returns a to-one embed as an object, but the same select against a
 * different relationship cardinality returns an array, so both are accepted.
 */
interface ExpertiseCategoryRow {
  slug: string;
  name: string;
}

interface ExpertiseSubcategoryRow {
  slug: string;
  name: string;
  category: ExpertiseCategoryRow | ExpertiseCategoryRow[] | null;
}

interface ExpertiseRow {
  is_primary: boolean | null;
  subcategory: ExpertiseSubcategoryRow | ExpertiseSubcategoryRow[] | null;
}

function firstOf<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

function firstRows(data: unknown): ExpertiseRow[] {
  return (data ?? []) as ExpertiseRow[];
}

interface CacheReadOptions {
  onCacheStatus?: (status: AppCacheStatus) => void;
}

export type ConsultantSummary = object & MarketplaceEnrollmentFields;

/**
 * `attachMarketplaceEnrollmentFields` strips the whole `consultant_profile`
 * embed once it has derived the capability flags, so `verified_at` has to be
 * lifted out before it goes. Every endpoint routes through here rather than
 * calling the helper directly, which is what keeps the three payloads identical
 * — the same reason the column allowlist is shared.
 */
function toPublicConsultant(row: object) {
  const embed = (row as Record<string, unknown>).consultant_profile;
  const record = (Array.isArray(embed) ? embed[0] : embed) as
    | { verified_at?: string | null }
    | null
    | undefined;
  return {
    ...attachMarketplaceEnrollmentFields(row),
    consultant_verified_at: record?.verified_at ?? null,
  };
}

export interface ConsultantDirectoryPage {
  items: ConsultantSummary[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class ConsultantsService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly cache: RedisDataCacheService,
    private readonly taxonomy: TaxonomyService,
  ) {}

  async findAll(options?: CacheReadOptions) {
    return this.cache.rememberJson(
      REDIS_CACHE_KEYS.consultantsList,
      this.cache.getPublicTtlSeconds(),
      async () => {
        const { data } = await this.supabase
          .from('profiles')
          .select(CONSULTANT_PUBLIC_COLUMNS)
          .eq('consultant_profile.status', 'verified');
        return (data || []).map(toPublicConsultant);
      },
      { onStatus: options?.onCacheStatus },
    );
  }

  /**
   * The paginated, category-filtered directory behind the marketplace category
   * pages.
   *
   * Kept separate from `findAll` because that returns a bare array which three
   * web call sites already depend on; pagination needs an envelope.
   *
   * Scaling note: the candidate set is applied with `.in('id', ...)`, which
   * degrades once a single category holds a few thousand consultants, because
   * PostgREST carries the list in the URL. That is far beyond current volumes.
   * When it matters, replace step one with a SECURITY DEFINER function doing
   * `SELECT DISTINCT` server-side - the shape of this method does not change.
   */
  async directory(
    query: ConsultantDirectoryQueryDto,
    options?: CacheReadOptions,
  ): Promise<ConsultantDirectoryPage> {
    const normalized = {
      category: query.category?.trim().toLowerCase() || undefined,
      subcategory: query.subcategory?.trim().toLowerCase() || undefined,
      limit: query.limit,
      offset: query.offset,
    };

    return this.cache.rememberJson(
      REDIS_CACHE_KEYS.consultantsDirectoryByHash(
        hashNormalizedQuery(normalized),
      ),
      this.cache.getPublicTtlSeconds(),
      () => this.loadDirectory(query),
      {
        onStatus: options?.onCacheStatus,
        indexKey: REDIS_CACHE_KEYS.consultantsIndex,
      },
    );
  }

  private async loadDirectory(
    query: ConsultantDirectoryQueryDto,
  ): Promise<ConsultantDirectoryPage> {
    const { limit, offset } = query;
    let candidateIds: string[] | null = null;

    if (query.category) {
      const subcategoryIds = await this.taxonomy.resolveSubcategoryIds(
        query.category,
        query.subcategory,
      );
      if (subcategoryIds === null) {
        throw new NotFoundException('Category not found');
      }

      candidateIds = subcategoryIds.length
        ? await this.findMembers(subcategoryIds)
        : [];

      // Short-circuit: an empty candidate set can never match a profile, and
      // `.in('id', [])` is a wasted round trip.
      if (candidateIds.length === 0) {
        return { items: [], total: 0, limit, offset };
      }
    }

    let builder = this.supabase
      .from('profiles')
      .select(CONSULTANT_PUBLIC_COLUMNS, { count: 'exact' })
      // The same predicate as public.is_active_consultant: capability comes
      // from enrolment status, never from a declared role. A suspended
      // consultant drops off every category page without their membership rows
      // being touched.
      .eq('consultant_profile.status', 'verified');

    if (candidateIds) builder = builder.in('id', candidateIds);

    const { data, count, error } = await builder
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return {
      items: (data ?? []).map(toPublicConsultant),
      total: count ?? 0,
      limit,
      offset,
    };
  }

  /**
   * A consultant sitting in two sub-categories of the same category would come
   * back twice, and PostgREST has no DISTINCT, so the dedupe happens here.
   */
  private async findMembers(subcategoryIds: string[]): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('consultant_subcategories')
      .select('user_id')
      .in('subcategory_id', subcategoryIds);

    if (error) throw error;
    return [...new Set((data ?? []).map((row) => row.user_id as string))];
  }

  async findOne(id: string, options?: CacheReadOptions) {
    return this.cache.rememberJson(
      REDIS_CACHE_KEYS.consultantsProfile(id),
      this.cache.getPublicTtlSeconds(),
      async () => {
        const { data } = await this.supabase
          .from('profiles')
          .select(CONSULTANT_PUBLIC_COLUMNS)
          .eq('id', id)
          .eq('consultant_profile.status', 'verified')
          .single();
        if (!data) throw new NotFoundException('Consultant not found');
        return {
          ...toPublicConsultant(data),
          expertise: await this.findExpertise(id),
        };
      },
      { onStatus: options?.onCacheStatus },
    );
  }

  /**
   * Only the detail endpoint carries expertise. The directory already knows
   * which category it filtered by, and adding a second round trip per row there
   * would cost one query per card to tell each card what it was selected for.
   */
  private async findExpertise(id: string): Promise<ConsultantExpertise[]> {
    const { data, error } = await this.supabase
      .from('consultant_subcategories')
      .select(CONSULTANT_EXPERTISE_SELECT)
      .eq('user_id', id)
      .eq('subcategory.is_active', true)
      .eq('subcategory.category.is_active', true)
      .order('is_primary', { ascending: false })
      .order('position', { ascending: true });

    if (error) throw error;

    return firstRows(data).flatMap((row) => {
      const subcategory = firstOf(row.subcategory);
      const category = firstOf(subcategory?.category);
      // The `is_active` filters above narrow the embed rather than dropping the
      // parent row, so a de-activated branch still arrives as an empty embed.
      if (!subcategory || !category) return [];
      return [
        {
          categorySlug: category.slug,
          categoryName: category.name,
          subcategorySlug: subcategory.slug,
          subcategoryName: subcategory.name,
          isPrimary: Boolean(row.is_primary),
        },
      ];
    });
  }
}
