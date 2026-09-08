import { ForbiddenException } from '@nestjs/common';
import { registerProjectWriteTools } from './project-write.tools';
import { registerRoadmapAdminTools } from './roadmap-admin.tools';
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

function depsWith(scopes: string[], services: Record<string, any> = {}) {
  return {
    caller: { userId: 'user-1', scopes },
    s: {
      projects: {
        createProject: jest.fn(() =>
          Promise.resolve({
            project: { id: 'p-new', title: 'New project' },
            roadmap: { id: 'r-new', name: 'New project' },
          }),
        ),
        updateProject: jest.fn(() =>
          Promise.resolve({ id: 'p-1', title: 'Renamed' }),
        ),
      },
      roadmaps: {
        create: jest.fn(() => Promise.resolve({ id: 'r-new', name: 'Alpha' })),
        update: jest.fn(() =>
          Promise.resolve({ id: 'r-1', project_id: 'p-1' }),
        ),
      },
      audit: { log: jest.fn() },
      maxPageSize: 100,
      ...services,
    },
  } as unknown as McpToolDeps;
}

const payload = (res: any) => JSON.parse(res.content[0].text);
const errorCode = (res: any) => JSON.parse(res.content[0].text).error;
const PROJECT = '11111111-1111-4111-8111-111111111111';
const ROADMAP = '22222222-2222-4222-8222-222222222222';

describe('MCP project write tools', () => {
  it('registers both tools and never declares a field the table cannot persist', () => {
    const { server, handlers, definitions } = captureServer();
    registerProjectWriteTools(server, depsWith(['projects:write']));

    expect(Object.keys(handlers).sort()).toEqual([
      'project_create',
      'project_update',
    ]);
    // toProjectsTablePayload writes title/status/duration/currency only, so a
    // description input would be accepted and silently dropped.
    for (const name of ['project_create', 'project_update']) {
      expect(definitions[name].inputSchema).not.toHaveProperty('description');
      expect(definitions[name].inputSchema).not.toHaveProperty('brief');
    }
  });

  it('returns the project AND the roadmap it always provisions', async () => {
    const auditLog: jest.Mock = jest.fn();
    const deps = depsWith(['projects:write'], { audit: { log: auditLog } });
    const { server, handlers } = captureServer();
    registerProjectWriteTools(server, deps);

    const body = payload(
      await handlers.project_create({ title: 'New project' }),
    );

    expect(body.created).toBe(true);
    expect(body.project).toMatchObject({ id: 'p-new' });
    expect(body.roadmap).toMatchObject({ id: 'r-new' });
    // The model must be told not to follow this with roadmap_create.
    expect(body.next_step).toContain('r-new');
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mcp.project_create',
        entityType: 'project',
        projectId: 'p-new',
      }),
    );
  });

  it('refuses an empty patch before touching the service', async () => {
    const updateProject: jest.Mock = jest.fn();
    const { server, handlers } = captureServer();
    registerProjectWriteTools(
      server,
      depsWith(['projects:write'], {
        projects: { createProject: jest.fn(), updateProject },
      }),
    );

    const res = await handlers.project_update({ project_id: PROJECT });

    expect(errorCode(res)).toBe('VALIDATION_FAILED');
    expect(updateProject).not.toHaveBeenCalled();
  });

  it('surfaces the service owner check as FORBIDDEN', async () => {
    const updateProject = jest.fn(() =>
      Promise.reject(
        new ForbiddenException(
          "You don't have permission to update this project.",
        ),
      ),
    );
    const { server, handlers } = captureServer();
    registerProjectWriteTools(
      server,
      depsWith(['projects:write'], {
        projects: { createProject: jest.fn(), updateProject },
      }),
    );

    const res = await handlers.project_update({
      project_id: PROJECT,
      title: 'Renamed',
    });

    expect(errorCode(res)).toBe('FORBIDDEN');
  });

  it('denies both tools without projects:write', async () => {
    const createProject: jest.Mock = jest.fn();
    const updateProject: jest.Mock = jest.fn();
    const { server, handlers } = captureServer();
    registerProjectWriteTools(
      server,
      depsWith(['projects:read', 'roadmaps:write'], {
        projects: { createProject, updateProject },
      }),
    );

    expect(errorCode(await handlers.project_create({ title: 'X' }))).toBe(
      'FORBIDDEN',
    );
    expect(
      errorCode(
        await handlers.project_update({ project_id: PROJECT, title: 'X' }),
      ),
    ).toBe('FORBIDDEN');
    expect(createProject).not.toHaveBeenCalled();
    expect(updateProject).not.toHaveBeenCalled();
  });
});

