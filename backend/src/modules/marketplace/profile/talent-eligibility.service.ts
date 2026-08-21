import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';

export type TalentRequirement =
  | 'rate_settings'
  | 'portfolio'
  | 'profile_basics';

export interface TalentEligibility {
  eligible: boolean;
  missing: TalentRequirement[];
}

/**
 * Talent marketplace quality bar.
 *
 * Failure surfaces a `missing` array so the dashboard checklist UI can show
 * exactly what's left.
 *
 * Criteria:
 *   1. rate_settings    — hourly_rate + currency + availability all set
 *   2. portfolio        — at least one user_portfolios row
 *   3. profile_basics   — headline + bio + country all non-null
 *
 * Identity verification is deliberately NOT one of them. It used to be, and it
 * was the requirement people actually got stuck on: `is_verified` is set by an
 * admin, so talent could upload a passport, see it sitting there, and
 * still be refused with no idea how long the wait was. The open marketplaces
 * this competes with (Upwork, Fiverr) do not gate a first listing on it either.
 * The documents and the admin review still exist for consultant vetting -- this
 * only stops them blocking a freelancer from being discoverable.
 *
 * Run is cheap (4 small lookups) and re-evaluated on every profile fetch.
 * A later slice may materialize
 * `freelancer_eligible` as a column with triggers if marketplace search
 * gets hot enough to need it indexed.
 */
@Injectable()
export class TalentEligibilityService {
  private readonly logger = new Logger(TalentEligibilityService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async check(userId: string): Promise<TalentEligibility> {
    const [rate, portfolio, basics] = await Promise.all([
      this.hasRateSettings(userId),
      this.hasPortfolioItem(userId),
      this.hasProfileBasics(userId),
    ]);

    const missing: TalentRequirement[] = [];
    if (!rate) missing.push('rate_settings');
    if (!portfolio) missing.push('portfolio');
    if (!basics) missing.push('profile_basics');

    return {
      eligible: missing.length === 0,
      missing,
    };
  }

  private async hasRateSettings(userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('user_rate_settings')
      .select('hourly_rate, currency, availability')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      this.logger.error(`rate-settings lookup failed: ${error.message}`);
      return false;
    }
    if (!data) return false;
    return (
      data.hourly_rate !== null &&
      data.hourly_rate !== undefined &&
      typeof data.currency === 'string' &&
      data.currency.trim().length > 0 &&
      typeof data.availability === 'string' &&
      data.availability.trim().length > 0
    );
  }

  private async hasPortfolioItem(userId: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('user_portfolios')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      this.logger.error(`portfolio lookup failed: ${error.message}`);
      return false;
    }
    return (count ?? 0) >= 1;
  }

  private async hasProfileBasics(userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('headline, bio, country')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      this.logger.error(`profile-basics lookup failed: ${error.message}`);
      return false;
    }
    if (!data) return false;
    return (
      typeof data.headline === 'string' &&
      data.headline.trim().length > 0 &&
      typeof data.bio === 'string' &&
      data.bio.trim().length > 0 &&
      typeof data.country === 'string' &&
      data.country.trim().length > 0
    );
  }
}
