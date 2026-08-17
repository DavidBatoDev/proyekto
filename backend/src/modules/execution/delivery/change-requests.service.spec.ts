import { ChangeRequestsService } from './change-requests.service';
import type { ChangeRequestRow } from './delivery.types';

/**
 * Unit coverage for the change-request status machine and the notification
 * fan-out.
 *
 * Supabase is stubbed rather than mocked-as-a-database: every assertion here is
 * about a decision this service makes BEFORE it writes (which statuses admit
 * which verb, who gets told, whether a failed notification can sink a write).
 * The repo's no-mock-the-DB rule targets integration tests that assert on
 * persistence; those belong in the real-DB harness.
 */

type Queued = { data?: unknown; error?: unknown };

/** Chainable, awaitable Supabase query stub — same idiom as the authorization spec. */
function thenable(response: Queued) {
  const stub: Record<string, unknown> = {};
  for (const method of [
    'select',
    'insert',
    'update',
    'delete',
    'eq',
    'in',
    'order',
    'limit',
    'maybeSingle',
    'single',
    'overrideTypes',
  ]) {
    stub[method] = jest.fn(() => stub);
  }
  stub.then = (onFulfilled: (v: Queued) => unknown) =>
    Promise.resolve(response).then(onFulfilled);
  return stub;
}

function requestFixture(
  overrides: Partial<ChangeRequestRow> = {},
): ChangeRequestRow {
  return {
    id: 'cr-1',
    project_id: 'p1',
    roadmap_id: 'r1',
    reference: 7,
    title: 'Add Google OAuth',
    description: null,
    requested_by: 'requester-1',
    impact_scope: null,
    impact_timeline_days: 5,
    target_date_before: null,
    target_date_after: null,
    status: 'draft',
    decided_by: null,
    decided_at: null,
    decision_note: null,
    applied_change_id: null,
    applied_by: null,
    applied_at: null,
    created_at: '2026-08-17T00:00:00Z',
    updated_at: '2026-08-17T00:00:00Z',
    links: [],
    ...overrides,
  };
}

function build(
  options: {
    /** Rows `from()` hands out, in call order. */
    queued?: Array<ReturnType<typeof thenable>>;
    createNotification?: jest.Mock;
    deciders?: string[];
  } = {},
) {
  const queued = options.queued ?? [];
  let index = 0;
  const db = {
    from: () => {
      const next = queued[index++];
      if (!next) throw new Error(`Unexpected supabase.from() call #${index}`);
      return next;
    },
  };

  const authorization = {
    assertPermission: jest.fn().mockResolvedValue(undefined),
    listUsersWithPermission: jest
      .fn()
      .mockResolvedValue(options.deciders ?? ['decider-1']),
    // Present but never expected to be called — the assertion that it stays
    // unused is what keeps the persona from creeping back in. See the
    // "never asks who the consultant is" case below.
    getProjectConsultantId: jest.fn().mockResolvedValue('consultant-1'),
  };
  const audit = { log: jest.fn() };
  const notifications = {
    createNotification:
      options.createNotification ?? jest.fn().mockResolvedValue(undefined),
  };

  const service = new ChangeRequestsService(
    db as never,
    authorization as never,
    audit as never,
    notifications as never,
  );

  return { service, authorization, audit, notifications };
}

/** The recipients a run of notifications was actually sent to. */
const recipientsOf = (createNotification: jest.Mock): string[] =>
  createNotification.mock.calls.map(
    (call) => (call[0] as { user_id: string }).user_id,
  );