describe('MCP roadmap admin tools', () => {
  it('registers both tools and marks the re-home as destructive', () => {
    const { server, handlers, definitions } = captureServer();
    registerRoadmapAdminTools(server, depsWith(['roadmaps:write']));

    expect(Object.keys(handlers).sort()).toEqual([
      'roadmap_attach_to_project',
      'roadmap_create',
    ]);
    // Attaching cannot be undone through MCP, so the host should confirm.
    expect(definitions.roadmap_attach_to_project.annotations).toMatchObject({
      destructiveHint: true,
    });
    expect(definitions.roadmap_create.annotations).not.toMatchObject({
      destructiveHint: true,
    });
  });

  it('always sends the required preview_url and a draft status', async () => {
    const create: jest.Mock = jest.fn();
    create.mockResolvedValue({ id: 'r-new', name: 'Alpha' });
    const { server, handlers } = captureServer();
    registerRoadmapAdminTools(
      server,
      depsWith(['roadmaps:write'], { roadmaps: { create, update: jest.fn() } }),
    );

    const body = payload(await handlers.roadmap_create({ name: 'Alpha' }));

    const dto = create.mock.calls[0][0] as Record<string, unknown>;
    // CreateRoadmapDto marks preview_url @IsNotEmpty.
    expect(typeof dto.preview_url).toBe('string');
    expect(String(dto.preview_url).length).toBeGreaterThan(0);
    expect(dto.status).toBe('draft');
    expect(dto.settings).toEqual({});
    expect(body.created).toBe(true);
    expect(body.next_step).toContain('r-new');
  });

  it('files the audit row only when the roadmap has a project to file it under', async () => {
    const auditLog: jest.Mock = jest.fn();
    const { server, handlers } = captureServer();
    registerRoadmapAdminTools(
      server,
      depsWith(['roadmaps:write'], { audit: { log: auditLog } }),
    );

    await handlers.roadmap_create({ name: 'Standalone' });
    expect(auditLog).not.toHaveBeenCalled();

    await handlers.roadmap_create({ name: 'Linked', project_id: PROJECT });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mcp.roadmap_create',
        entityType: 'roadmap',
        projectId: PROJECT,
      }),
    );
  });

  it('attaches a roadmap and audits it against the target project', async () => {
    const update: jest.Mock = jest.fn();
    update.mockResolvedValue({ id: 'r-1', project_id: 'p-1' });
    const auditLog: jest.Mock = jest.fn();
    const { server, handlers } = captureServer();
    registerRoadmapAdminTools(
      server,
      depsWith(['roadmaps:write'], {
        roadmaps: { create: jest.fn(), update },
        audit: { log: auditLog },
      }),
    );

    const body = payload(
      await handlers.roadmap_attach_to_project({
        roadmap_id: ROADMAP,
        project_id: PROJECT,
      }),
    );

    expect(body.attached).toBe(true);
    expect(update).toHaveBeenCalledWith(
      ROADMAP,
      { project_id: PROJECT },
      'user-1',
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'mcp.roadmap_attached' }),
    );
  });

  it('denies both tools without roadmaps:write', async () => {
    const create: jest.Mock = jest.fn();
    const update: jest.Mock = jest.fn();
    const { server, handlers } = captureServer();
    registerRoadmapAdminTools(
      server,
      depsWith(['roadmaps:read'], { roadmaps: { create, update } }),
    );

    expect(errorCode(await handlers.roadmap_create({ name: 'X' }))).toBe(
      'FORBIDDEN',
    );
    expect(
      errorCode(
        await handlers.roadmap_attach_to_project({
          roadmap_id: ROADMAP,
          project_id: PROJECT,
        }),
      ),
    ).toBe('FORBIDDEN');
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
