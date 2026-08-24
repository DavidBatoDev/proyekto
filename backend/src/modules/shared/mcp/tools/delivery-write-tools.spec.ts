import { registerDeliveryWriteTools } from './delivery-write.tools';
import type { McpToolDeps } from './tool-helpers';

/** Fake McpServer that captures each tool's handler and config by name. */
function captureServer() {
  const handlers: Record<string, (args: any) => Promise<any>> = {};
  const configs: Record<string, any> = {};
  const server = {
    registerTool: (name: string, cfg: any, cb: (a: any) => Promise<any>) => {
      handlers[name] = cb;
      configs[name] = cfg;
    },
  };
  return { server: server as any, handlers, configs };
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
      deliverables: {
        create: jest.fn(async () => ({ id: 'dlv-1' })),
        update: jest.fn(async () => ({ id: 'dlv-1' })),
        submit: jest.fn(async () => ({ id: 'dlv-1' })),
        review: jest.fn(async () => ({ id: 'dlv-1' })),
      },
      changeRequests: {
        create: jest.fn(async () => ({ id: 'cr-1', status: 'draft' })),
        update: jest.fn(async () => ({ id: 'cr-1' })),
        submit: jest.fn(async () => ({ id: 'cr-1' })),
        withdraw: jest.fn(async () => ({ id: 'cr-1' })),
        decide: jest.fn(async () => ({ id: 'cr-1' })),
        markApplied: jest.fn(async () => ({ id: 'cr-1' })),
      },
      risks: {
        create: jest.fn(async () => ({ id: 'risk-1' })),
        update: jest.fn(async () => ({ id: 'risk-1' })),
      },
      decisions: {
        create: jest.fn(async () => ({ id: 'dec-1' })),
        update: jest.fn(async () => ({ id: 'dec-1' })),
        finalize: jest.fn(async () => ({ id: 'dec-1' })),
      },
      audit: { log: jest.fn() },
      maxPageSize: 100,
      ...services,
    },
  } as unknown as McpToolDeps;
}

/** The DTO a service method was called with (arg index 2 on every write). */
function dtoArg(mock: jest.Mock, index = 2): Record<string, unknown> {
  return (mock.mock.calls[0] as unknown[])[index] as Record<string, unknown>;
}

function isError(res: any): boolean {
  return res?.isError === true;
}
function errorCode(res: any): string {
  return JSON.parse(res.content[0].text).error;
}

const PID = '11111111-1111-4111-8111-111111111111';
const RID = '22222222-2222-4222-8222-222222222222';

/** Every write tool, with a minimal valid argument set. */
const WRITE_TOOLS: Array<[string, Record<string, unknown>]> = [
  ['deliverable_create', { project_id: PID, title: 'D' }],
  ['deliverable_update', { project_id: PID, deliverable_id: RID, title: 'D' }],
  ['deliverable_submit', { project_id: PID, deliverable_id: RID }],
  [
    'deliverable_review',
    { project_id: PID, deliverable_id: RID, decision: 'approved' },
  ],
  ['change_request_create', { project_id: PID, title: 'CR' }],
  [
    'change_request_update',
    { project_id: PID, change_request_id: RID, title: 'CR' },
  ],
  ['change_request_submit', { project_id: PID, change_request_id: RID }],
  ['change_request_withdraw', { project_id: PID, change_request_id: RID }],
  [
    'change_request_decide',
    { project_id: PID, change_request_id: RID, decision: 'approved' },
  ],
  [
    'change_request_mark_applied',
    { project_id: PID, change_request_id: RID, applied_change_id: RID },
  ],
  ['risk_create', { project_id: PID, kind: 'issue', title: 'R' }],
  ['risk_update', { project_id: PID, risk_id: RID, status: 'closed' }],
  [
    'decision_create',
    { project_id: PID, title: 'D', decision: 'we ship', status: 'proposed' },
  ],
  ['decision_update', { project_id: PID, decision_id: RID, title: 'D' }],
  ['decision_finalize', { project_id: PID, decision_id: RID }],
];

/** Everything that notifies people, is irreversible, or exercises authority. */
const DESTRUCTIVE = [
  'deliverable_submit',
  'deliverable_review',
  'change_request_submit',
  'change_request_withdraw',
  'change_request_decide',
  'change_request_mark_applied',
  'decision_finalize',
];

