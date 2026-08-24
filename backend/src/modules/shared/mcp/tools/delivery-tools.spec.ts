import { registerDeliveryReadTools } from './delivery.tools';
import type { McpToolDeps } from './tool-helpers';

/** Fake McpServer that captures each tool's handler by name. */
function captureServer() {
  const handlers: Record<string, (args: any) => Promise<any>> = {};
  const server = {
    registerTool: (
      name: string,
      _cfg: unknown,
      cb: (a: any) => Promise<any>,
    ) => {
      handlers[name] = cb;
    },
  };
  return { server: server as any, handlers };
}

function depsWith(
  scopes: string[],
  services: Partial<McpToolDeps['s']> = {},
  permissions: unknown = { delivery: {} },
) {
  return {
    caller: { userId: 'user-1', scopes },
    s: {
      projectAuthz: {
        resolvePermissions: jest.fn(async () => permissions),
      },
      deliverables: { list: jest.fn(async () => []), get: jest.fn() },
      changeRequests: { list: jest.fn(async () => []), get: jest.fn() },
      risks: {
        list: jest.fn(async () => ({ items: [], can_view_internal: false })),
        get: jest.fn(),
        candidates: jest.fn(async () => ({
          blocked_tasks: [],
          at_risk_milestones: [],
        })),
      },
      decisions: { list: jest.fn(async () => []), get: jest.fn() },
      decisionCategories: { list: jest.fn(async () => []) },
      maxPageSize: 100,
      ...services,
    },
  } as unknown as McpToolDeps;
}

function isError(res: any): boolean {
  return res?.isError === true;
}
function errorCode(res: any): string {
  return JSON.parse(res.content[0].text).error;
}
function payload(res: any): any {
  return JSON.parse(res.content[0].text);
}

const PID = '11111111-1111-4111-8111-111111111111';

/** Every read tool, with a minimal valid argument set. */
const READ_TOOLS: Array<[string, Record<string, unknown>]> = [
  ['deliverables_list', { project_id: PID }],
  ['deliverable_get', { project_id: PID, deliverable_id: PID }],
  ['change_requests_list', { project_id: PID }],
  ['change_request_get', { project_id: PID, change_request_id: PID }],
  ['risks_list', { project_id: PID }],
  ['risk_get', { project_id: PID, risk_id: PID }],
  ['risk_candidates_list', { project_id: PID }],
  ['decisions_list', { project_id: PID }],
  ['decision_get', { project_id: PID, decision_id: PID }],
  ['decision_categories_list', { project_id: PID }],
];

