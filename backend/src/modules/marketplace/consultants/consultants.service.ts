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
import type { ConsultantPlacement } from '../taxonomy/taxonomy.types';
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

export type ConsultantExpertise = ConsultantPlacement;

/**
 * The published catalog, skills, rate card and templates the public profile
 * renders. Each is a named allowlist for the same reason
 * `CONSULTANT_PUBLIC_COLUMNS` is: this endpoint is `@Public()`, so a
 * `select('*')` here would publish whatever column somebody adds next.
 *
 * These clients run as SUPABASE_ADMIN and bypass RLS, so the `.eq()` filters in
 * each method below ARE the security boundary — they deliberately restate the
 * table policies rather than trusting them.
 */
const CONSULTANT_SERVICE_PUBLIC_COLUMNS =
  'id, title, description, cover_url, starting_price, currency, price_unit, delivery_days, position';

const CONSULTANT_SKILL_PUBLIC_SELECT =
  'proficiency_level, years_experience, skill:skills!inner(name, slug, category)';

/**
 * `min_project_budget` and `weekly_hours` are deliberately absent. They are
 * negotiating positions, they appear on no public surface today, and
 * publishing them is a product decision rather than a plumbing one.
 */
const CONSULTANT_RATE_PUBLIC_COLUMNS = 'hourly_rate, currency, availability';

const CONSULTANT_LANGUAGE_PUBLIC_SELECT =
  'fluency_level, language:languages!inner(code, name)';

/**
 * Work history. `is_current` and the two dates are what let the profile print
 * "Feb 2019 - Present" and a duration without the browser guessing.
 */
const CONSULTANT_EXPERIENCE_PUBLIC_COLUMNS =
  'id, company, title, location, is_remote, description, start_date, end_date, is_current';

const CONSULTANT_PORTFOLIO_PUBLIC_COLUMNS =
  'id, title, description, url, image_url, tags, position';

const CONSULTANT_TEMPLATE_PUBLIC_COLUMNS =
  'id, slug, title, summary, preview_url, difficulty, estimated_duration_days, rating_average, rating_count, use_count, published_at';

export interface ConsultantPublicService {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  starting_price: number | null;
  currency: string;
  price_unit: string;
  delivery_days: number | null;
}

export interface ConsultantPublicSkill {
  name: string;
  slug: string;
  category: string | null;
  proficiencyLevel: string | null;
  yearsExperience: number | null;
}

export interface ConsultantPublicRates {
  hourlyRate: number | null;
  currency: string;
  availability: string | null;
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

    const items = (data ?? []).map(toPublicConsultant);

    // "From $X/project" on each card. One batched query for the whole page
    // rather than one per card: the directory renders up to 48 of them, and a
    // per-card lookup would be 48 round trips on every cold cache read.
    const startingFrom = await this.findStartingPrices(
      items.map((item) => (item as Record<string, unknown>).id as string),
    );

