export interface ProjectClientFlag {
  has_client: boolean;
}

import { attachMarketplaceEnrollmentFields } from '../../../../common/auth/consultant-capability';

interface ProjectAccessMemberRow {
  user_id?: unknown;
  origin?: unknown;
  has_direct_grant?: unknown;
  granted_at?: unknown;
  user?: unknown;
}

function timestamp(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function consultantOfRecordId(
  members: ProjectAccessMemberRow[],
): string | null {
  const consultant = members
    .filter(
      (member) =>
        member.origin === 'consultant' && typeof member.user_id === 'string',
    )
    .sort((a, b) => {
      const directDelta =
        Number(b.has_direct_grant === true) -
        Number(a.has_direct_grant === true);
      if (directDelta !== 0) return directDelta;
      return timestamp(b.granted_at) - timestamp(a.granted_at);
    })[0];
  return typeof consultant?.user_id === 'string' ? consultant.user_id : null;
}

/**
 * `has_client` answers "is there a party to bill other than the delivery
 * lead" — the owner is someone other than the consultant of record. The
 * consultant is never a field on the project: participants are `project_access`
 * rows, and callers that need one read the row whose origin is 'consultant'.
 */
export function attachProjectClientFlag<T extends object>(
  project: T,
): T & ProjectClientFlag {
  const record = project as Record<string, unknown>;
  const members = Array.isArray(record.members)
    ? (record.members as ProjectAccessMemberRow[])
    : [];
  const mappedMembers = members.map((member) => ({
    ...member,
    user:
      member.user && typeof member.user === 'object'
        ? attachMarketplaceEnrollmentFields(member.user)
        : member.user,
  }));

  return {
    ...project,
    ...(Array.isArray(record.members) ? { members: mappedMembers } : {}),
    has_client: record.owner_id !== consultantOfRecordId(members),
  };
}