describe('MCP delivery read tools', () => {
  it('registers exactly the intended tool set — no risk_get omission drift', () => {
    const { server, handlers } = captureServer();
    registerDeliveryReadTools(server, depsWith(['delivery:read']));
    expect(Object.keys(handlers).sort()).toEqual(
      READ_TOOLS.map(([name]) => name).sort(),
    );
  });

  it.each(READ_TOOLS)(
    'denies %s without delivery:read and never calls the service',
    async (name, args) => {
      const { server, handlers } = captureServer();
      const deps = depsWith(['projects:read']);
      registerDeliveryReadTools(server, deps);

      const res = await handlers[name](args);

      expect(isError(res)).toBe(true);
      expect(errorCode(res)).toBe('FORBIDDEN');
      // Nothing on any delivery service should have been touched.
      for (const svc of [
        deps.s.deliverables,
        deps.s.changeRequests,
        deps.s.risks,
        deps.s.decisions,
        deps.s.decisionCategories,
      ] as unknown as Array<Record<string, jest.Mock>>) {
        for (const fn of Object.values(svc)) {
          expect(fn).not.toHaveBeenCalled();
        }
      }
    },
  );

  it.each(READ_TOOLS)(
    'answers NOT_FOUND (never FORBIDDEN) for %s when the caller is not a member',
    async (name, args) => {
      const { server, handlers } = captureServer();
      // resolvePermissions -> null is how assertProjectViewer sees a non-member.
      const deps = depsWith(['delivery:read'], {}, null);
      registerDeliveryReadTools(server, deps);

      const res = await handlers[name](args);

      expect(isError(res)).toBe(true);
      // Leaking FORBIDDEN here would confirm the project exists to an outsider.
      expect(errorCode(res)).toBe('NOT_FOUND');
    },
  );

  describe('reviewer projection', () => {
    // REVIEWER_PROFILE_COLS selects email/first_name/last_name, but
    // DeliverableReviewerRow declares only three fields — so the PII is
    // invisible to the type system and these assertions are the only guard.
    const leakyRow = {
      id: 'dlv-1',
      title: 'Design system',
      reviewers: [
        {
          id: 'rev-1',
          reviewer_id: 'user-2',
          decision: 'pending',
          note: null,
          decided_at: null,
          reviewer: {
            id: 'user-2',
            display_name: 'Ada',
            avatar_url: 'https://cdn.example/a.png',
            email: 'ada@example.com',
            first_name: 'Ada',
            last_name: 'Lovelace',
          },
        },
      ],
    };

    it('strips reviewer email and name fields from deliverables_list', async () => {
      const { server, handlers } = captureServer();
      const deps = depsWith(['delivery:read'], {
        deliverables: { list: jest.fn(async () => [leakyRow]) } as any,
      });
      registerDeliveryReadTools(server, deps);

      const res = await handlers.deliverables_list({ project_id: PID });
      const text = res.content[0].text;

      expect(text).not.toContain('ada@example.com');
      expect(text).not.toContain('Lovelace');
      expect(text).not.toContain('avatar_url');
      const reviewer = payload(res).deliverables[0].reviewers[0];
      expect(reviewer.reviewer).toEqual({ id: 'user-2', display_name: 'Ada' });
      expect(reviewer.decision).toBe('pending');
    });

    it('strips them from deliverable_get too', async () => {
      const { server, handlers } = captureServer();
      const deps = depsWith(['delivery:read'], {
        deliverables: { get: jest.fn(async () => leakyRow) } as any,
      });
      registerDeliveryReadTools(server, deps);

      const res = await handlers.deliverable_get({
        project_id: PID,
        deliverable_id: PID,
      });

      expect(res.content[0].text).not.toContain('ada@example.com');
      expect(res.content[0].text).not.toContain('first_name');
    });
  });

  describe('paging', () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ id: `d-${i}` }));

    it('reports the true total and keeps the first n', async () => {
      const { server, handlers } = captureServer();
      const deps = depsWith(['delivery:read'], {
        decisions: { list: jest.fn(async () => rows) } as any,
      });
      registerDeliveryReadTools(server, deps);

      const res = await handlers.decisions_list({ project_id: PID, limit: 10 });
      const body = payload(res);

      expect(body.total).toBe(60);
      expect(body.decisions).toHaveLength(10);
      expect(body.decisions[0].id).toBe('d-0');
    });

    it('clamps a limit above MCP_MAX_PAGE_SIZE', async () => {
      const { server, handlers } = captureServer();
      const deps = depsWith(['delivery:read'], {
        decisions: { list: jest.fn(async () => rows) } as any,
        maxPageSize: 25,
      } as any);
      registerDeliveryReadTools(server, deps);

      const res = await handlers.decisions_list({
        project_id: PID,
        limit: 1000,
      });

      expect(payload(res).decisions).toHaveLength(25);
    });
  });

  it('unwraps risks_list and passes can_view_internal through untouched', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['delivery:read'], {
      risks: {
        list: jest.fn(async () => ({
          items: [{ id: 'r-1', kind: 'risk' }],
          can_view_internal: false,
        })),
      } as any,
    });
    registerDeliveryReadTools(server, deps);

    const body = payload(await handlers.risks_list({ project_id: PID }));

    // The model needs this to know the register it just read may be partial.
    expect(body.can_view_internal).toBe(false);
    expect(body.risks).toEqual([{ id: 'r-1', kind: 'risk' }]);
    expect(body.total).toBe(1);
  });

  it('passes the caller id from the token, never from the arguments', async () => {
    const list = jest.fn(async () => []);
    const { server, handlers } = captureServer();
    const deps = depsWith(['delivery:read'], {
      changeRequests: { list } as any,
    });
    registerDeliveryReadTools(server, deps);

    await handlers.change_requests_list({
      project_id: PID,
      user_id: 'someone-else',
      view: 'open',
    });

    expect(list).toHaveBeenCalledWith(PID, 'user-1', {
      status: undefined,
      view: 'open',
      requested_by: undefined,
    });
  });
});
