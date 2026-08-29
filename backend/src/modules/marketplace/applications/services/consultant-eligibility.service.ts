import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';

export type ConsultantRequirement =
  | 'profile_basics'
  | 'expertise_placement'
  | 'work_links'
  | 'rate_settings'
  | 'identity_document';

export interface ConsultantEligibility {
  eligible: boolean;
  missing: ConsultantRequirement[];
}

/**
 * Consultant application quality bar.
 *
 * Mirrors TalentEligibilityService: cheap parallel lookups, fail-closed on
 * query errors, and a `missing` array of raw enum values so the wizard's
 * review step can render a checklist instead of a joined error string.
 *
 * Unlike the talent bar, identity verification IS a requirement here — the
 * document itself, not its admin approval. Vetted consultants are the
 * platform's differentiator, and the reviewer cannot vet an identity that
 * was never uploaded. What stays out is `user_identity_documents.is_verified`:
 * blocking submission on an admin-set flag would recreate the stuck-waiting
 * problem the talent bar was rebuilt to avoid.
 */
@Injectable()
export class ConsultantEligibilityService {
  private readonly logger = new Logger(ConsultantEligibilityService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async check(userId: string): Promise<ConsultantEligibility> {
    const [basics, placement, links, rate, identity] = await Promise.all([
      this.hasProfileBasics(userId),
      this.hasExpertisePlacement(userId),
      this.hasWorkLinks(userId),
      this.hasRateSettings(userId),
      this.hasIdentityDocument(userId),
    ]);

    const missing: ConsultantRequirement[] = [];
    if (!basics) missing.push('profile_basics');
    if (!placement) missing.push('expertise_placement');
    if (!links) missing.push('work_links');
    if (!rate) missing.push('rate_settings');
    if (!identity) missing.push('identity_document');

    return { eligible: missing.length === 0, missing };
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

  private async hasExpertisePlacement(userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('consultant_applications')
      .select(
        'id, placements:consultant_application_placements(subcategory_id, years_experience)',
      )
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      this.logger.error(`placement lookup failed: ${error.message}`);
      return false;
    }
    // At least one speciality, and every pick carries its years — a pick
    // without years is a half-answered question, not evidence.
    const placements = (data?.placements ?? []) as Array<{
      years_experience: number | null;
    }>;
    return (
      placements.length >= 1 &&
      placements.every(
        (placement) =>
          placement.years_experience !== null &&
          placement.years_experience !== undefined,
      )
    );
  }

  private async hasWorkLinks(userId: string): Promise<boolean> {
    const [application, portfolios] = await Promise.all([
      this.supabase
        .from('consultant_applications')
        .select('linkedin_url')
        .eq('user_id', userId)
        .maybeSingle(),
      this.supabase
        .from('user_portfolios')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId),
    ]);

    if (application.error) {
      this.logger.error(`linkedin lookup failed: ${application.error.message}`);
      return false;
    }
    if (portfolios.error) {
      this.logger.error(`portfolio lookup failed: ${portfolios.error.message}`);
      return false;
    }

    const linkedin = (
      application.data as { linkedin_url: string | null } | null
    )?.linkedin_url;
    return (
      typeof linkedin === 'string' &&
      linkedin.trim().length > 0 &&
      (portfolios.count ?? 0) >= 1
    );
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

  private async hasIdentityDocument(userId: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('user_identity_documents')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      this.logger.error(`identity-document lookup failed: ${error.message}`);
      return false;
    }
    return (count ?? 0) >= 1;
  }
}
