import { Profile } from '../../../../common/entities';
import type { MarketplaceEnrollmentFields } from '../../../../common/auth/consultant-capability';

export type AuthProfile = Profile & MarketplaceEnrollmentFields;

export interface AuthRepository {
  getProfile(userId: string): Promise<AuthProfile | null>;
  completeOnboarding(userId: string): Promise<AuthProfile>;
  updateProfile(
    userId: string,
    data: Partial<Pick<Profile, 'display_name' | 'avatar_url' | 'bio'>>,
  ): Promise<AuthProfile>;
}
