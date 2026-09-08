import { registerWorkspaceTools } from './workspace.tools';
import type { McpToolDeps } from './tool-helpers';

function captureServer() {
  const handlers: Record<string, (args: any) => Promise<any>> = {};
  const definitions: Record<string, any> = {};
  const server = {
    registerTool: (name: string, cfg: any, cb: (a: any) => Promise<any>) => {
      definitions[name] = cfg;
      handlers[name] = cb;
    },
  };
  return { server: server as any, handlers, definitions };
}

function depsWith(scopes: string[], aiContext: Record<string, any> = {}) {
  return {
    caller: { userId: 'user-1', scopes },
    s: {
      aiContext: {
        listTasks: jest.fn(() =>
          Promise.resolve({
            tasks: [],
            offset: 0,
            total: 0,
            next_offset: null,
          }),
        ),
        search: jest.fn(() =>
          Promise.resolve({ matches: [], offset: 0, next_offset: null }),
        ),
        getOverview: jest.fn(() =>
          Promise.resolve({
            workspace: null,
            projects: [],
            roadmaps: [],
            teams: [],
            counts_truncated: false,
            generated_at: 'now',
          }),
        ),
        ...aiContext,
      },
      maxPageSize: 100,
    },
  } as unknown as McpToolDeps;
}

const payload = (res: any) => JSON.parse(res.content[0].text);
const errorCode = (res: any) => JSON.parse(res.content[0].text).error;
const READ_BOTH = ['roadmaps:read', 'projects:read'];

describe('MCP cross-roadmap read tools', () => {
  it('registers the three cross-roadmap reads and declares offset on the paged ones', () => {
    const { server, handlers, definitions } = captureServer();
    registerWorkspaceTools(server, depsWith(READ_BOTH));

    expect(Object.keys(handlers).sort()).toEqual([
      'my_tasks_list',
      'search_everything',
      'workspace_overview_get',
    ]);
    for (const name of ['my_tasks_list', 'search_everything']) {
      expect(definitions[name].inputSchema).toHaveProperty('offset');
      expect(definitions[name].description).toContain('offset = next_offset');
    }
    // The overview is bounded, not paged — it must not advertise offset.
    expect(definitions.workspace_overview_get.inputSchema).not.toHaveProperty(
      'offset',
    );
  });

  it('renames the backend page onto the tool contract', async () => {
    const listTasks: jest.Mock = jest.fn();
    listTasks.mockResolvedValue({
      tasks: [{ id: 't1' }, { id: 't2' }],
      offset: 25,
      total: 30,
      next_offset: null,
    });
    const { server, handlers } = captureServer();
    registerWorkspaceTools(server, depsWith(READ_BOTH, { listTasks }));

    const res = await handlers.my_tasks_list({ limit: 25, offset: 25 });

    expect(payload(res)).toEqual({
      tasks: [{ id: 't1' }, { id: 't2' }],
      offset: 25,
      returned_tasks: 2,
      total_tasks: 30,
      next_offset: null,
    });
    expect(listTasks).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        assigned_to_me: true,
        limit: 25,
        offset: 25,
      }),
    );
  });

  it('translates the due window into the service date filters', async () => {
    const listTasks: jest.Mock = jest.fn();
    listTasks.mockResolvedValue({ tasks: [] });
    const { server, handlers } = captureServer();
    registerWorkspaceTools(server, depsWith(READ_BOTH, { listTasks }));

    await handlers.my_tasks_list({ due: 'overdue' });
    expect(listTasks.mock.calls[0][1]).toMatchObject({ overdue: true });

    await handlers.my_tasks_list({ due: 'today' });
    const today = listTasks.mock.calls[1][1] as Record<string, string>;
    expect(today.due_after).toBe(today.due_before);

    await handlers.my_tasks_list({ due: 'week' });
    const week = listTasks.mock.calls[2][1] as Record<string, string>;
    expect(new Date(week.due_before).getTime()).toBeGreaterThan(
      new Date(week.due_after).getTime(),
    );

    await handlers.my_tasks_list({ due: 'all' });
    const all = listTasks.mock.calls[3][1] as Record<string, unknown>;
    expect(all.overdue).toBeUndefined();
    expect(all.due_after).toBeUndefined();
  });

  it('needs both read scopes for the tools that mix project and roadmap rows', async () => {
    const search = jest.fn();
    const getOverview = jest.fn();
    const { server, handlers } = captureServer();
    registerWorkspaceTools(
      server,
      depsWith(['roadmaps:read'], { search, getOverview }),
    );

    const searchRes = await handlers.search_everything({ query: 'growth' });
    expect(errorCode(searchRes)).toBe('FORBIDDEN');
    const overviewRes = await handlers.workspace_overview_get({});
    expect(errorCode(overviewRes)).toBe('FORBIDDEN');
    // Denied before the service is ever reached.
    expect(search).not.toHaveBeenCalled();
    expect(getOverview).not.toHaveBeenCalled();
  });

  it('denies my_tasks_list without roadmaps:read', async () => {
    const listTasks = jest.fn();
    const { server, handlers } = captureServer();
    registerWorkspaceTools(server, depsWith(['projects:read'], { listTasks }));

    expect(errorCode(await handlers.my_tasks_list({}))).toBe('FORBIDDEN');
    expect(listTasks).not.toHaveBeenCalled();
  });

  it('bounds each overview list and reports how many exist', async () => {
    const many = (prefix: string) =>
      Array.from({ length: 70 }, (_, i) => ({ id: `${prefix}${i}` }));
    const getOverview = jest.fn(() =>
      Promise.resolve({
        workspace: { id: 'w1' },
        projects: many('p'),
        roadmaps: many('r'),
        teams: [{ id: 'team-1' }],
        counts_truncated: false,
        generated_at: 'now',
      }),
    );
    const { server, handlers } = captureServer();
    registerWorkspaceTools(server, depsWith(READ_BOTH, { getOverview }));

    const body = payload(await handlers.workspace_overview_get({}));

    expect(body.projects).toHaveLength(60);
    expect(body.total_projects).toBe(70);
    expect(body.returned_projects).toBe(60);
    expect(body.roadmaps).toHaveLength(60);
    expect(body.total_roadmaps).toBe(70);
    // A short list is untouched but still counted.
    expect(body.teams).toHaveLength(1);
    expect(body.total_teams).toBe(1);
    // Scalars survive.
    expect(body.workspace).toEqual({ id: 'w1' });
    expect(body.counts_truncated).toBe(false);
  });

  it('passes the search page through and clamps its limit to the service ceiling', async () => {
    const search: jest.Mock = jest.fn();
    search.mockResolvedValue({
      matches: [{ id: 'e1', kind: 'epic' }],
      offset: 0,
      next_offset: 10,
    });
    const { server, handlers } = captureServer();
    registerWorkspaceTools(server, depsWith(READ_BOTH, { search }));

    const body = payload(
      await handlers.search_everything({ query: 'growth', limit: 999 }),
    );

    expect(search).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ q: 'growth', limit: 20, offset: 0 }),
    );
    expect(body).toMatchObject({
      offset: 0,
      returned_matches: 1,
      next_offset: 10,
    });
  });
});
