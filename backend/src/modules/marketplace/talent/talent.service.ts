import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import {
  AppCacheStatus,
  RedisDataCacheService,
} from '../../../common/cache/redis-data-cache.service';
import { REDIS_CACHE_KEYS } from '../../../common/cache/redis-cache.keys';
import {
  PUBLIC_EXPERIENCE_COLUMNS,
  PUBLIC_LANGUAGE_SELECT,
  PUBLIC_PORTFOLIO_COLUMNS,
  PUBLIC_RATE_COLUMNS,
  PUBLIC_SKILL_SELECT,
  PUBLIC_SPECIALIZATION_COLUMNS,
  TALENT_PUBLIC_COLUMNS,
} from '../shared/public-profile.selects';

/**
 * The public talent profile — the seller-side twin of
 * `ConsultantsService.findOne`. Same rules apply: the endpoint is `@Public()`
 * on SUPABASE_ADMIN, so the named allowlists in
 * `../shared/public-profile.selects` and the `.eq()` filters here ARE the
 * security boundary; the inner join on `talent_profiles.status = 'active'`
 * makes paused or never-listed accounts 404 rather than linger.
 *
 * No services in this payload — the web page reads the published catalog from
 * the existing `GET /api/service-offerings/public/by-user/:userId`. No
 * `user_stats` either: nothing writes ratings yet, and the profile renders
 * reviews as prose, never an invented 0.0.
 */

export interface TalentPublicSkill {
  name: string;
  slug: string;
  category: string | null;
  proficiencyLevel: string | null;
  yearsExperience: number | null;
}

export interface TalentPublicRates {
  hourlyRate: number | null;
  currency: string;
  availability: string | null;
}

export interface TalentPublicSpecialization {
  id: string;
  category: string;
  subCategory: string | null;
  yearsOfExperience: number | null;
  description: string | null;
}

interface CacheReadOptions {
  onCacheStatus?: (status: AppCacheStatus) => void;
}

function firstOf<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

type Row = Record<string, unknown>;

@Injectable()
export class TalentService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly cache: RedisDataCacheService,
  ) {}

  async findOne(id: string, options?: CacheReadOptions) {
    return this.cache.rememberJson(
      REDIS_CACHE_KEYS.talentProfile(id),
      this.cache.getPublicTtlSeconds(),
      async () => {
        const { data } = await this.supabase
          .from('profiles')
          .select(TALENT_PUBLIC_COLUMNS)
          .eq('id', id)
          .eq('talent_profile.status', 'active')
          .single();
        if (!data) throw new NotFoundException('Talent not found');

        // One round trip each, in parallel, inside the same cache closure — so
        // the fan-out is paid once per TTL rather than on every request.
        const [
          specializations,
          skills,
          rates,
          languages,
          experiences,
          portfolios,
        ] = await Promise.all([
          this.findSpecializations(id),
          this.findSkills(id),
          this.findRates(id),
          this.findLanguages(id),
          this.findExperiences(id),
          this.findPortfolios(id),
        ]);

        // The enrollment embed proved the listing is active; the flag is what
        // the page renders, the raw embed stays server-side.
        const { talent_profile: _talentProfile, ...profile } = data as Row;
        return {
          ...profile,
          is_open_to_work: true,
          specializations,
          skills,
          rates,
          languages,
          experiences,
          portfolios,
        };
      },
      { onStatus: options?.onCacheStatus },
    );
  }

  private async findSpecializations(
    id: string,
  ): Promise<TalentPublicSpecialization[]> {
    const { data, error } = await this.supabase
      .from('user_specializations')
      .select(PUBLIC_SPECIALIZATION_COLUMNS)
      .eq('user_id', id);
    if (error) throw error;

    return ((data ?? []) as Row[]).map((row) => ({
      id: row.id as string,
      category: row.category as string,
      subCategory: (row.sub_category as string | null) ?? null,
      yearsOfExperience:
        row.years_of_experience === null ||
        row.years_of_experience === undefined
          ? null
          : Number(row.years_of_experience),
      description: (row.description as string | null) ?? null,
    }));
  }

  private async findSkills(id: string): Promise<TalentPublicSkill[]> {
    const { data, error } = await this.supabase
      .from('user_skills')
      .select(PUBLIC_SKILL_SELECT)
      .eq('user_id', id);
    if (error) throw error;

    return ((data ?? []) as Row[]).flatMap((row) => {
      const skill = firstOf(row.skill as Row | Row[] | null);
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
   * than "rate on request", which is a claim the talent did not make.
   */
  private async findRates(id: string): Promise<TalentPublicRates | null> {
    const { data, error } = await this.supabase
      .from('user_rate_settings')
      .select(PUBLIC_RATE_COLUMNS)
      .eq('user_id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const row = data as Row;
    if (row.hourly_rate === null || row.hourly_rate === undefined) return null;
    return {
      hourlyRate: Number(row.hourly_rate),
      currency: (row.currency as string) ?? 'USD',
      availability: (row.availability as string | null) ?? null,
    };
  }

  private async findLanguages(id: string) {
    const { data, error } = await this.supabase
      .from('user_languages')
      .select(PUBLIC_LANGUAGE_SELECT)
      .eq('user_id', id);
    if (error) throw error;

    return ((data ?? []) as Row[]).flatMap((row) => {
      const language = firstOf(row.language as Row | Row[] | null);
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
   * Most recent first, with current roles above finished ones — same ordering
   * rationale as the consultant profile.
   */
  private async findExperiences(id: string) {
    const { data, error } = await this.supabase
      .from('user_experiences')
      .select(PUBLIC_EXPERIENCE_COLUMNS)
      .eq('user_id', id)
      .order('is_current', { ascending: false })
      .order('start_date', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  private async findPortfolios(id: string) {
    const { data, error } = await this.supabase
      .from('user_portfolios')
      .select(PUBLIC_PORTFOLIO_COLUMNS)
      .eq('user_id', id)
      .order('position', { ascending: true })
      .limit(8);
    if (error) throw error;
    return data ?? [];
  }
}
