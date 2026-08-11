import { synthesizeProjectConsultant } from './project-payload.mapper';

describe('synthesizeProjectConsultant', () => {
  it('prefers the direct consultant grant and embeds its profile', () => {
    const directProfile = { id: 'direct', display_name: 'Direct Consultant' };
    const project = synthesizeProjectConsultant({
      id: 'project-1',
      owner_id: 'client-1',
      members: [
        {
          user_id: 'newer',
          origin: 'consultant',
          has_direct_grant: false,
          granted_at: '2026-08-12T02:00:00Z',
          user: { id: 'newer' },
        },
        {
          user_id: 'direct',
          origin: 'consultant',
          has_direct_grant: true,
          granted_at: '2026-08-11T01:00:00Z',
          user: directProfile,
        },
      ],
    });

    expect(project).toEqual(
      expect.objectContaining({
        consultant_id: 'direct',
        consultant: directProfile,
        has_client: true,
      }),
    );
  });

  it('synthesizes null consultant fields when no consultant row exists', () => {
    const project = synthesizeProjectConsultant({
      id: 'project-1',
      owner_id: 'owner-1',
      members: [{ user_id: 'member-1', origin: 'invited' }],
    });

    expect(project.consultant_id).toBeNull();
    expect(project.consultant).toBeNull();
    expect(project.has_client).toBe(true);
  });
});
