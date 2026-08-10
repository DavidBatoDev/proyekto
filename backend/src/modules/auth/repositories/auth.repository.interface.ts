import { Profile } from '../../../common/entities';
import type { OnboardingSelection } from '../onboarding-role';

export interface AuthRepository {
  getProfile(userId: string): Promise<Profile | null>;
  completeOnboarding(
    userId: string,
    data: OnboardingSelection,
  ): Promise<Profile>;
  updateProfile(
    userId: string,
    data: Partial<Pick<Profile, 'display_name' | 'avatar_url' | 'bio'>>,
  ): Promise<Profile>;
}
