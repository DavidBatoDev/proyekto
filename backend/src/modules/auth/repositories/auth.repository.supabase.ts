import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { AuthRepository } from './auth.repository.interface';
import { Profile } from '../../../common/entities';
import { OnboardingLane } from '../dto/auth.dto';

@Injectable()
export class SupabaseAuthRepository implements AuthRepository {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async getProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) return null;
    return data as Profile;
  }

  async updateOnboarding(
    userId: string,
    dto: { active_persona: string; display_name: string },
  ): Promise<Profile> {
    const { data, error } = await this.supabase
      .from('profiles')
      .update({
        active_persona: dto.active_persona,
        display_name: dto.display_name,
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data as Profile;
  }

  async completeOnboarding(
    userId: string,
    dto: {
      lane: OnboardingLane;
      intent: { freelancer: boolean; client: boolean };
      active_persona?: string;
    },
  ): Promise<Profile> {
    const { data: existingProfile, error: existingError } = await this.supabase
      .from('profiles')
      .select('settings')
      .eq('id', userId)
      .single();

    if (existingError) throw new Error(existingError.message);

    const existingSettings =
      existingProfile &&
      typeof existingProfile.settings === 'object' &&
      existingProfile.settings !== null
        ? (existingProfile.settings as Record<string, unknown>)
        : {};

    const updatePayload: Record<string, unknown> = {
      has_completed_onboarding: true,
      settings: {
        ...existingSettings,
        onboarding: {
          lane: dto.lane,
          intent: {
            freelancer: Boolean(dto.intent?.freelancer),
            client: Boolean(dto.intent?.client),
          },
          completed_at: new Date().toISOString(),
        },
      },
    };

    if (dto.active_persona) {
      updatePayload.active_persona = dto.active_persona;
    }

    const { data, error } = await this.supabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data as Profile;
  }

  async switchPersona(userId: string, persona: string): Promise<Profile> {
    const { data, error } = await this.supabase
      .from('profiles')
      .update({ active_persona: persona })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Profile not found');
    return data as Profile;
  }

  async updateProfile(
    userId: string,
    dto: Partial<Pick<Profile, 'display_name' | 'avatar_url' | 'bio'>>,
  ): Promise<Profile> {
    const { data, error } = await this.supabase
      .from('profiles')
      .update(dto)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data as Profile;
  }
}