describe('ChangeRequestsService status machine', () => {
  // Each of these refuses BEFORE writing, so only the load query is queued.
  it.each(['submitted', 'approved', 'applied', 'withdrawn'] as const)(
    'refuses to submit a request in %s',
    async (status) => {
      const { service } = build({
        queued: [thenable({ data: requestFixture({ status }), error: null })],
      });

      await expect(service.submit('p1', 'cr-1', 'u1')).rejects.toThrow(
        new RegExp(`in ${status} can no longer be submitted`),
      );
    },
  );

  it.each(['draft', 'changes_requested'] as const)(
    'allows submitting from %s',
    async (status) => {
      const { service, notifications } = build({
        queued: [
          thenable({ data: requestFixture({ status }), error: null }),
          thenable({
            data: requestFixture({ status: 'submitted' }),
            error: null,
          }),
        ],
      });

      const result = await service.submit('p1', 'cr-1', 'u1');

      expect(result.status).toBe('submitted');
      expect(notifications.createNotification).toHaveBeenCalled();
    },
  );

  it.each(['draft', 'submitted', 'approved', 'rejected'] as const)(
    'only decides a submitted request, not one in %s',
    async (status) => {
      const { service } = build({
        queued: [
          thenable({ data: requestFixture({ status }), error: null }),
          // A second query only if it wrongly proceeds to the write.
          thenable({ data: requestFixture({ status }), error: null }),
        ],
      });

      const decide = service.decide('p1', 'cr-1', 'u1', {
        decision: 'approved',
      });

      if (status === 'submitted') {
        await expect(decide).resolves.toBeDefined();
      } else {
        await expect(decide).rejects.toThrow(
          /Only a submitted change request can be decided/,
        );
      }
    },
  );

  it.each(['applied', 'withdrawn'] as const)(
    'refuses to withdraw from %s',
    async (status) => {
      const { service } = build({
        queued: [thenable({ data: requestFixture({ status }), error: null })],
      });

      await expect(service.withdraw('p1', 'cr-1', 'u1')).rejects.toThrow(
        /cannot be withdrawn/,
      );
    },
  );

  it('marks applied only from approved', async () => {
    const { service } = build({
      queued: [
        thenable({ data: requestFixture({ status: 'draft' }), error: null }),
      ],
    });

    await expect(
      service.markApplied('p1', 'cr-1', 'u1', {
        applied_change_id: 'change-1',
      }),
    ).rejects.toThrow(
      /Only an approved change request can be marked as applied/,
    );
  });

  it('rejects an applied commit belonging to another project', async () => {
    const { service } = build({
      queued: [
        thenable({ data: requestFixture({ status: 'approved' }), error: null }),
        // roadmap_change_history lookup resolves to a different project.
        thenable({
          data: { change_id: 'change-1', project_id: 'other-project' },
          error: null,
        }),
      ],
    });

    await expect(
      service.markApplied('p1', 'cr-1', 'u1', {
        applied_change_id: 'change-1',
      }),
    ).rejects.toThrow(/does not belong to this project/);
  });

  it.each(['submitted', 'approved', 'applied'] as const)(
    'refuses link changes once %s',
    async (status) => {
      const { service } = build({
        queued: [thenable({ data: requestFixture({ status }), error: null })],
      });

      await expect(
        service.addLink('p1', 'cr-1', 'u1', { epic_id: 'e1' }),
      ).rejects.toThrow(/can no longer have its links changed/);
    },
  );

  it('rejects a link naming more than one target', async () => {
    const { service } = build({
      queued: [thenable({ data: requestFixture(), error: null })],
    });

    await expect(
      service.addLink('p1', 'cr-1', 'u1', {
        epic_id: 'e1',
        task_id: 't1',
      }),
    ).rejects.toThrow(/more than one entity/);
  });

  // change_request_links has no milestone_id column, unlike deliverable_links.
  // A milestone-only link reads as "no valid target given", and the message
  // names the columns this junction does have — which is the useful 400.
  it('rejects a milestone link, naming the targets it does accept', async () => {
    const { service } = build({
      queued: [thenable({ data: requestFixture(), error: null })],
    });

    await expect(
      service.addLink('p1', 'cr-1', 'u1', { milestone_id: 'm1' }),
    ).rejects.toThrow(
      /must target exactly one of: epic_id, feature_id, task_id, deliverable_id/,
    );
  });

  // The distinct "cannot target X here" branch needs a VALID target alongside
  // the unsupported one — otherwise the check above catches it first.
  it('rejects an unsupported target smuggled in beside a valid one', async () => {
    const { service } = build({
      queued: [thenable({ data: requestFixture(), error: null })],
    });

    await expect(
      service.addLink('p1', 'cr-1', 'u1', {
        epic_id: 'e1',
        milestone_id: 'm1',
      }),
    ).rejects.toThrow(/cannot target milestone_id here/);
  });
});

