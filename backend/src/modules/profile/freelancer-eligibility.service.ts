import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';

export type FreelancerRequirement =
  | 'identity'
  | 'rate_settings'
  | 'portfolio'
  | 'profile_basics';

export interface FreelancerEligibility {
  eligible: boolean;
  missing: FreelancerRequirement[];
}

/**
 * Freelancer-persona quality bar.
 *
 * The user can flip into the freelancer persona only when ALL four criteria
 * pass. Failure surfaces a `missing` array so the dashboard checklist UI
 * can show exactly what's left.
 *
 * Criteria (see specs/platform-foundations/requirements.md):
 *   1. identity         — verified ID document or verifications row
 *   2. rate_settings    — hourly_rate + currency + availability all set
 *   3. portfolio        — at least one user_portfolios row
 *   4. profile_basics   — headline + bio + country all non-null
 *
 * Run is cheap (4 small lookups). Re-evaluated on every profile fetch and
 * on every switchPersona('freelancer') call. Slice 3+ may materialize
 * `freelancer_eligible` as a column with triggers if marketplace search
 * gets hot enough to need it indexed.
 */
@Injectable()
export class FreelancerEligibilityService {
  private readonly logger = new Logger(FreelancerEligibilityService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async check(userId: string): Promise<FreelancerEligibility> {
    const [identity, rate, portfolio, basics] = await Promise.all([
      this.hasVerifiedIdentity(userId),
      this.hasRateSettings(userId),
      this.hasPortfolioItem(userId),
      this.hasProfileBasics(userId),
    ]);

    const missing: FreelancerRequirement[] = [];
    if (!identity) missing.push('identity');
    if (!rate) missing.push('rate_settings');
    if (!portfolio) missing.push('portfolio');
    if (!basics) missing.push('profile_basics');

    return {
      eligible: missing.length === 0,
      missing,
    };
  }

  private async hasVerifiedIdentity(userId: string): Promise<boolean> {
    // Verified ID document.
    const { count: docCount, error: docErr } = await this.supabase
      .from('user_identity_documents')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_verified', true);

    if (docErr) {
      this.logger.error(`identity-document lookup failed: ${docErr.message}`);
    }
    if ((docCount ?? 0) > 0) return true;

    // Fallback: verifications row of type='identity', status='verified'.
    const { count: verCount, error: verErr } = await this.supabase
      .from('user_verifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('type', 'identity')
      .eq('status', 'verified');

    if (verErr) {
      this.logger.error(`user_verifications lookup failed: ${verErr.message}`);
    }
    return (verCount ?? 0) > 0;
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
