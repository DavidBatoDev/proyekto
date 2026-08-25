import { NotFoundException } from '@nestjs/common';
import { registerDeliveryTools } from './delivery.tools';
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

function depsWith(scopes: string[], services: Partial<McpToolDeps['s']> = {}) {
  return {
    caller: { userId: 'user-1', scopes },
    s: {
      deliverables: { list: jest.fn(), get: jest.fn() },
      changeRequests: { list: jest.fn(), get: jest.fn() },
      risks: { list: jest.fn() },
      decisions: { list: jest.fn(), get: jest.fn() },
      decisionCategories: { list: jest.fn() },
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

const PROJECT = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';

describe('MCP delivery read tools', () => {
  it('registers all eight tools', () => {
    const { server, handlers } = captureServer();
    registerDeliveryTools(server, depsWith(['delivery:read']));
    expect(Object.keys(handlers).sort()).toEqual([
      'change_request_get',
      'change_requests_list',
      'decision_categories_list',
      'decision_get',
      'decisions_list',
      'deliverable_get',
      'deliverables_list',
      'risks_list',
    ]);
  });

  it('denies every tool to a token without delivery:read', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['projects:read', 'roadmaps:read']);
    registerDeliveryTools(server, deps);

    for (const [name, handler] of Object.entries(handlers)) {
      const res = await handler({
        project_id: PROJECT,
        deliverable_id: ID,
        change_request_id: ID,
        decision_id: ID,
      });
      expect(isError(res)).toBe(true);
      expect(errorCode(res)).toBe('FORBIDDEN');
      expect(name).toBeDefined();
    }
    expect(deps.s.deliverables.list).not.toHaveBeenCalled();
    expect(deps.s.risks.list).not.toHaveBeenCalled();
  });

  it('delegates deliverables_list and clamps to the requested limit', async () => {
    const { server, handlers } = captureServer();
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `d${i}` }));
    const list = jest.fn().mockResolvedValue(rows);
    const deps = depsWith(['delivery:read'], {
      deliverables: { list } as any,
    });
    registerDeliveryTools(server, deps);

    const res = await handlers.deliverables_list({
      project_id: PROJECT,
      status: 'in_progress',
      limit: 2,
    });
    expect(list).toHaveBeenCalledWith(PROJECT, 'user-1', {
      status: 'in_progress',
    });
    const body = payload(res);
    expect(body.total).toBe(5);
    expect(body.items).toHaveLength(2);
  });

  it('passes change-request filters through and keeps row order', async () => {
    const { server, handlers } = captureServer();
    const list = jest.fn().mockResolvedValue([{ id: 'cr1' }, { id: 'cr2' }]);
    const deps = depsWith(['delivery:read'], {
      changeRequests: { list, get: jest.fn() } as any,
    });
    registerDeliveryTools(server, deps);

    const res = await handlers.change_requests_list({
      project_id: PROJECT,
      view: 'awaiting_decision',
    });
    expect(list).toHaveBeenCalledWith(PROJECT, 'user-1', {
      status: undefined,
      view: 'awaiting_decision',
      requested_by: undefined,
    });
    expect(payload(res).items.map((r: any) => r.id)).toEqual(['cr1', 'cr2']);
  });

  it('surfaces the risks service result shape (items + can_view_internal)', async () => {
    const { server, handlers } = captureServer();
    const list = jest.fn().mockResolvedValue({
      items: [{ id: 'r1' }],
      can_view_internal: false,
    });
    const deps = depsWith(['delivery:read'], { risks: { list } as any });
    registerDeliveryTools(server, deps);

    const res = await handlers.risks_list({ project_id: PROJECT });
    const body = payload(res);
    expect(body.total).toBe(1);
    expect(body.can_view_internal).toBe(false);
  });

  it('maps a service 404 to NOT_FOUND', async () => {
    const { server, handlers } = captureServer();
    const get = jest
      .fn()
      .mockRejectedValue(new NotFoundException('Decision not found'));
    const deps = depsWith(['delivery:read'], {
      decisions: { list: jest.fn(), get } as any,
    });
    registerDeliveryTools(server, deps);

    const res = await handlers.decision_get({
      project_id: PROJECT,
      decision_id: ID,
    });
    expect(isError(res)).toBe(true);
    expect(errorCode(res)).toBe('NOT_FOUND');
  });
});
