import { Profile } from '../../../common/entities';
import { UpdateUserDto } from '../dto/update-user.dto';
import type { AppearancePreferences } from '../dto/appearance-preferences.dto';

export interface UsersRepository {
  findById(id: string): Promise<Profile | null>;
  findPublicById(id: string): Promise<Partial<Profile> | null>;
  update(id: string, dto: UpdateUserDto): Promise<Profile>;
  updateAppearancePreferences(
    id: string,
    appearance: AppearancePreferences,
  ): Promise<AppearancePreferences>;
}
