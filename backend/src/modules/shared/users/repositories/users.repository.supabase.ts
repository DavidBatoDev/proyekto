import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import { UsersRepository } from './users.repository.interface';
import { Profile } from '../../../../common/entities';
import { UpdateUserDto } from '../dto/update-user.dto';
import type { AppearancePreferences } from '../dto/appearance-preferences.dto';
import { attachMarketplaceEnrollmentFields } from '../../../../common/auth/consultant-capability';

const PUBLIC_FIELDS =
  'id, display_name, avatar_url, banner_url, headline, bio, country, city, created_at, consultant_profile:consultant_profiles(status), freelancer_profile:freelancer_profiles(status)';

@Injectable()
export class SupabaseUsersRepository implements UsersRepository {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async findById(id: string): Promise<Profile | null> {
    const { data } = await this.supabase
      .from('profiles')
      .select(
        '*, consultant_profile:consultant_profiles(status), freelancer_profile:freelancer_profiles(status)',
      )
      .eq('id', id)
      .single();
    return data ? (attachMarketplaceEnrollmentFields(data) as Profile) : null;
  }

  async findPublicById(id: string): Promise<Partial<Profile> | null> {
    const { data } = await this.supabase
      .from('profiles')
      .select(PUBLIC_FIELDS)
      .eq('id', id)
      .single();
    return data
      ? (attachMarketplaceEnrollmentFields(data) as Partial<Profile>)
      : null;
  }

  async update(id: string, dto: UpdateUserDto): Promise<Profile> {
    const { data, error } = await this.supabase
      .from('profiles')
      .update(dto)
      .eq('id', id)
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Profile not found');
    const profile = await this.findById(id);
    if (!profile) throw new Error('Profile not found');
    return profile;
  }

  async updateAppearancePreferences(
    id: string,
    appearance: AppearancePreferences,
  ): Promise<AppearancePreferences> {
    const { data, error } = await this.supabase.rpc(
      'set_profile_appearance_preferences',
      {
        p_user_id: id,
        p_appearance: appearance,
      },
    );
    if (error) throw new Error(error.message);
    return data as AppearancePreferences;
  }
}