describe('ChangeRequestsService notifications', () => {
  it('tells everyone who can decide on submit, never the actor', async () => {
    const createNotification = jest.fn().mockResolvedValue(undefined);
    const { service } = build({
      queued: [
        thenable({ data: requestFixture(), error: null }),
        thenable({
          data: requestFixture({ status: 'submitted' }),
          error: null,
        }),
      ],
      createNotification,
      deciders: ['decider-1', 'decider-2'],
    });

    // The actor holds the decide permission themselves — raising and deciding
    // are separate permissions that one member can hold together.
    await service.submit('p1', 'cr-1', 'decider-1');

    const recipients = recipientsOf(createNotification);
    expect(recipients).not.toContain('decider-1');
    expect(recipients).toEqual(['decider-2']);
  });

  /**
   * The regression guard for the architectural rule: this is the execution
   * layer, so a project has members with permissions — not a client and a
   * consultant. An earlier version stapled `getProjectConsultantId` onto an
   * otherwise permission-derived recipient set. Without this assertion, the next
   * person adding a recipient has nothing telling them not to reach for it.
   */
  it('never asks who the consultant is', async () => {
    const { service, authorization } = build({
      queued: [
        thenable({ data: requestFixture(), error: null }),
        thenable({
          data: requestFixture({ status: 'submitted' }),
          error: null,
        }),
      ],
    });

    await service.submit('p1', 'cr-1', 'u1');

    expect(authorization.getProjectConsultantId).not.toHaveBeenCalled();
    expect(authorization.listUsersWithPermission).toHaveBeenCalledWith(
      'p1',
      'change_requests.decide',
    );
  });

  it('tells the requester on a decision, whichever way it went', async () => {
    const createNotification = jest.fn().mockResolvedValue(undefined);
    const { service } = build({
      queued: [
        thenable({
          data: requestFixture({ status: 'submitted' }),
          error: null,
        }),
        thenable({
          data: requestFixture({
            status: 'rejected',
            requested_by: 'requester-1',
          }),
          error: null,
        }),
      ],
      createNotification,
    });

    await service.decide('p1', 'cr-1', 'decider-1', { decision: 'rejected' });

    expect(recipientsOf(createNotification)).toEqual(['requester-1']);
    expect(
      (createNotification.mock.calls[0][0] as { type_name: string }).type_name,
    ).toBe('change_request_decided');
  });

  // Approval does not write the roadmap — somebody holding the decide permission
  // still has to apply it — so an approval has to reach them too, not just the
  // person who asked.
  it('tells the requester AND the deciders on approval', async () => {
    const createNotification = jest.fn().mockResolvedValue(undefined);
    const { service } = build({
      queued: [
        thenable({
          data: requestFixture({ status: 'submitted' }),
          error: null,
        }),
        thenable({
          data: requestFixture({
            status: 'approved',
            requested_by: 'requester-1',
          }),
          error: null,
        }),
      ],
      createNotification,
      deciders: ['decider-1', 'decider-2'],
    });

    await service.decide('p1', 'cr-1', 'decider-1', { decision: 'approved' });

    const recipients = recipientsOf(createNotification);
    // decider-1 approved it, so they are excluded as the actor.
    expect(recipients.sort()).toEqual(['decider-2', 'requester-1']);
  });

  // A rejection ends the thread: there is nothing left for a decider to do, so
  // it must not fan out to them the way an approval does.
  it('does not fan out to the deciders on a rejection', async () => {
    const createNotification = jest.fn().mockResolvedValue(undefined);
    const { service } = build({
      queued: [
        thenable({
          data: requestFixture({ status: 'submitted' }),
          error: null,
        }),
        thenable({
          data: requestFixture({
            status: 'rejected',
            requested_by: 'requester-1',
          }),
          error: null,
        }),
      ],
      createNotification,
      deciders: ['decider-1', 'decider-2'],
    });

    await service.decide('p1', 'cr-1', 'decider-1', { decision: 'rejected' });

    expect(recipientsOf(createNotification)).toEqual(['requester-1']);
  });

  it('carries the CR reference and a deep link in the payload', async () => {
    const createNotification = jest.fn().mockResolvedValue(undefined);
    const { service } = build({
      queued: [
        thenable({ data: requestFixture(), error: null }),
        thenable({
          data: requestFixture({ status: 'submitted' }),
          error: null,
        }),
      ],
      createNotification,
      deciders: ['decider-1'],
    });

    await service.submit('p1', 'cr-1', 'requester-1');

    const payload = createNotification.mock.calls[0][0] as {
      content: { message: string; change_request_id: string };
      link_url: string;
    };
    expect(payload.content.message).toContain('CR-007');
    expect(payload.content.change_request_id).toBe('cr-1');
    expect(payload.link_url).toBe('/project/p1/change-requests/cr-1');
  });

  // A stale push token must not make a legitimately submitted request look failed.
  it('still resolves the write when a notification throws', async () => {
    const createNotification = jest
      .fn()
      .mockRejectedValue(new Error('unknown notification type'));
    const { service } = build({
      queued: [
        thenable({ data: requestFixture(), error: null }),
        thenable({
          data: requestFixture({ status: 'submitted' }),
          error: null,
        }),
      ],
      createNotification,
    });

    await expect(service.submit('p1', 'cr-1', 'u1')).resolves.toMatchObject({
      status: 'submitted',
    });
  });

  it('still resolves the write when recipient resolution throws', async () => {
    const createNotification = jest.fn().mockResolvedValue(undefined);
    const { service, authorization } = build({
      queued: [
        thenable({ data: requestFixture(), error: null }),
        thenable({
          data: requestFixture({ status: 'submitted' }),
          error: null,
        }),
      ],
      createNotification,
    });
    authorization.listUsersWithPermission.mockRejectedValue(
      new Error('connection reset'),
    );

    await expect(service.submit('p1', 'cr-1', 'u1')).resolves.toMatchObject({
      status: 'submitted',
    });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('sends nothing when the only recipient is the actor', async () => {
    const createNotification = jest.fn().mockResolvedValue(undefined);
    const { service } = build({
      queued: [
        thenable({ data: requestFixture(), error: null }),
        thenable({
          data: requestFixture({ status: 'submitted' }),
          error: null,
        }),
      ],
      createNotification,
      deciders: ['solo-1'],
    });

    await service.submit('p1', 'cr-1', 'solo-1');

    expect(createNotification).not.toHaveBeenCalled();
  });
});
