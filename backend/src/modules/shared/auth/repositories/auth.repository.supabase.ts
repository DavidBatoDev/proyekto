import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import { AuthRepository } from './auth.repository.interface';
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

  async getProfile(userId: string): Promise<Profile | null> {
    const result = (await this.supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()) as unknown as RepositoryResult<Profile>;

    if (result.error) return null;
    return result.data;
  }

  async completeOnboarding(userId: string): Promise<Profile> {
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
      .select()
      .maybeSingle()) as unknown as RepositoryResult<Profile>;

    if (updateResult.error) throw new Error(updateResult.error.message);
    if (updateResult.data) return updateResult.data;

    // A concurrent completion won the conditional update. Return the persisted
    // profile so the caller works from durable state, not this request.
    const profile = await this.getProfile(userId);
    if (!profile) throw new Error('Profile not found');
    return profile;
  }

  async updateProfile(
    userId: string,
    dto: Partial<Pick<Profile, 'display_name' | 'avatar_url' | 'bio'>>,
  ): Promise<Profile> {
    const result = (await this.supabase
      .from('profiles')
      .update(dto)
      .eq('id', userId)
      .select()
      .single()) as unknown as RepositoryResult<Profile>;

    if (result.error) throw new Error(result.error.message);
    if (!result.data) throw new Error('Profile not found');
    return result.data;
  }
}
