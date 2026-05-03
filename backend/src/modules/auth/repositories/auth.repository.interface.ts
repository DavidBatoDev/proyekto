import { Profile } from '../../../common/entities';
import { OnboardingLane } from '../dto/auth.dto';

export interface AuthRepository {
  getProfile(userId: string): Promise<Profile | null>;
  updateOnboarding(
    userId: string,
    data: { active_persona: string; display_name: string },
  ): Promise<Profile>;
  completeOnboarding(
    userId: string,
    data: {
      lane: OnboardingLane;
      intent: { freelancer: boolean; client: boolean };
      active_persona?: string;
    },
  ): Promise<Profile>;
  switchPersona(userId: string, persona: string): Promise<Profile>;
  updateProfile(
    userId: string,
    data: Partial<Pick<Profile, 'display_name' | 'avatar_url' | 'bio'>>,
  ): Promise<Profile>;
}
