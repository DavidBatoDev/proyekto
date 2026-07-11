import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { UsersRepository } from './users.repository.interface';
import { Profile } from '../../../common/entities';
import { UpdateUserDto } from '../dto/update-user.dto';
import type { AppearancePreferences } from '../dto/appearance-preferences.dto';

const PUBLIC_FIELDS =
  'id, display_name, avatar_url, banner_url, headline, bio, country, city, active_persona, is_consultant_verified, created_at';

@Injectable()
export class SupabaseUsersRepository implements UsersRepository {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async findById(id: string): Promise<Profile | null> {
    const { data } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single();
    return (data as Profile) || null;
  }

  async findPublicById(id: string): Promise<Partial<Profile> | null> {
    const { data } = await this.supabase
      .from('profiles')
      .select(PUBLIC_FIELDS)
      .eq('id', id)
      .single();
    return (data as Partial<Profile>) || null;
  }

  async update(id: string, dto: UpdateUserDto): Promise<Profile> {
    const { data, error } = await this.supabase
      .from('profiles')
      .update(dto)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as Profile;
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
