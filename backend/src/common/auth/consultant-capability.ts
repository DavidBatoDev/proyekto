export interface ConsultantCapabilityProfile {
  is_consultant_verified?: boolean | null;
}

export function isActiveConsultant(
  profile: ConsultantCapabilityProfile | null | undefined,
): boolean {
  return profile?.is_consultant_verified === true;
}
