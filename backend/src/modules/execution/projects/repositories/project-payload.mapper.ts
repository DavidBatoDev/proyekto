export interface ProjectConsultantCompatibility {
  consultant_id: string | null;
  consultant: Record<string, unknown> | null;
  has_client: boolean;
}

interface ProjectAccessMemberRow {
  user_id?: unknown;
  origin?: unknown;
  has_direct_grant?: unknown;
  granted_at?: unknown;
  user?: Record<string, unknown> | null;
}

function timestamp(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Mobile compatibility shim for the retired projects.consultant_id column.
 * The consultant of record is derived from project_access and their profile
 * comes from the already-embedded member row.
 */
export function synthesizeProjectConsultant<T extends object>(
  project: T,
): T & ProjectConsultantCompatibility {
  const record = project as Record<string, unknown>;
  const members = Array.isArray(record.members)
    ? (record.members as ProjectAccessMemberRow[])
    : [];
  const consultantMember = members
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
  const consultantId =
    typeof consultantMember?.user_id === 'string'
      ? consultantMember.user_id
      : null;

  return {
    ...project,
    consultant_id: consultantId,
    consultant: consultantMember?.user ?? null,
    has_client: record.owner_id !== consultantId,
  };
}