    return {
      items: items.map((item) => ({
        ...item,
        starting_from:
          startingFrom.get((item as Record<string, unknown>).id as string) ??
          null,
      })),
      total: count ?? 0,
      limit,
      offset,
    };
  }

  /**
   * The cheapest published service per consultant. Reduced in memory because
   * PostgREST has no GROUP BY, and the row count here is bounded by
   * (cards on a page x services each), which is small.
   */
  private async findStartingPrices(
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
    if (error) throw error;

    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const amount = Number(row.starting_price);
      const userId = row.user_id as string;
      const current = result.get(userId);
      if (!current || amount < current.amount) {
        result.set(userId, {
          amount,
          currency: row.currency as string,
          unit: row.price_unit as string,
        });
      }
    }
    return result;
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
        // One round trip each, in parallel, inside the same cache closure — so
        // the fan-out is paid once per TTL rather than on every request.
        const [
          expertise,
          services,
          skills,
          rates,
          templates,
          languages,
          experiences,
          portfolios,
        ] = await Promise.all([
          this.findExpertise(id),
          this.findServices(id),
          this.findSkills(id),
          this.findRates(id),
          this.findTemplates(id),
          this.findLanguages(id),
          this.findExperiences(id),
          this.findPortfolios(id),
        ]);
        return {
          ...toPublicConsultant(data),
          expertise,
          services,
          skills,
          rates,
          templates,
          languages,
          experiences,
          portfolios,
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

  /**
   * The published catalog. Drafts and archived rows are excluded here as well
   * as by RLS, because this client bypasses RLS — an unpublished price is the
   * consultant's private working state and must not leak.
   */
  private async findServices(id: string): Promise<ConsultantPublicService[]> {
    const { data, error } = await this.supabase
      .from('consultant_services')
      .select(CONSULTANT_SERVICE_PUBLIC_COLUMNS)
      .eq('user_id', id)
      .eq('status', 'published')
      .order('position', { ascending: true });
    if (error) throw error;

    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: row.id as string,
      title: row.title as string,
      description: (row.description as string | null) ?? null,
      cover_url: (row.cover_url as string | null) ?? null,
      // numeric(12,2) arrives as a string from PostgREST; the API must not
      // hand the browser a price it has to parse.
      starting_price:
        row.starting_price === null || row.starting_price === undefined
          ? null
          : Number(row.starting_price),
      currency: row.currency as string,
      price_unit: row.price_unit as string,
      delivery_days: (row.delivery_days as number | null) ?? null,
    }));
  }

  /**
   * Skills are ACCOUNT-level (`user_skills`), shared with the freelancer
   * profile. Rendering them here is a second view of one set, not a copy.
   */
  private async findSkills(id: string): Promise<ConsultantPublicSkill[]> {
    const { data, error } = await this.supabase
      .from('user_skills')
      .select(CONSULTANT_SKILL_PUBLIC_SELECT)
      .eq('user_id', id);
    if (error) throw error;

    return ((data ?? []) as Record<string, unknown>[]).flatMap((row) => {
      const skill = firstOf(
        row.skill as Record<string, unknown> | Record<string, unknown>[] | null,
      );
      if (!skill) return [];
      return [
        {
          name: skill.name as string,
          slug: skill.slug as string,
          category: (skill.category as string | null) ?? null,
          proficiencyLevel: (row.proficiency_level as string | null) ?? null,
          yearsExperience: (row.years_experience as number | null) ?? null,
        },
      ];
    });
  }

  /**
   * The shared rate card. Null when unset — the profile renders nothing rather
   * than "rate on request", which is a claim the consultant did not make.
   */
  private async findRates(id: string): Promise<ConsultantPublicRates | null> {
    const { data, error } = await this.supabase
      .from('user_rate_settings')
      .select(CONSULTANT_RATE_PUBLIC_COLUMNS)
      .eq('user_id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const row = data as Record<string, unknown>;
    if (row.hourly_rate === null || row.hourly_rate === undefined) return null;
    return {
      hourlyRate: Number(row.hourly_rate),
      currency: (row.currency as string) ?? 'USD',
      availability: (row.availability as string | null) ?? null,
    };
  }

  /**
   * Published roadmap templates this consultant authored. Capped: the profile
   * shows a sample, and an author with fifty templates should not triple the
   * payload of a cold cache read for everyone looking at them.
   */
  private async findTemplates(id: string) {
    const { data, error } = await this.supabase
      .from('roadmap_public_templates')
      .select(CONSULTANT_TEMPLATE_PUBLIC_COLUMNS)
      .eq('owner_id', id)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(6);
    if (error) throw error;
    return data ?? [];
  }

  private async findLanguages(id: string) {
    const { data, error } = await this.supabase
      .from('user_languages')
      .select(CONSULTANT_LANGUAGE_PUBLIC_SELECT)
      .eq('user_id', id);
    if (error) throw error;

    return ((data ?? []) as Record<string, unknown>[]).flatMap((row) => {
      const language = firstOf(
        row.language as
          | Record<string, unknown>
          | Record<string, unknown>[]
          | null,
      );
      if (!language) return [];
      return [
        {
          code: language.code as string,
          name: language.name as string,
          fluency: (row.fluency_level as string | null) ?? null,
        },
      ];
    });
  }

  /**
   * Most recent first, with current roles above finished ones. Ordering here
   * rather than in the browser because "current" is a boolean and a date sort
   * alone would bury an ongoing role under a finished one that ended later.
   */
  private async findExperiences(id: string) {
    const { data, error } = await this.supabase
      .from('user_experiences')
      .select(CONSULTANT_EXPERIENCE_PUBLIC_COLUMNS)
      .eq('user_id', id)
      .order('is_current', { ascending: false })
      .order('start_date', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  private async findPortfolios(id: string) {
    const { data, error } = await this.supabase
      .from('user_portfolios')
      .select(CONSULTANT_PORTFOLIO_PUBLIC_COLUMNS)
      .eq('user_id', id)
      .order('position', { ascending: true })
      .limit(8);
    if (error) throw error;
    return data ?? [];
  }
}
