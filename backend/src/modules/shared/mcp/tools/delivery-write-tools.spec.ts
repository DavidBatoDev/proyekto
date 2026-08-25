import { ForbiddenException } from '@nestjs/common';
import { registerDeliveryWriteTools } from './delivery-write.tools';
import type { McpToolDeps } from './tool-helpers';

/** Fake McpServer that captures each tool's handler and definition by name. */
function captureServer() {
  const handlers: Record<string, (args: any) => Promise<any>> = {};
  const defs: Record<string, any> = {};
  const server = {
    registerTool: (name: string, cfg: any, cb: (a: any) => Promise<any>) => {
      handlers[name] = cb;
      defs[name] = cfg;
    },
  };
  return { server: server as any, handlers, defs };
}

function depsWith(scopes: string[], services: Partial<McpToolDeps['s']> = {}) {
  return {
    caller: { userId: 'user-1', scopes },
    s: {
      deliverables: {
        create: jest.fn(),
        update: jest.fn(),
        submit: jest.fn(),
        review: jest.fn(),
      },
      changeRequests: {
        create: jest.fn(),
        update: jest.fn(),
        submit: jest.fn(),
        withdraw: jest.fn(),
        decide: jest.fn(),
        markApplied: jest.fn(),
      },
      risks: { create: jest.fn(), update: jest.fn() },
      decisions: {
        create: jest.fn(),
        update: jest.fn(),
        finalize: jest.fn(),
      },
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

const PROJECT = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const CHANGE = '33333333-3333-4333-8333-333333333333';

const ALL_TOOLS = [
  'change_request_create',
  'change_request_decide',
  'change_request_mark_applied',
  'change_request_submit',
  'change_request_update',
  'change_request_withdraw',
  'decision_create',
  'decision_finalize',
  'decision_update',
  'deliverable_create',
  'deliverable_review',
  'deliverable_submit',
  'deliverable_update',
  'risk_create',
  'risk_update',
];

describe('MCP delivery write tools', () => {
  it('registers all fifteen tools', () => {
    const { server, handlers } = captureServer();
    registerDeliveryWriteTools(server, depsWith(['delivery:write']));
    expect(Object.keys(handlers).sort()).toEqual(ALL_TOOLS);
  });

  it('flags every lifecycle verb destructive so hosts confirm first', () => {
    const { server, defs } = captureServer();
    registerDeliveryWriteTools(server, depsWith(['delivery:write']));
    for (const name of [
      'deliverable_submit',
      'deliverable_review',
      'change_request_create', // may raise-and-submit, which notifies
      'change_request_submit',
      'change_request_withdraw',
      'change_request_decide',
      'change_request_mark_applied',
      'decision_finalize',
    ]) {
      expect(defs[name].annotations.destructiveHint).toBe(true);
    }
  });

  it('denies every tool to a token without delivery:write', async () => {
    const { server, handlers } = captureServer();
    // delivery:read is NOT enough to mutate.
    const deps = depsWith(['delivery:read']);
    registerDeliveryWriteTools(server, deps);

    for (const handler of Object.values(handlers)) {
      const res = await handler({
        project_id: PROJECT,
        deliverable_id: ID,
        change_request_id: ID,
        decision_id: ID,
        risk_id: ID,
        title: 't',
        decision: 'approved',
        kind: 'risk',
        applied_change_id: CHANGE,
      });
      expect(isError(res)).toBe(true);
      expect(errorCode(res)).toBe('FORBIDDEN');
    }
    expect(deps.s.deliverables.create).not.toHaveBeenCalled();
    expect(deps.s.changeRequests.decide).not.toHaveBeenCalled();
  });

  it('creates a deliverable with the nested register payload in one call', async () => {
    const { server, handlers } = captureServer();
    const create = jest.fn().mockResolvedValue({ id: ID });
    const deps = depsWith(['delivery:write'], {
      deliverables: { create } as any,
    });
    registerDeliveryWriteTools(server, deps);

    await handlers.deliverable_create({
      project_id: PROJECT,
      title: 'Homepage v2',
      criteria: ['Hero renders', 'Lighthouse ≥ 90'],
      reviewer_ids: [ID],
      owner_id: ID,
    });
    expect(create).toHaveBeenCalledWith(PROJECT, 'user-1', {
      title: 'Homepage v2',
      criteria: ['Hero renders', 'Lighthouse ≥ 90'],
      reviewer_ids: [ID],
      owner_id: ID,
    });
  });

  it('routes the change-request decision with its note', async () => {
    const { server, handlers } = captureServer();
    const decide = jest.fn().mockResolvedValue({ id: ID });
    const deps = depsWith(['delivery:write'], {
      changeRequests: { decide } as any,
    });
    registerDeliveryWriteTools(server, deps);

    await handlers.change_request_decide({
      project_id: PROJECT,
      change_request_id: ID,
      decision: 'approved',
      decision_note: 'Scope fits the sprint.',
    });
    expect(decide).toHaveBeenCalledWith(PROJECT, ID, 'user-1', {
      decision: 'approved',
      decision_note: 'Scope fits the sprint.',
    });
  });

  it('passes mark_applied the roadmap change id, never writing the roadmap', async () => {
    const { server, handlers } = captureServer();
    const markApplied = jest.fn().mockResolvedValue({ id: ID });
    const deps = depsWith(['delivery:write'], {
      changeRequests: { markApplied } as any,
    });
    registerDeliveryWriteTools(server, deps);

    await handlers.change_request_mark_applied({
      project_id: PROJECT,
      change_request_id: ID,
      applied_change_id: CHANGE,
    });
    expect(markApplied).toHaveBeenCalledWith(PROJECT, ID, 'user-1', {
      applied_change_id: CHANGE,
    });
  });

  it('maps a service 403 (missing live permission) to FORBIDDEN', async () => {
    const { server, handlers } = captureServer();
    const finalize = jest
      .fn()
      .mockRejectedValue(new ForbiddenException('decisions.edit required'));
    const deps = depsWith(['delivery:write'], {
      decisions: { finalize } as any,
    });
    registerDeliveryWriteTools(server, deps);

    const res = await handlers.decision_finalize({
      project_id: PROJECT,
      decision_id: ID,
    });
    expect(isError(res)).toBe(true);
    expect(errorCode(res)).toBe('FORBIDDEN');
  });
});