describe('MCP delivery write tools', () => {
  it('registers exactly the lifecycle tool set', () => {
    const { server, handlers } = captureServer();
    registerDeliveryWriteTools(server, depsWith(['delivery:write']));
    expect(Object.keys(handlers).sort()).toEqual(
      WRITE_TOOLS.map(([name]) => name).sort(),
    );
    // Sub-resource CRUD and the deletes live in delivery-manage.tools.ts
    // (registered separately); this file stays the lifecycle surface only.
    for (const name of Object.keys(handlers)) {
      expect(name).not.toMatch(
        /_remove$|_delete$|_link_|_attachment|_reviewer|_criterion|_option|category_/,
      );
    }
  });

  it('flags every notifying, irreversible or authority tool as destructive', () => {
    const { server, configs } = captureServer();
    registerDeliveryWriteTools(server, depsWith(['delivery:write']));
    for (const name of DESTRUCTIVE) {
      expect(configs[name].annotations.destructiveHint).toBe(true);
    }
  });

  it.each(WRITE_TOOLS)(
    'denies %s to a read-only delivery token and never calls the service',
    async (name, args) => {
      const { server, handlers } = captureServer();
      const deps = depsWith(['delivery:read']);
      registerDeliveryWriteTools(server, deps);

      const res = await handlers[name](args);

      expect(isError(res)).toBe(true);
      expect(errorCode(res)).toBe('FORBIDDEN');
      for (const svc of [
        deps.s.deliverables,
        deps.s.changeRequests,
        deps.s.risks,
        deps.s.decisions,
      ] as unknown as Array<Record<string, jest.Mock>>) {
        for (const fn of Object.values(svc)) {
          expect(fn).not.toHaveBeenCalled();
        }
      }
    },
  );

  it.each(WRITE_TOOLS)(
    'answers NOT_FOUND for %s when the caller is not a project member',
    async (name, args) => {
      const { server, handlers } = captureServer();
      const deps = depsWith(['delivery:write'], {}, null);
      registerDeliveryWriteTools(server, deps);

      const res = await handlers[name](args);

      expect(isError(res)).toBe(true);
      expect(errorCode(res)).toBe('NOT_FOUND');
    },
  );

  it('never writes an audit row — the delivery services already do', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['delivery:write']);
    registerDeliveryWriteTools(server, deps);

    for (const [name, args] of WRITE_TOOLS) {
      await handlers[name](args);
    }

    // A second mcp.* row would double-log and duplicate into the RAG index.
    // Provenance comes from the request origin marker instead.
    expect(
      (deps.s.audit as unknown as { log: jest.Mock }).log,
    ).not.toHaveBeenCalled();
  });

  describe('deliberate DTO divergences', () => {
    it('change_request_create never forwards `submit`, so it cannot fan out', async () => {
      const create = jest.fn(async () => ({ id: 'cr-1', status: 'draft' }));
      const { server, handlers } = captureServer();
      const deps = depsWith(['delivery:write'], {
        changeRequests: { create } as any,
      });
      registerDeliveryWriteTools(server, deps);

      await handlers.change_request_create({
        project_id: PID,
        title: 'CR',
        submit: true,
      });

      const dto = dtoArg(create);
      expect(dto).not.toHaveProperty('submit');
    });

    it('decision_create forwards neither decided_by nor source_chat_message_id', async () => {
      const create = jest.fn(async () => ({ id: 'dec-1' }));
      const { server, handlers } = captureServer();
      const deps = depsWith(['delivery:write'], {
        decisions: { create } as any,
      });
      registerDeliveryWriteTools(server, deps);

      await handlers.decision_create({
        project_id: PID,
        title: 'D',
        decision: 'we ship',
        status: 'final',
        decided_by: 'someone-else',
        source_chat_message_id: RID,
      });

      const dto = dtoArg(create);
      // Attribution forgery: the service writes decided_by verbatim on a final
      // decision, which would put words in a named person's mouth.
      expect(dto).not.toHaveProperty('decided_by');
      expect(dto).not.toHaveProperty('source_chat_message_id');
      expect(dto.status).toBe('final');
    });

    it('risk_create forwards visibility undefined rather than defaulting it', async () => {
      const create = jest.fn(async () => ({ id: 'risk-1' }));
      const { server, handlers } = captureServer();
      const deps = depsWith(['delivery:write'], { risks: { create } as any });
      registerDeliveryWriteTools(server, deps);

      await handlers.risk_create({
        project_id: PID,
        kind: 'risk',
        title: 'R',
        likelihood: 'high',
      });

      const dto = dtoArg(create);
      // Defaulting here would silently downgrade the service's `internal`
      // default and expose every agent-logged risk to the client.
      expect(dto.visibility).toBeUndefined();
    });

    it('deliverable_create never forwards reviewer_ids', async () => {
      const create = jest.fn(async () => ({ id: 'dlv-1' }));
      const { server, handlers } = captureServer();
      const deps = depsWith(['delivery:write'], {
        deliverables: { create } as any,
      });
      registerDeliveryWriteTools(server, deps);

      await handlers.deliverable_create({
        project_id: PID,
        title: 'D',
        reviewer_ids: ['user-9'],
      });

      const dto = dtoArg(create);
      // Naming a reviewer grants sign-off authority, and the create path skips
      // the project membership check that addReviewer enforces.
      expect(dto).not.toHaveProperty('reviewer_ids');
    });
  });

  it('passes the caller id from the token, never from the arguments', async () => {
    const decide = jest.fn(async () => ({ id: 'cr-1' }));
    const { server, handlers } = captureServer();
    const deps = depsWith(['delivery:write'], {
      changeRequests: { decide } as any,
    });
    registerDeliveryWriteTools(server, deps);

    await handlers.change_request_decide({
      project_id: PID,
      change_request_id: RID,
      decision: 'approved',
      user_id: 'someone-else',
    });

    expect(decide).toHaveBeenCalledWith(PID, RID, 'user-1', {
      decision: 'approved',
      decision_note: undefined,
    });
  });

  it('maps a service BadRequest to VALIDATION_FAILED', async () => {
    const { BadRequestException } = await import('@nestjs/common');
    const { server, handlers } = captureServer();
    const deps = depsWith(['delivery:write'], {
      changeRequests: {
        markApplied: jest.fn(async () => {
          throw new BadRequestException('That commit is not on this project.');
        }),
      } as any,
    });
    registerDeliveryWriteTools(server, deps);

    const res = await handlers.change_request_mark_applied({
      project_id: PID,
      change_request_id: RID,
      applied_change_id: RID,
    });

    expect(isError(res)).toBe(true);
    expect(errorCode(res)).toBe('VALIDATION_FAILED');
  });
});
