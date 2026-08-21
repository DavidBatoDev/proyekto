import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import { AuthRepository, type AuthProfile } from './auth.repository.interface';
import { attachMarketplaceEnrollmentFields } from '../../../../common/auth/consultant-capability';
import type { Profile } from '../../../../common/entities';

interface RepositoryResult<T> {
  data: T | null;
  error: { message: string } | null;
}

interface ExistingOnboardingProfile {
  settings: unknown;
  has_completed_onboarding: boolean | null;
}

@Injectable()
export class SupabaseAuthRepository implements AuthRepository {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async getProfile(userId: string): Promise<AuthProfile | null> {
    const result = (await this.supabase
      .from('profiles')
      .select(
        '*, consultant_profile:consultant_profiles!consultant_profiles_user_id_fkey(status), talent_profile:talent_profiles(status)',
      )
      .eq('id', userId)
      .single()) as unknown as RepositoryResult<Record<string, unknown>>;

    if (result.error) return null;
    return result.data
      ? (attachMarketplaceEnrollmentFields(
          result.data,
        ) as unknown as AuthProfile)
      : null;
  }

  async completeOnboarding(userId: string): Promise<AuthProfile> {
    const existingResult = (await this.supabase
      .from('profiles')
      .select('settings, has_completed_onboarding')
      .eq('id', userId)
      .single()) as unknown as RepositoryResult<ExistingOnboardingProfile>;

    if (existingResult.error) throw new Error(existingResult.error.message);
    if (!existingResult.data) throw new Error('Profile not found');
    const existingProfile = existingResult.data;

    const existingSettings =
      typeof existingProfile.settings === 'object' &&
      existingProfile.settings !== null
        ? (existingProfile.settings as Record<string, unknown>)
        : {};

    if (existingProfile.has_completed_onboarding === true) {
      const profile = await this.getProfile(userId);
      if (!profile) throw new Error('Profile not found');
      return profile;
    }

    const updatePayload: Record<string, unknown> = {
      has_completed_onboarding: true,
      settings: {
        ...existingSettings,
        onboarding: { completed_at: new Date().toISOString() },
      },
    };

    const updateResult = (await this.supabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', userId)
      .or('has_completed_onboarding.eq.false,has_completed_onboarding.is.null')
      .select('id')
      .maybeSingle()) as unknown as RepositoryResult<{ id: string }>;

    if (updateResult.error) throw new Error(updateResult.error.message);
    if (updateResult.data) {
      const profile = await this.getProfile(userId);
      if (!profile) throw new Error('Profile not found');
      return profile;
    }

    // A concurrent completion won the conditional update. Return the persisted
    // profile so the caller works from durable state, not this request.
    const profile = await this.getProfile(userId);
    if (!profile) throw new Error('Profile not found');
    return profile;
  }

  async updateProfile(
    userId: string,
    dto: Partial<Pick<Profile, 'display_name' | 'avatar_url' | 'bio'>>,
  ): Promise<AuthProfile> {
    const result = (await this.supabase
      .from('profiles')
      .update(dto)
      .eq('id', userId)
      .select('id')
      .single()) as unknown as RepositoryResult<{ id: string }>;

    if (result.error) throw new Error(result.error.message);
    if (!result.data) throw new Error('Profile not found');
    const profile = await this.getProfile(userId);
    if (!profile) throw new Error('Profile not found');
    return profile;
  }
}
