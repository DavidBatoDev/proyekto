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

/** One published catalog entry as a directory card renders it. */
export interface ConsultantCardService {
  id: string;
  title: string;
  cover_url: string | null;
  starting_price: number | null;
  currency: string;
  price_unit: string;
  delivery_days: number | null;
}

interface ConsultantCatalogSummary {
  startingFrom: { amount: number; currency: string; unit: string } | null;
  services: ConsultantCardService[];
  count: number;
}

/**
 * The options the browse rail can offer, derived from the verified roster
 * rather than hardcoded.
 */
export interface ConsultantDirectoryFacets {
  /** How many verified consultants sit under each category, by slug. */
  categories: { slug: string; count: number }[];
  /** The same per speciality, scoped by its category slug. */
  subcategories: { categorySlug: string; slug: string; count: number }[];
  countries: { value: string; count: number }[];
  languages: { code: string; name: string; count: number }[];
  priceRange: { min: number; max: number } | null;
  total: number;
}

/**
 * The intersection of every candidate list a filter produced, or null when no
 * filter produced one - which means "do not constrain by id at all", and is
 * deliberately different from an empty list, which means "nothing matched".
 */
function intersectIds(sets: string[][]): string[] | null {
  if (sets.length === 0) return null;
  return sets.reduce((accumulator, current) => {
    const lookup = new Set(current);
    return accumulator.filter((id) => lookup.has(id));
  });
}

/**
 * PostgREST parses `or=(...)` as a comma-separated list with parenthesised
 * groups, so a comma or bracket in the term would change the filter rather
 * than being searched for. `%` and `_` are ilike wildcards and are stripped
 * for the same reason.
 */
