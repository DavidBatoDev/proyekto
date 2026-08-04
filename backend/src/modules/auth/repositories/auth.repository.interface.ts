import { Profile } from '../../../common/entities';
import { OnboardingLane } from '../dto/auth.dto';

export interface AuthRepository {
  getProfile(userId: string): Promise<Profile | null>;
  completeOnboarding(
    userId: string,
    data: {
      lane: OnboardingLane;
      intent: { freelancer: boolean; client: boolean };
    },
  ): Promise<Profile>;
  updateProfile(
    userId: string,
    data: Partial<Pick<Profile, 'display_name' | 'avatar_url' | 'bio'>>,
  ): Promise<Profile>;
}
