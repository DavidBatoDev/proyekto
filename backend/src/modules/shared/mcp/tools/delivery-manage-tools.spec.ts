import { registerDeliveryManageTools } from './delivery-manage.tools';
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

const deliverableRow = () => ({
  id: 'dlv-1',
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
        avatar_url: 'x',
        email: 'ada@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
      },
    },
  ],
});

function depsWith(
  scopes: string[],
  services: Partial<McpToolDeps['s']> = {},
  permissions: unknown = { delivery: {} },
) {
  return {
    caller: { userId: 'user-1', scopes },
    s: {
      projectAuthz: { resolvePermissions: jest.fn(async () => permissions) },
      deliverables: {
        addCriterion: jest.fn(async () => deliverableRow()),
        updateCriterion: jest.fn(async () => deliverableRow()),
        removeCriterion: jest.fn(async () => deliverableRow()),
        addReviewer: jest.fn(async () => deliverableRow()),
        removeReviewer: jest.fn(async () => deliverableRow()),
        addAttachment: jest.fn(async () => deliverableRow()),
        removeAttachment: jest.fn(async () => deliverableRow()),
        addLink: jest.fn(async () => deliverableRow()),
        removeLink: jest.fn(async () => deliverableRow()),
        remove: jest.fn(async () => ({ id: 'dlv-1', deleted: true })),
      },
      changeRequests: {
        addLink: jest.fn(async () => ({ id: 'cr-1' })),
        removeLink: jest.fn(async () => ({ id: 'cr-1' })),
        remove: jest.fn(async () => ({ id: 'cr-1', deleted: true })),
      },
      decisions: {
        addLink: jest.fn(async () => ({ id: 'dec-1' })),
        removeLink: jest.fn(async () => ({ id: 'dec-1' })),
        addOption: jest.fn(async () => ({ id: 'dec-1' })),
        updateOption: jest.fn(async () => ({ id: 'dec-1' })),
        removeOption: jest.fn(async () => ({ id: 'dec-1' })),
        remove: jest.fn(async () => ({ id: 'dec-1', deleted: true })),
      },
      decisionCategories: {
        create: jest.fn(async () => ({ id: 'cat-1' })),
        update: jest.fn(async () => ({ id: 'cat-1' })),
        remove: jest.fn(async () => ({ id: 'cat-1', orphaned: 0 })),
      },
      audit: { log: jest.fn() },
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

const PID = '11111111-1111-4111-8111-111111111111';
const RID = '22222222-2222-4222-8222-222222222222';
const SID = '33333333-3333-4333-8333-333333333333';

/** Every manage tool, with a minimal valid argument set. */
const MANAGE_TOOLS: Array<[string, Record<string, unknown>]> = [
  [
    'deliverable_criterion_add',
    { project_id: PID, deliverable_id: RID, label: 'Done' },
  ],
  [
    'deliverable_criterion_update',
    { project_id: PID, deliverable_id: RID, criterion_id: SID, is_met: true },
  ],
  [
    'deliverable_criterion_remove',
    { project_id: PID, deliverable_id: RID, criterion_id: SID },
  ],
  [
    'deliverable_reviewer_add',
    { project_id: PID, deliverable_id: RID, reviewer_id: SID },
  ],
  [
    'deliverable_reviewer_remove',
    { project_id: PID, deliverable_id: RID, reviewer_id: SID },
  ],
  [
    'deliverable_attachment_add',
    { project_id: PID, deliverable_id: RID, url: 'https://example.com/pr/1' },
  ],
  [
    'deliverable_attachment_remove',
    { project_id: PID, deliverable_id: RID, attachment_id: SID },
  ],
  [
    'deliverable_link_add',
    { project_id: PID, deliverable_id: RID, target: { task_id: SID } },
  ],
  [
    'deliverable_link_remove',
    { project_id: PID, deliverable_id: RID, link_id: SID },
  ],
  ['deliverable_remove', { project_id: PID, deliverable_id: RID }],
  [
    'change_request_link_add',
    { project_id: PID, change_request_id: RID, target: { epic_id: SID } },
  ],
  [
    'change_request_link_remove',
    { project_id: PID, change_request_id: RID, link_id: SID },
  ],
  ['change_request_remove', { project_id: PID, change_request_id: RID }],
  [
    'decision_link_add',
    { project_id: PID, decision_id: RID, target: { milestone_id: SID } },
  ],
  ['decision_link_remove', { project_id: PID, decision_id: RID, link_id: SID }],
  [
    'decision_option_add',
    { project_id: PID, decision_id: RID, title: 'Option A' },
  ],
  [
    'decision_option_update',
    { project_id: PID, decision_id: RID, option_id: SID, is_selected: true },
  ],
  [
    'decision_option_remove',
    { project_id: PID, decision_id: RID, option_id: SID },
  ],
  ['decision_remove', { project_id: PID, decision_id: RID }],
  ['decision_category_create', { project_id: PID, name: 'Architecture' }],
  [
    'decision_category_update',
    { project_id: PID, category_id: RID, name: 'Platform' },
  ],
  ['decision_category_remove', { project_id: PID, category_id: RID }],
];

/** Irreversible data loss or a grant/repeal of sign-off authority. */
const DESTRUCTIVE = [
  'deliverable_criterion_remove',
  'deliverable_reviewer_add',
  'deliverable_reviewer_remove',
  'deliverable_attachment_add',
  'deliverable_attachment_remove',
  'deliverable_remove',
  'change_request_remove',
  'decision_option_remove',
  'decision_remove',
  'decision_category_remove',
];

describe('MCP delivery manage tools', () => {
  it('registers exactly the intended tool set', () => {
    const { server, handlers } = captureServer();
    registerDeliveryManageTools(server, depsWith(['delivery:write']));
    expect(Object.keys(handlers).sort()).toEqual(
      MANAGE_TOOLS.map(([name]) => name).sort(),
    );
  });

  it('flags every irreversible or authority-changing tool as destructive', () => {
    const { server, configs } = captureServer();
    registerDeliveryManageTools(server, depsWith(['delivery:write']));
    for (const name of DESTRUCTIVE) {
      expect(configs[name].annotations.destructiveHint).toBe(true);
    }
  });

  it.each(MANAGE_TOOLS)(
    'denies %s to a delivery:read-only token and never calls the service',
    async (name, args) => {
      const { server, handlers } = captureServer();
      const deps = depsWith(['delivery:read']);
      registerDeliveryManageTools(server, deps);

      const res = await handlers[name](args);

      expect(isError(res)).toBe(true);
      expect(errorCode(res)).toBe('FORBIDDEN');
      for (const svc of [
        deps.s.deliverables,
        deps.s.changeRequests,
        deps.s.decisions,
        deps.s.decisionCategories,
      ] as unknown as Array<Record<string, jest.Mock>>) {
        for (const fn of Object.values(svc)) {
          expect(fn).not.toHaveBeenCalled();
        }
      }
    },
  );

  it.each(MANAGE_TOOLS)(
    'answers NOT_FOUND for %s when the caller is not a project member',
    async (name, args) => {
      const { server, handlers } = captureServer();
      const deps = depsWith(['delivery:write'], {}, null);
      registerDeliveryManageTools(server, deps);

      const res = await handlers[name](args);

      expect(isError(res)).toBe(true);
      expect(errorCode(res)).toBe('NOT_FOUND');
    },
  );

  it('never writes an audit row — the services own their audit trail', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['delivery:write']);
    registerDeliveryManageTools(server, deps);

    for (const [name, args] of MANAGE_TOOLS) {
      await handlers[name](args);
    }

    expect(
      (deps.s.audit as unknown as { log: jest.Mock }).log,
    ).not.toHaveBeenCalled();
  });

  it('projects reviewer PII out of every deliverable-returning tool', async () => {
    const { server, handlers } = captureServer();
    const deps = depsWith(['delivery:write']);
    registerDeliveryManageTools(server, deps);

    // Every deliverable sub-resource write returns the full row with embedded
    // reviewers — the projection has to hold on writes, not just reads.
    for (const [name, args] of MANAGE_TOOLS.filter(
      ([n]) => n.startsWith('deliverable_') && n !== 'deliverable_remove',
    )) {
      const res = await handlers[name](args);
      const text = res.content[0].text as string;
      expect(text).not.toContain('ada@example.com');
      expect(text).not.toContain('Lovelace');
      expect(text).not.toContain('avatar_url');
    }
  });

  it('pins attachment kind to link and never forwards storage fields', async () => {
    const addAttachment = jest.fn(async () => deliverableRow());
    const { server, handlers } = captureServer();
    const deps = depsWith(['delivery:write'], {
      deliverables: { addAttachment } as any,
    });
    registerDeliveryManageTools(server, deps);

    await handlers.deliverable_attachment_add({
      project_id: PID,
      deliverable_id: RID,
      url: 'https://example.com/pr/1',
      kind: 'file',
      storage_key: 'sneaky',
      size_bytes: 5,
    });

    const dto = (addAttachment.mock.calls[0] as unknown[])[3] as Record<
      string,
      unknown
    >;
    // A connector has no upload path; it can only add link evidence.
    expect(dto.kind).toBe('link');
    expect(dto).not.toHaveProperty('storage_key');
    expect(dto).not.toHaveProperty('mime_type');
    expect(dto).not.toHaveProperty('size_bytes');
  });

  it('passes the caller id from the token, never from the arguments', async () => {
    const addReviewer = jest.fn(async () => deliverableRow());
    const { server, handlers } = captureServer();
    const deps = depsWith(['delivery:write'], {
      deliverables: { addReviewer } as any,
    });
    registerDeliveryManageTools(server, deps);

    await handlers.deliverable_reviewer_add({
      project_id: PID,
      deliverable_id: RID,
      reviewer_id: SID,
      user_id: 'someone-else',
    });

    expect(addReviewer).toHaveBeenCalledWith(PID, RID, 'user-1', {
      reviewer_id: SID,
    });
  });
});
