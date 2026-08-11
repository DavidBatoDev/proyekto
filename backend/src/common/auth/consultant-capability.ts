import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ConsultantEnrollmentStatus,
  FreelancerEnrollmentStatus,
} from '../entities';

interface EnrollmentStatusRow<TStatus extends string> {
  status?: TStatus | null;
}

export interface MarketplaceEnrollmentFields {
  consultant_status: ConsultantEnrollmentStatus | null;
  freelancer_status: FreelancerEnrollmentStatus | null;
  /** Computed compatibility field for pre-enrollment mobile bundles. */
  is_consultant_verified: boolean;
  /** Computed compatibility field for pre-enrollment mobile bundles. */
  is_public: boolean;
}

function relationRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  if (value && typeof value === 'object') return value as T;
  return null;
}

export function consultantStatusFromEmbed(
  value: unknown,
): ConsultantEnrollmentStatus | null {
  const status =
    relationRow<EnrollmentStatusRow<ConsultantEnrollmentStatus>>(value)?.status;
  return status === 'pending' ||
    status === 'verified' ||
    status === 'suspended' ||
    status === 'revoked'
    ? status
    : null;
}

export function consultantFlagFromEmbed(value: unknown): boolean {
  return consultantStatusFromEmbed(value) === 'verified';
}

export function freelancerStatusFromEmbed(
  value: unknown,
): FreelancerEnrollmentStatus | null {
  const status =
    relationRow<EnrollmentStatusRow<FreelancerEnrollmentStatus>>(value)?.status;
  return status === 'active' || status === 'paused' ? status : null;
}

export function attachMarketplaceEnrollmentFields<T extends object>(
  profile: T,
): T & MarketplaceEnrollmentFields {
  const record = profile as Record<string, unknown>;
  const consultantStatus = consultantStatusFromEmbed(record.consultant_profile);
  const freelancerStatus = freelancerStatusFromEmbed(record.freelancer_profile);
  const profileFields = { ...record };
  delete profileFields.consultant_profile;
  delete profileFields.freelancer_profile;

  return {
    ...profileFields,
    consultant_status: consultantStatus,
    freelancer_status: freelancerStatus,
    is_consultant_verified: consultantStatus === 'verified',
    is_public: freelancerStatus === 'active',
  } as T & MarketplaceEnrollmentFields;
}

export async function isActiveConsultantEnrollment(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from('consultant_profiles')
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'verified');

  return !error && (count ?? 0) > 0;
}
