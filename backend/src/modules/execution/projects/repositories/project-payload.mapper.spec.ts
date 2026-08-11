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
});
