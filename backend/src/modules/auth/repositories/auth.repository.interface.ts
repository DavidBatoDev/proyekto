import { Profile } from '../../../common/entities';

export interface AuthRepository {
  getProfile(userId: string): Promise<Profile | null>;
  completeOnboarding(userId: string): Promise<Profile>;
  updateProfile(
    userId: string,
    data: Partial<Pick<Profile, 'display_name' | 'avatar_url' | 'bio'>>,
  ): Promise<Profile>;
}
