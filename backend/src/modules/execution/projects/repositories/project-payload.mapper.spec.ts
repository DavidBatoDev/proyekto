import { attachProjectClientFlag } from './project-payload.mapper';

describe('attachProjectClientFlag', () => {
  it('reports a client when the owner is not the consultant of record', () => {
    const project = attachProjectClientFlag({
      id: 'project-1',
      owner_id: 'client-1',
      members: [
        {
          user_id: 'consultant-1',
          origin: 'consultant',
          has_direct_grant: true,
          granted_at: '2026-08-11T01:00:00Z',
        },
      ],
    });

    expect(project.has_client).toBe(true);
  });

  it('reports no client when the owner is the consultant of record', () => {
    const project = attachProjectClientFlag({
      id: 'project-1',
      owner_id: 'consultant-1',
      members: [
        {
          user_id: 'consultant-1',
          origin: 'consultant',
          has_direct_grant: true,
          granted_at: '2026-08-11T01:00:00Z',
        },
      ],
    });

    expect(project.has_client).toBe(false);
  });

  it('prefers the direct grant when several consultant rows exist', () => {
    const project = attachProjectClientFlag({
      id: 'project-1',
      owner_id: 'newer',
      members: [
        {
          user_id: 'newer',
          origin: 'consultant',
          has_direct_grant: false,
          granted_at: '2026-08-12T02:00:00Z',
        },
        {
          user_id: 'direct',
          origin: 'consultant',
          has_direct_grant: true,
          granted_at: '2026-08-11T01:00:00Z',
        },
      ],
    });

    // 'direct' wins the tie-break, so the owner ('newer') is a distinct client.
    expect(project.has_client).toBe(true);
  });

  it('exposes no consultant identity on the payload', () => {
    const project = attachProjectClientFlag({
      id: 'project-1',
      owner_id: 'owner-1',
      members: [{ user_id: 'member-1', origin: 'invited' }],
    });

    expect(project).not.toHaveProperty('consultant_id');
    expect(project).not.toHaveProperty('consultant');
    expect(project.has_client).toBe(true);
  });

  it('synthesizes consultant badge fields on member profiles', () => {
    const project = attachProjectClientFlag({
      id: 'project-1',
      owner_id: 'client-1',
      members: [
        {
          user_id: 'consultant-1',
          origin: 'consultant',
          user: {
            id: 'consultant-1',
            consultant_profile: [{ status: 'verified' }],
          },
        },
      ],
    });

    expect(project.members[0].user).toMatchObject({
      consultant_status: 'verified',
      is_consultant_verified: true,
    });
  });

  it('derives the personal-workspace compatibility flag from the junction', () => {
    const project = attachProjectClientFlag({
      id: 'workspace-1',
      owner_id: 'user-1',
      personal_workspace: [{ user_id: 'user-1' }],
    });

    expect(project).toMatchObject({
      is_personal_workspace: true,
      category: null,
      project_state: null,
      skills: [],
      budget_range: null,
      funding_status: null,
      start_date: null,
      custom_start_date: null,
      role_permissions_json: {},
    });
    expect(project).not.toHaveProperty('personal_workspace');
  });
});
