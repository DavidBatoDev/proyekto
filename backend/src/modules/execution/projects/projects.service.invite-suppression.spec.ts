import { ProjectsService } from './projects.service';
import type { ProjectsRepository } from './repositories/projects.repository.interface';
import type { Project } from '../../../common/entities';

/**
 * A Team-page invitation must respect an unsubscribe.
 *
 * The asymmetry this pins is the point: suppression stops the EMAIL but not the
 * INVITATION. An admin deliberately invited a specific person, who may already
 * have an account and will find the invite waiting at /invites — what they
 * opted out of is being mailed about it. (The mention-invite path skips the
 * whole thing instead, because there the recipient is a stranger being pulled
 * into a project they have never heard of.)
 */
describe('ProjectsService — invite email honours the suppression list', () => {
  const project: Project = {
    id: 'project-1',
    title: 'Analytical Engine',
    status: 'active',
    owner_id: 'client-1',
    consultant: { id: 'consultant-1' },
    has_client: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  function build(suppressed: boolean) {
    const mailer = { send: jest.fn().mockResolvedValue({ sent: true }) };

    // Held separately so assertions reference the mock, not a method plucked
    // off the typed repo (which trips @typescript-eslint/unbound-method).
    const inviteByEmail = jest.fn().mockResolvedValue({
      id: 'invite-1',
      // No invitee_id: keeps the in-app notification out of this test.
      invitee_email: 'ada@example.test',
      message: null,
      invited_position: null,
    });

    const repo = {
      findById: jest.fn().mockResolvedValue(project),
      inviteByEmail,
      getInviterProfile: jest
        .fn()
        .mockResolvedValue({ displayName: 'Grace Hopper', avatarUrl: null }),
    } as unknown as ProjectsRepository;

    const supabase = {
      from: (table: string) => {
        if (table === 'email_suppressions') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: suppressed ? { email: 'ada@example.test' } : null,
                    error: null,
                  }),
              }),
            }),
          };
        }
        // Anything else this path touches (activity log, etc.) is inert here.
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }),
          }),
          insert: () => Promise.resolve({ data: null, error: null }),
        };
      },
    };

    const service = new ProjectsService(
      repo,
      { createNotification: jest.fn() } as any,
      {
        getUserProjectRole: jest.fn().mockResolvedValue('owner'),
        assertRole: jest.fn(),
        assertPermission: jest.fn(),
        assertActionOutranks: jest.fn().mockResolvedValue(undefined),
        resolvePermissions: jest.fn(),
        roleSatisfies: jest.fn().mockReturnValue(true),
        getProjectConsultantId: jest.fn().mockResolvedValue('consultant-1'),
        grant: jest.fn(),
        revoke: jest.fn(),
      } as any,
      { attach: jest.fn(), detach: jest.fn(), list: jest.fn() } as any,
      {
        syncUser: jest.fn().mockResolvedValue(null),
        setUserRole: jest.fn().mockResolvedValue(null),
        setUserCapabilities: jest.fn().mockResolvedValue(undefined),
        setUserCapabilitiesByMemberId: jest.fn().mockResolvedValue(null),
      } as any,
      supabase as any,
      {
        getAuthTtlSeconds: jest.fn().mockReturnValue(45),
        getDashboardTtlSeconds: jest.fn().mockReturnValue(45),
        rememberJson: jest.fn((_k: string, _t: number, loader: any) =>
          loader(),
        ),
      } as any,
      {
        invalidateAllDashboardCache: jest.fn().mockResolvedValue(undefined),
      } as any,
      { get: jest.fn().mockReturnValue('https://www.proyekto.test') } as any,
      {
        provisionDefaultChannels: jest.fn().mockResolvedValue(undefined),
      } as any,
      { assertActivationReady: jest.fn() } as any,
      mailer as any,
      { log: jest.fn() } as any,
      { stopRunningLogsForProject: jest.fn() } as any,
    );

    return { service, mailer, inviteByEmail };
  }

  it('still creates the invitation, but sends no email, when suppressed', async () => {
    const { service, mailer, inviteByEmail } = build(true);

    const result = (await service.inviteByEmail('project-1', 'caller-1', {
      email: 'ada@example.test',
      role: 'member',
    } as never)) as { email_delivery?: { sent: boolean; reason?: string } };

    // The invitation itself is unaffected — this is the asymmetry.
    expect(inviteByEmail).toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
    expect(result.email_delivery?.sent).toBe(false);
    // The admin has to be told, or they assume it arrived.
    expect(result.email_delivery?.reason).toMatch(/unsubscribed/i);
  });

  it('sends normally when the address is not suppressed', async () => {
    const { service, mailer } = build(false);

    await service.inviteByEmail('project-1', 'caller-1', {
      email: 'ada@example.test',
      role: 'member',
    } as never);

    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect(mailer.send.mock.calls[0][0]).toMatchObject({
      to: 'ada@example.test',
    });
  });
});