function sanitizeSearchTerm(term: string | undefined): string | null {
  if (!term) return null;
  const cleaned = term
    .replace(/[,()%_*\\"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return cleaned.length >= 2 ? cleaned : null;
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
    /**
     * EVERY field `loadDirectory` reads has to appear here. The key is a hash
     * of this object, so a filter left out makes two different searches share
     * one cache entry -- `q=security` and `q=design` under the same category
     * would return whichever ran first, for the whole TTL. Adding a filter to
     * the DTO means adding it here in the same commit.
     */
    const normalized = {
      category: query.category?.trim().toLowerCase() || undefined,
      subcategory: query.subcategory?.trim().toLowerCase() || undefined,
      topic: query.topic?.trim().toLowerCase() || undefined,
      q: query.q?.trim().toLowerCase() || undefined,
      country: query.country?.trim().toLowerCase() || undefined,
      language: query.language?.trim().toLowerCase() || undefined,
      budgetMin: query.budgetMin,
      budgetMax: query.budgetMax,
      hourlyMin: query.hourlyMin,
      hourlyMax: query.hourlyMax,
      offersHourly: query.offersHourly,
      availableNow: query.availableNow,
      hasServices: query.hasServices,
      deliveryDays: query.deliveryDays,
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

  /**
   * The facets the browse rail offers.
   *
   * Published from the data rather than hardcoded, so the rail can only ever
   * offer a country or a language somebody is actually in - an option that
   * always returns nothing is worse than no option at all.
   */
  async facets(options?: CacheReadOptions): Promise<ConsultantDirectoryFacets> {
    return this.cache.rememberJson(
      REDIS_CACHE_KEYS.consultantsFacets,
      this.cache.getPublicTtlSeconds(),
      () => this.loadFacets(),
      {
        onStatus: options?.onCacheStatus,
        indexKey: REDIS_CACHE_KEYS.consultantsIndex,
      },
    );
  }

  private async loadFacets(): Promise<ConsultantDirectoryFacets> {
    const { data: profileRows, error } = await this.supabase
      .from('profiles')
      .select(
        'id, country, consultant_profile:consultant_profiles!consultant_profiles_user_id_fkey!inner(status)',
      )
      .eq('consultant_profile.status', 'verified');
    if (error) throw error;

    const rows = (profileRows ?? []) as Record<string, unknown>[];
    const ids = rows.map((row) => row.id as string);

    const countries = new Map<string, number>();
    for (const row of rows) {
      const country = (row.country as string | null)?.trim();
      if (!country) continue;
      countries.set(country, (countries.get(country) ?? 0) + 1);
    }

    const [languages, priceRange, placements] = await Promise.all([
      this.loadLanguageFacet(ids),
      this.loadPriceBounds(ids),
      this.loadPlacementFacet(ids),
    ]);

    return {
      ...placements,
      countries: [...countries.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
      languages,
      priceRange,
      total: ids.length,
    };
  }

  private async loadLanguageFacet(
    userIds: string[],
  ): Promise<{ code: string; name: string; count: number }[]> {
    if (userIds.length === 0) return [];
    const { data, error } = await this.supabase
      .from('user_languages')
      .select('user_id, language:languages!inner(code, name)')
      .in('user_id', userIds);
    if (error) throw error;

    const counts = new Map<string, { name: string; count: number }>();
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const language = firstOf(
        row.language as Record<string, unknown> | Record<string, unknown>[],
      );
      if (!language) continue;
      const code = language.code as string;
      const current = counts.get(code);
      counts.set(code, {
        name: language.name as string,
        count: (current?.count ?? 0) + 1,
      });
    }

    return [...counts.entries()]
      .map(([code, entry]) => ({ code, name: entry.name, count: entry.count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  /**
   * Consultants per category and per speciality.
   *
   * Counted over DISTINCT users: somebody placed in three specialities of one
   * category is one consultant on that category's row, and a count that said
   * three would promise a roster the page cannot show.
   */
  private async loadPlacementFacet(userIds: string[]): Promise<{
    categories: { slug: string; count: number }[];
    subcategories: { categorySlug: string; slug: string; count: number }[];
  }> {
    if (userIds.length === 0) return { categories: [], subcategories: [] };

    const { data, error } = await this.supabase
      .from('consultant_subcategories')
      .select(
        'user_id, subcategory:marketplace_subcategories!inner(slug, is_active, category:marketplace_categories!inner(slug, is_active))',
      )
      .in('user_id', userIds)
      .eq('subcategory.is_active', true)
      .eq('subcategory.category.is_active', true);
    if (error) throw error;

    const byCategory = new Map<string, Set<string>>();
    const bySubcategory = new Map<string, Set<string>>();

    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const subcategory = firstOf(
        row.subcategory as Record<string, unknown> | Record<string, unknown>[],
      );
      const category = firstOf(
        subcategory?.category as
          | Record<string, unknown>
          | Record<string, unknown>[]
          | undefined,
      );
      // A de-activated branch narrows the embed rather than dropping the row,
      // so it arrives empty and must not become a facet.
      if (!subcategory || !category) continue;

      const userId = row.user_id as string;
      const categorySlug = category.slug as string;
      const subcategorySlug = subcategory.slug as string;

      const categoryUsers = byCategory.get(categorySlug) ?? new Set<string>();
      categoryUsers.add(userId);
      byCategory.set(categorySlug, categoryUsers);

      const key = `${categorySlug}/${subcategorySlug}`;
      const subcategoryUsers = bySubcategory.get(key) ?? new Set<string>();
      subcategoryUsers.add(userId);
      bySubcategory.set(key, subcategoryUsers);
    }

    return {
      categories: [...byCategory.entries()].map(([slug, users]) => ({
        slug,
        count: users.size,
      })),
      subcategories: [...bySubcategory.entries()].map(([key, users]) => {
        const [categorySlug, slug] = key.split('/');
        return { categorySlug, slug, count: users.size };
      }),
    };
  }

  private async loadPriceBounds(
    userIds: string[],
  ): Promise<{ min: number; max: number } | null> {
    if (userIds.length === 0) return null;
    const { data, error } = await this.supabase
      .from('consultant_services')
      .select('starting_price')
      .in('user_id', userIds)
      .eq('status', 'published')
      .not('starting_price', 'is', null);
    if (error) throw error;

    const amounts = ((data ?? []) as Record<string, unknown>[])
      .map((row) => Number(row.starting_price))
      .filter((amount) => Number.isFinite(amount));
    if (amounts.length === 0) return null;
    return { min: Math.min(...amounts), max: Math.max(...amounts) };
  }

  private async loadDirectory(
    query: ConsultantDirectoryQueryDto,
  ): Promise<ConsultantDirectoryPage> {
    const { limit, offset } = query;

    /**
     * Every filter that lives in another table contributes a candidate id
     * list, and the lists are intersected. Done this way rather than as
     * embedded inner joins because PostgREST has no DISTINCT: a consultant
     * with three matching services would otherwise arrive three times, and the
     * exact count would be wrong as well as the page.
     */
    const candidateSets: string[][] = [];

    if (query.category) {
      const subcategoryIds = await this.taxonomy.resolveSubcategoryIds(
        query.category,
        query.subcategory,
      );
      if (subcategoryIds === null) {
        throw new NotFoundException('Category not found');
      }
      candidateSets.push(
        subcategoryIds.length ? await this.findMembers(subcategoryIds) : [],
      );
    }

    if (query.topic) {
      const topicIds = await this.taxonomy.resolveTopicIds(
        query.category,
        query.subcategory,
        query.topic,
      );
      if (topicIds === null) {
        throw new NotFoundException('Topic not found');
      }
      candidateSets.push(await this.findTopicMembers(topicIds));
    }

    if (query.language) {
      candidateSets.push(await this.findSpeakers(query.language));
    }

    if (
      query.offersHourly !== undefined ||
      query.availableNow !== undefined ||
      query.hourlyMin !== undefined ||
      query.hourlyMax !== undefined
    ) {
      candidateSets.push(await this.findByRateCard(query));
    }

    if (
      query.hasServices !== undefined ||
      query.budgetMin !== undefined ||
      query.budgetMax !== undefined ||
      query.deliveryDays !== undefined
    ) {
      candidateSets.push(await this.findByCatalog(query));
    }

    const candidateIds = intersectIds(candidateSets);

    // Short-circuit: an empty candidate set can never match a profile, and
    // `.in('id', [])` is a wasted round trip.
    if (candidateIds && candidateIds.length === 0) {
      return { items: [], total: 0, limit, offset };
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
    if (query.country) builder = builder.ilike('country', query.country.trim());

    const search = sanitizeSearchTerm(query.q);
    if (search) {
      builder = builder.or(
        `display_name.ilike.%${search}%,headline.ilike.%${search}%,bio.ilike.%${search}%`,
      );
    }

    const { data, count, error } = await builder
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const items = (data ?? []).map(toPublicConsultant);
    const ids = items.map(
      (item) => (item as Record<string, unknown>).id as string,
    );

    // Everything a card renders, batched for the whole page rather than per
    // row: the directory shows up to 48 of them, and a per-card lookup would
    // be 48 round trips on every cold cache read.
    const [catalog, skills, languages, rates] = await Promise.all([
      this.findCatalogSummaries(ids),
      this.findSkillNames(ids),
      this.findLanguageNames(ids),
      this.findRateCards(ids),
    ]);

    return {
      items: items.map((item) => {
        const id = (item as Record<string, unknown>).id as string;
        const entry = catalog.get(id);
        return {
          ...item,
          starting_from: entry?.startingFrom ?? null,
          services: entry?.services ?? [],
          service_count: entry?.count ?? 0,
          skills: skills.get(id) ?? [],
          languages: languages.get(id) ?? [],
          rates: rates.get(id) ?? null,
        };
      }),
      total: count ?? 0,
      limit,
      offset,
    };
  }

  /** Consultants who speak a given language, by ISO code. */
  private async findSpeakers(code: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('user_languages')
      .select('user_id, language:languages!inner(code)')
      .eq('language.code', code.trim().toLowerCase());
    if (error) throw error;
    return [...new Set((data ?? []).map((row) => row.user_id as string))];
  }

  /**
   * The rate-card filters. One row per user, so no dedupe is needed - but it
   * still returns an id list so it can be intersected with the others.
   */
  private async findByRateCard(
    query: ConsultantDirectoryQueryDto,
  ): Promise<string[]> {
    let builder = this.supabase.from('user_rate_settings').select('user_id');

    if (query.offersHourly) builder = builder.not('hourly_rate', 'is', null);
    if (query.availableNow) builder = builder.eq('availability', 'available');
    if (query.hourlyMin !== undefined) {
      builder = builder.gte('hourly_rate', query.hourlyMin);
    }
    if (query.hourlyMax !== undefined) {
      builder = builder.lte('hourly_rate', query.hourlyMax);
    }

    const { data, error } = await builder;
    if (error) throw error;
    return [...new Set((data ?? []).map((row) => row.user_id as string))];
  }

  /**
   * The catalog filters - budget, delivery time, and "has published anything".
   *
   * Budget is matched against any published service rather than only the
   * cheapest: a consultant with a $200 audit and a $40k rebuild belongs in
   * both brackets, and matching the minimum alone would hide them from
   * everyone with a real budget.
   */
  private async findByCatalog(
    query: ConsultantDirectoryQueryDto,
  ): Promise<string[]> {
    let builder = this.supabase
      .from('consultant_services')
      .select('user_id')
      .eq('status', 'published');

    if (query.budgetMin !== undefined) {
      builder = builder.gte('starting_price', query.budgetMin);
    }
    if (query.budgetMax !== undefined) {
      builder = builder.lte('starting_price', query.budgetMax);
    }
    if (query.deliveryDays !== undefined) {
      builder = builder.lte('delivery_days', query.deliveryDays);
    }

    const { data, error } = await builder;
    if (error) throw error;
    return [...new Set((data ?? []).map((row) => row.user_id as string))];
  }

  /**
   * The published catalog for a page of cards: the cheapest entry, which
   * becomes the "From $X" line, plus the first few covers the card renders as
   * a strip. Unpublished rows are excluded here as well as by RLS, because
   * this client bypasses RLS.
   */
  private async findCatalogSummaries(
    userIds: string[],
  ): Promise<Map<string, ConsultantCatalogSummary>> {
    const result = new Map<string, ConsultantCatalogSummary>();
    if (userIds.length === 0) return result;

    const { data, error } = await this.supabase
      .from('consultant_services')
      .select(
        'id, user_id, title, cover_url, starting_price, currency, price_unit, delivery_days, position',
      )
      .in('user_id', userIds)
      .eq('status', 'published')
      .order('position', { ascending: true });
    if (error) throw error;

    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const userId = row.user_id as string;
      const entry = result.get(userId) ?? {
        startingFrom: null,
        services: [],
        count: 0,
      };
      entry.count += 1;

      // numeric(12,2) arrives as a string from PostgREST; the API must not
      // hand the browser a price it has to parse.
      const amount =
        row.starting_price === null || row.starting_price === undefined
          ? null
          : Number(row.starting_price);

      if (
        amount !== null &&
        (entry.startingFrom === null || amount < entry.startingFrom.amount)
      ) {
        entry.startingFrom = {
          amount,
          currency: row.currency as string,
          unit: row.price_unit as string,
        };
      }

      if (entry.services.length < 3) {
        entry.services.push({
          id: row.id as string,
          title: row.title as string,
          cover_url: (row.cover_url as string | null) ?? null,
          starting_price: amount,
          currency: row.currency as string,
          price_unit: row.price_unit as string,
          delivery_days: (row.delivery_days as number | null) ?? null,
        });
      }

      result.set(userId, entry);
    }
    return result;
  }

  /** The skill chips on a card. Capped: a card shows a sample, not a CV. */
  private async findSkillNames(
    userIds: string[],
  ): Promise<Map<string, { name: string; slug: string }[]>> {
    const result = new Map<string, { name: string; slug: string }[]>();
    if (userIds.length === 0) return result;

    const { data, error } = await this.supabase
      .from('user_skills')
      .select('user_id, skill:skills!inner(name, slug)')
      .in('user_id', userIds);
    if (error) throw error;

    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const skill = firstOf(
        row.skill as Record<string, unknown> | Record<string, unknown>[],
      );
      if (!skill) continue;
      const userId = row.user_id as string;
      const list = result.get(userId) ?? [];
      if (list.length < 12) {
        list.push({ name: skill.name as string, slug: skill.slug as string });
      }
      result.set(userId, list);
    }
    return result;
  }

  private async findLanguageNames(
    userIds: string[],
  ): Promise<Map<string, { code: string; name: string }[]>> {
    const result = new Map<string, { code: string; name: string }[]>();
    if (userIds.length === 0) return result;

    const { data, error } = await this.supabase
      .from('user_languages')
      .select('user_id, language:languages!inner(code, name)')
      .in('user_id', userIds);
    if (error) throw error;

    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const language = firstOf(
        row.language as Record<string, unknown> | Record<string, unknown>[],
      );
      if (!language) continue;
      const userId = row.user_id as string;
      const list = result.get(userId) ?? [];
      list.push({
        code: language.code as string,
        name: language.name as string,
      });
      result.set(userId, list);
    }
    return result;
  }

  /**
   * The card's hourly line. `min_project_budget` and `weekly_hours` stay out of
   * this on purpose - they are negotiating positions and appear on no public
   * surface.
   */
  private async findRateCards(
    userIds: string[],
  ): Promise<Map<string, ConsultantPublicRates>> {
    const result = new Map<string, ConsultantPublicRates>();
    if (userIds.length === 0) return result;

    const { data, error } = await this.supabase
      .from('user_rate_settings')
      .select('user_id, hourly_rate, currency, availability')
      .in('user_id', userIds);
    if (error) throw error;

    for (const row of (data ?? []) as Record<string, unknown>[]) {
      if (row.hourly_rate === null || row.hourly_rate === undefined) continue;
      result.set(row.user_id as string, {
        hourlyRate: Number(row.hourly_rate),
        currency: (row.currency as string) ?? 'USD',
        availability: (row.availability as string | null) ?? null,
      });
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

  /** The topic-level counterpart to findMembers, deduped for the same reason. */
  private async findTopicMembers(topicIds: string[]): Promise<string[]> {
    if (topicIds.length === 0) return [];

    const { data, error } = await this.supabase
      .from('consultant_topics')
      .select('user_id')
      .in('topic_id', topicIds);

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
   * Skills are ACCOUNT-level (`user_skills`), shared with the talent
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
