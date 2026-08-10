import type { AccountRole } from '../entities';

export interface ConsultantCapabilityProfile {
  role?: AccountRole | null;
  is_consultant_verified?: boolean | null;
}

export function isActiveConsultant(
  profile: ConsultantCapabilityProfile | null | undefined,
): boolean {
  return (
    profile?.role === 'consultant' && profile.is_consultant_verified === true
  );
}
