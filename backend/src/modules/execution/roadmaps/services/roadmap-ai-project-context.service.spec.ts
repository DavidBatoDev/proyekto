import { NotFoundException } from '@nestjs/common';
import { RoadmapAiProjectContextService } from './roadmap-ai-project-context.service';

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
  count: number | null;
};

class QueryBuilder {
  select = jest.fn().mockReturnThis();
  eq = jest.fn().mockReturnThis();
  in = jest.fn().mockReturnThis();
  gte = jest.fn().mockReturnThis();
  lt = jest.fn().mockReturnThis();
  order = jest.fn().mockReturnThis();
  limit = jest.fn().mockReturnThis();

  constructor(private readonly result: QueryResult) {}

  maybeSingle = jest
    .fn()
    .mockImplementation(() => Promise.resolve(this.result));

  then<TResult1 = QueryResult, TResult2 = never>(
    onFulfilled?:
      | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onFulfilled, onRejected);
  }
}

function query(
  data: unknown,
  options: { error?: string; count?: number | null } = {},
): QueryBuilder {
  return new QueryBuilder({
    data,
    error: options.error ? { message: options.error } : null,
    count: options.count ?? null,
  });
}

function buildService(
  roadmap: unknown,
  queues: Record<string, QueryBuilder[]> = {},
) {
  const remaining = new Map(
    Object.entries(queues).map(([table, builders]) => [table, [...builders]]),
  );
  const db = {
    from: jest.fn((table: string) => {
      const builder = remaining.get(table)?.shift();
      if (!builder) throw new Error(`Unexpected query for ${table}`);
      return builder;
    }),
  };
  const roadmapsRepo = {
    findById: jest.fn().mockResolvedValue(roadmap),
  };
  const projectAuth = {
    assertRole: jest.fn().mockResolvedValue('owner'),
    resolvePermissions: jest.fn().mockResolvedValue(null),
  };
  // Pass-through cache: the loader always runs, so these tests still assert on
  // the real query fan-out rather than on a memoized result.
  const dataCache = {
    rememberJson: jest.fn(
      (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader(),
    ),
  };
  return {
    service: new RoadmapAiProjectContextService(
      db as never,
      roadmapsRepo as never,
      projectAuth as never,
      dataCache as never,
    ),
    db,
    roadmapsRepo,
    projectAuth,
    dataCache,
  };
}

describe('RoadmapAiProjectContextService', () => {
  it('uses read-level repository authz and hides inaccessible roadmaps as 404', async () => {
    const { service, roadmapsRepo } = buildService(null);

    await expect(
      service.getProjectContext('roadmap-1', 'intruder'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(roadmapsRepo.findById).toHaveBeenCalledWith('roadmap-1', 'intruder');
  });

  it('returns a stable empty compact pack and NO_PROJECT for projectless roadmaps', async () => {
    const { service, db } = buildService({
      id: 'roadmap-1',
      owner_id: 'user-1',
      project_id: null,
    });

    await expect(
      service.getProjectContext('roadmap-1', 'user-1'),
    ).resolves.toEqual({
      project: null,
      brief_excerpt: null,
      has_full_brief: false,
      custom_field_keys: [],
      members: [],
      teams: [],
      resource_summary: { count: 0, top_titles: [] },
      meeting_summary: { upcoming_count: 0, next: null },
    });
    await expect(
      service.getProjectBrief('roadmap-1', 'user-1'),
    ).resolves.toEqual({ error: { code: 'NO_PROJECT' } });
    expect(db.from).not.toHaveBeenCalled();
  });

  it('assembles a deterministic compact context pack from the latest brief', async () => {
    const projectQuery = query({
      id: 'project-1',
      title: 'Apollo',
      status: 'active',
      duration: '3 months',
    });
    const briefQuery = query({
      version: 3,
      project_summary: '<p>Build &amp; launch.</p><script>ignore this</script>',
      custom_fields: [
        { key: 'Audience', value: 'Teams', position: 2 },
        { key: 'Constraint', value: 'Lean', position: 1 },
      ],
    });
    const accessQuery = query([
      { user_id: 'member-1', role: 'editor', granted_at: '2026-01-02' },
      { user_id: 'owner-1', role: 'admin', granted_at: '2026-01-03' },
    ]);
    const profilesQuery = query([
      {
        id: 'member-1',
        display_name: 'Morgan',
      },
      {
        id: 'owner-1',
        display_name: 'Olivia',
      },
    ]);
    const teamsQuery = query([
      { team_id: 'team-1', team: { id: 'team-1', name: 'Core' } },
      { team_id: 'team-2', team: [{ id: 'team-2', name: 'Design' }] },
    ]);
    const resourceCountQuery = query(null, { count: 12 });
    const resourceTitlesQuery = query([
      { id: 'link-1', title: 'Architecture' },
      { id: 'link-2', title: 'Brand guide' },
    ]);
    const meetingCountQuery = query(null, { count: 2 });
    const nextMeetingQuery = query({
      id: 'meeting-1',
      title: 'Kickoff',
      scheduled_at: '2026-08-01T00:00:00.000Z',
    });
    const { service } = buildService(
      {
        id: 'roadmap-1',
        owner_id: 'owner-1',
        project_id: 'project-1',
      },
      {
        projects: [projectQuery],
        project_briefs: [briefQuery],
        project_access: [accessQuery],
        profiles: [profilesQuery],
        project_teams: [teamsQuery],
        project_resource_links: [resourceCountQuery, resourceTitlesQuery],
        meetings: [meetingCountQuery, nextMeetingQuery],
      },
    );

    const result = await service.getProjectContext('roadmap-1', 'viewer-1');

    expect(result).toEqual({
      project: {
        id: 'project-1',
        title: 'Apollo',
        status: 'active',
        duration: '3 months',
      },
      brief_excerpt: 'Build & launch.',
      has_full_brief: true,
      custom_field_keys: ['Constraint', 'Audience'],
      members: [
        {
          id: 'owner-1',
          display_name: 'Olivia',
          role: 'admin',
        },
        {
          id: 'member-1',
          display_name: 'Morgan',
          role: 'editor',
        },
      ],
      teams: ['Core', 'Design'],
      resource_summary: {
        count: 12,
        top_titles: ['Architecture', 'Brand guide'],
      },
      meeting_summary: {
        upcoming_count: 2,
        next: {
          title: 'Kickoff',
          scheduled_at: '2026-08-01T00:00:00.000Z',
        },
      },
    });
    expect(briefQuery.order).toHaveBeenCalledWith('version', {
      ascending: false,
    });
    expect(briefQuery.limit).toHaveBeenCalledWith(1);
    expect(projectQuery.select).toHaveBeenCalledWith(
      'id, title, status, duration',
    );
  });

  it('returns a plain-text full brief with hard caps and normalized custom fields', async () => {
    const briefQuery = query({
      version: 1,
      project_summary: `<p>${'x'.repeat(13_000)}</p>`,
      custom_fields: [
        {
          key: 'Decision',
          value: '<p>Use &amp; support <strong>Postgres</strong>.</p>',
          position: 0,
        },
      ],
    });
    const { service } = buildService(
      { owner_id: 'user-1', project_id: 'project-1' },
      { project_briefs: [briefQuery] },
    );

    const result = await service.getProjectBrief('roadmap-1', 'user-1');

    expect('project_summary' in result && result.project_summary).toHaveLength(
      12_000,
    );
    expect(
      'project_summary' in result && result.project_summary?.endsWith('\u2026'),
    ).toBe(true);
    expect(result).toMatchObject({
      project_id: 'project-1',
      custom_fields: [
        {
          key: 'Decision',
          value: 'Use & support Postgres.',
          position: 0,
        },
      ],
    });
  });

  it('caps resource rows and every prompt-facing resource field', async () => {
    const foldersQuery = query(
      Array.from({ length: 51 }, (_, index) => ({
        id: `folder-${index}`,
        name: `Folder ${index}`,
        position: index,
      })),
    );
    const linksQuery = query(
      Array.from({ length: 51 }, (_, index) => ({
        id: `link-${index}`,
        folder_id: null,
        title: `Link ${index}`,
        url: `https://${'a'.repeat(2_100)}`,
        description: `<p>${'d'.repeat(600)}</p>`,
        position: index,
      })),
    );
    const { service } = buildService(
      { owner_id: 'user-1', project_id: 'project-1' },
      {
        project_resource_folders: [foldersQuery],
        project_resource_links: [linksQuery],
      },
    );

    const result = await service.getProjectResources('roadmap-1', 'user-1');

    expect('folders' in result && result.folders).toHaveLength(50);
    expect('links' in result && result.links).toHaveLength(50);
    if ('links' in result) {
      expect(result.links[0]?.url).toHaveLength(2_048);
      expect(result.links[0]?.description).toHaveLength(500);
      expect(result.links[0]?.description).not.toContain('<p>');
    }
    expect(foldersQuery.limit).toHaveBeenCalledWith(50);
    expect(linksQuery.limit).toHaveBeenCalledWith(50);
  });

  it('filters upcoming meetings and caps participants and meeting fields', async () => {
    const participantRows: Array<Record<string, unknown>> = Array.from(
      { length: 50 },
      (_, index) => ({
        id: `participant-${index}`,
        user_id: `user-${index}`,
        guest_email: null,
        guest_name: null,
        role: 'attendee',
        response: 'pending',
        profile: { display_name: `User ${index}` },
      }),
    );
    participantRows.push({
      id: 'participant-host',
      user_id: 'host-1',
      guest_email: 'host@example.com',
      guest_name: null,
      role: 'host',
      response: 'accepted',
      profile: { display_name: 'Host' },
    });
    const meetingRow = {
      id: 'meeting-1',
      title: 'T'.repeat(250),
      description: `<p>${'D'.repeat(350)}</p>`,
      type: 'kickoff',
      scheduled_at: '2026-09-01T00:00:00.000Z',
      ends_at: '2026-09-01T01:00:00.000Z',
      status: 'scheduled',
      meeting_url: `https://${'m'.repeat(2_100)}`,
      participants: participantRows,
    };
    const meetingsQuery = query(
      Array.from({ length: 6 }, (_, index) => ({
        ...meetingRow,
        id: `meeting-${index}`,
      })),
    );
    const { service } = buildService(
      { owner_id: 'user-1', project_id: 'project-1' },
      { meetings: [meetingsQuery] },
    );

    const result = await service.getProjectMeetings('roadmap-1', 'user-1', {
      window: 'upcoming',
      limit: 6,
    });

    expect(meetingsQuery.gte).toHaveBeenCalledWith(
      'scheduled_at',
      expect.any(String),
    );
    expect(meetingsQuery.eq).toHaveBeenCalledWith('status', 'scheduled');
    if ('meetings' in result) {
      const meeting = result.meetings[0];
      expect(meeting?.title).toHaveLength(200);
      expect(meeting?.description).toHaveLength(300);
      expect(meeting?.url).toHaveLength(2_048);
      expect(meeting?.participants).toHaveLength(20);
      expect(meeting?.participants[0]).toMatchObject({
        user_id: 'host-1',
        guest_email: 'host@example.com',
        display_name: 'Host',
        role: 'host',
        response: 'accepted',
      });
      expect(result.meetings).toHaveLength(6);
      expect(
        result.meetings.reduce(
          (total, item) => total + item.participants.length,
          0,
        ),
      ).toBe(100);
      expect(result.meetings[5]?.participants).toHaveLength(0);
    }
  });

  it('loads member skills through user_skills and returns only project-scoped teams', async () => {
    const accessQuery = query({
      user_id: 'member-1',
      role: 'editor',
      capabilities: { roadmap_edit: true },
    });
    const profileQuery = query({
      id: 'member-1',
      display_name: 'Morgan',
      bio: '<p>Backend &amp; systems</p>',
    });
    const skillsQuery = query([
      { skill: { name: 'TypeScript' } },
      { skill: [{ name: 'Postgres' }] },
    ]);
    const curationQuery = query([{ team_id: 'team-a' }, { team_id: 'team-b' }]);
    const teamNamesQuery = query([
      { id: 'team-b', name: 'Beta' },
      { id: 'team-a', name: 'Alpha' },
    ]);
    const { service } = buildService(
      { owner_id: 'owner-1', project_id: 'project-1' },
      {
        project_access: [accessQuery],
        profiles: [profileQuery],
        user_skills: [skillsQuery],
        project_team_members: [curationQuery],
        teams: [teamNamesQuery],
      },
    );

    const result = await service.getMemberDetails(
      'roadmap-1',
      'member-1',
      'viewer-1',
    );

    expect(result).toEqual({
      member: {
        id: 'member-1',
        display_name: 'Morgan',
        bio: 'Backend & systems',
        skills: ['Postgres', 'TypeScript'],
        role: 'editor',
        capabilities: { roadmap_edit: true },
        teams: ['Alpha', 'Beta'],
      },
    });
    expect(profileQuery.select).toHaveBeenCalledWith('id, display_name, bio');
    expect(skillsQuery.select).toHaveBeenCalledWith('skill:skills(name)');
  });

  it('does not expose profile details for a non-member id', async () => {
    const { service } = buildService(
      { owner_id: 'owner-1', project_id: 'project-1' },
      { project_access: [query(null)] },
    );

    await expect(
      service.getMemberDetails('roadmap-1', 'outsider-1', 'viewer-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * The project-keyed entry points serve the `/ai/context/projects/:id` family:
 * they authorize on the project (owner or any project_access row, 404
 * otherwise) and must return byte-identical payloads to the roadmap-keyed
 * readers for the same project.
 */
describe('RoadmapAiProjectContextService project-keyed entry points', () => {
  const ownerRow = () => query({ owner_id: 'owner-1' });
  const memberPermissions = { roadmap: { view: true } };

  it.each<
    [string, (service: RoadmapAiProjectContextService) => Promise<unknown>]
  >([
    [
      'getProjectContextForProject',
      (service) => service.getProjectContextForProject('project-1', 'intruder'),
    ],
    [
      'getProjectBriefForProject',
      (service) => service.getProjectBriefForProject('project-1', 'intruder'),
    ],
    [
      'getProjectResourcesForProject',
      (service) =>
        service.getProjectResourcesForProject('project-1', 'intruder'),
    ],
    [
      'getProjectMeetingsForProject',
      (service) =>
        service.getProjectMeetingsForProject('project-1', 'intruder', {}),
    ],
    [
      'getMemberDetailsForProject',
      (service) =>
        service.getMemberDetailsForProject('project-1', 'member-1', 'intruder'),
    ],
  ])(
    '%s answers 404 for a non-member who is not the owner',
    async (_name, call) => {
      const { service, projectAuth, db } = buildService(null, {
        projects: [ownerRow()],
      });
      projectAuth.resolvePermissions.mockResolvedValue(null);

      const failure = await call(service).then(
        () => null,
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(NotFoundException);
      expect((failure as Error).message).toBe('Project not found');
      expect(projectAuth.resolvePermissions).toHaveBeenCalledWith(
        'intruder',
        'project-1',
      );
      // Only the owner probe ran - no project data was read.
      expect(db.from).toHaveBeenCalledTimes(1);
      expect(db.from).toHaveBeenCalledWith('projects');
    },
  );

  it('admits the project owner even without a project_access row', async () => {
    const { service, projectAuth } = buildService(null, {
      projects: [ownerRow()],
      project_briefs: [query(null)],
    });
    projectAuth.resolvePermissions.mockResolvedValue(null);

    await expect(
      service.getProjectBriefForProject('project-1', 'owner-1'),
    ).resolves.toEqual({
      project_id: 'project-1',
      project_summary: null,
      custom_fields: [],
    });
  });

  it('getProjectContextForProject returns the same pack as the roadmap-keyed path', async () => {
    const contextQueues = () => ({
      projects: [
        query({
          id: 'project-1',
          title: 'Apollo',
          status: 'active',
          duration: '3 months',
        }),
      ],
      project_briefs: [
        query({
          version: 3,
          project_summary: '<p>Build &amp; launch.</p>',
          custom_fields: [{ key: 'Audience', value: 'Teams', position: 2 }],
        }),
      ],
      project_access: [
        query([
          { user_id: 'member-1', role: 'editor', granted_at: '2026-01-02' },
        ]),
      ],
      profiles: [
        query([
          { id: 'member-1', display_name: 'Morgan' },
          { id: 'owner-1', display_name: 'Olivia' },
        ]),
      ],
      project_teams: [
        query([{ team_id: 'team-1', team: { id: 'team-1', name: 'Core' } }]),
      ],
      project_resource_links: [
        query(null, { count: 2 }),
        query([{ id: 'link-1', title: 'Architecture' }]),
      ],
      meetings: [
        query(null, { count: 1 }),
        query({
          id: 'meeting-1',
          title: 'Kickoff',
          scheduled_at: '2026-08-01T00:00:00.000Z',
        }),
      ],
    });
    const roadmapKeyed = buildService(
      { id: 'roadmap-1', owner_id: 'owner-1', project_id: 'project-1' },
      contextQueues(),
    );
    const viaRoadmap = await roadmapKeyed.service.getProjectContext(
      'roadmap-1',
      'viewer-1',
    );

    const queues = contextQueues();
    const projectKeyed = buildService(null, {
      ...queues,
      // The owner probe reads projects first, then the context reader does.
      projects: [ownerRow(), ...queues.projects],
    });
    projectKeyed.projectAuth.resolvePermissions.mockResolvedValue(
      memberPermissions,
    );
    const viaProject = await projectKeyed.service.getProjectContextForProject(
      'project-1',
      'viewer-1',
    );

    expect(viaProject).toEqual(viaRoadmap);
    expect(viaProject.project?.title).toBe('Apollo');
    expect(viaProject.members.map((member) => member.id)).toEqual([
      'owner-1',
      'member-1',
    ]);
    expect(projectKeyed.roadmapsRepo.findById).not.toHaveBeenCalled();
  });

  it('getProjectBriefForProject returns the same brief as the roadmap-keyed path', async () => {
    const brief = () =>
      query({
        version: 1,
        project_summary: '<p>Use &amp; support <strong>Postgres</strong>.</p>',
        custom_fields: [{ key: 'Decision', value: 'Yes', position: 0 }],
      });
    const viaRoadmap = await buildService(
      { owner_id: 'owner-1', project_id: 'project-1' },
      { project_briefs: [brief()] },
    ).service.getProjectBrief('roadmap-1', 'viewer-1');

    const projectKeyed = buildService(null, {
      projects: [ownerRow()],
      project_briefs: [brief()],
    });
    projectKeyed.projectAuth.resolvePermissions.mockResolvedValue(
      memberPermissions,
    );
    const viaProject = await projectKeyed.service.getProjectBriefForProject(
      'project-1',
      'viewer-1',
    );

    expect(viaProject).toEqual(viaRoadmap);
    expect(viaProject).toMatchObject({
      project_id: 'project-1',
      project_summary: 'Use & support Postgres.',
    });
  });

  it('getProjectResourcesForProject returns the same resources as the roadmap-keyed path', async () => {
    const resourceQueues = () => ({
      project_resource_folders: [
        query([{ id: 'folder-1', name: 'Docs', position: 0 }]),
      ],
      project_resource_links: [
        query([
          {
            id: 'link-1',
            folder_id: 'folder-1',
            title: 'Architecture',
            url: 'https://example.com/arch',
            description: '<p>Overview &amp; diagrams</p>',
            position: 0,
          },
        ]),
      ],
    });
    const viaRoadmap = await buildService(
      { owner_id: 'owner-1', project_id: 'project-1' },
      resourceQueues(),
    ).service.getProjectResources('roadmap-1', 'viewer-1');

    const projectKeyed = buildService(null, {
      ...resourceQueues(),
      projects: [ownerRow()],
    });
    projectKeyed.projectAuth.resolvePermissions.mockResolvedValue(
      memberPermissions,
    );
    const viaProject = await projectKeyed.service.getProjectResourcesForProject(
      'project-1',
      'viewer-1',
    );

    expect(viaProject).toEqual(viaRoadmap);
    expect(viaProject).toMatchObject({
      project_id: 'project-1',
      folders: [{ id: 'folder-1', name: 'Docs', position: 0 }],
      links: [{ id: 'link-1', description: 'Overview & diagrams' }],
    });
  });

  it('getProjectMeetingsForProject returns the same page as the roadmap-keyed path', async () => {
    const meetingRow = {
      id: 'meeting-1',
      title: 'Kickoff',
      description: null,
      type: 'kickoff',
      scheduled_at: '2026-09-01T00:00:00.000Z',
      ends_at: null,
      status: 'scheduled',
      meeting_url: null,
      participants: [
        {
          id: 'participant-host',
          user_id: 'host-1',
          guest_email: null,
          guest_name: null,
          role: 'host',
          response: 'accepted',
          profile: { display_name: 'Host' },
        },
      ],
    };
    const viaRoadmap = await buildService(
      { owner_id: 'owner-1', project_id: 'project-1' },
      { meetings: [query([meetingRow])] },
    ).service.getProjectMeetings('roadmap-1', 'viewer-1', {
      window: 'upcoming',
      limit: 5,
    });

    const meetingsQuery = query([meetingRow]);
    const projectKeyed = buildService(null, {
      projects: [ownerRow()],
      meetings: [meetingsQuery],
    });
    projectKeyed.projectAuth.resolvePermissions.mockResolvedValue(
      memberPermissions,
    );
    const viaProject = await projectKeyed.service.getProjectMeetingsForProject(
      'project-1',
      'viewer-1',
      { window: 'upcoming', limit: 5 },
    );

    expect(viaProject).toEqual(viaRoadmap);
    expect(viaProject).toMatchObject({
      project_id: 'project-1',
      window: 'upcoming',
      meetings: [{ id: 'meeting-1', participants: [{ user_id: 'host-1' }] }],
    });
    expect(meetingsQuery.gte).toHaveBeenCalledWith(
      'scheduled_at',
      expect.any(String),
    );
    expect(meetingsQuery.eq).toHaveBeenCalledWith('status', 'scheduled');
    expect(meetingsQuery.limit).toHaveBeenCalledWith(5);
  });

  it('getMemberDetailsForProject returns the same member as the roadmap-keyed path', async () => {
    const memberQueues = () => ({
      project_access: [
        query({
          user_id: 'member-1',
          role: 'editor',
          capabilities: { roadmap_edit: true },
        }),
      ],
      profiles: [
        query({
          id: 'member-1',
          display_name: 'Morgan',
          bio: '<p>Backend &amp; systems</p>',
        }),
      ],
      user_skills: [query([{ skill: { name: 'TypeScript' } }])],
      project_team_members: [query([{ team_id: 'team-a' }])],
      teams: [query([{ id: 'team-a', name: 'Alpha' }])],
    });
    const viaRoadmap = await buildService(
      { owner_id: 'owner-1', project_id: 'project-1' },
      memberQueues(),
    ).service.getMemberDetails('roadmap-1', 'member-1', 'viewer-1');

    const projectKeyed = buildService(null, {
      ...memberQueues(),
      projects: [ownerRow()],
    });
    projectKeyed.projectAuth.resolvePermissions.mockResolvedValue(
      memberPermissions,
    );
    const viaProject = await projectKeyed.service.getMemberDetailsForProject(
      'project-1',
      'member-1',
      'viewer-1',
    );

    expect(viaProject).toEqual(viaRoadmap);
    expect(viaProject).toEqual({
      member: {
        id: 'member-1',
        display_name: 'Morgan',
        bio: 'Backend & systems',
        skills: ['TypeScript'],
        role: 'editor',
        capabilities: { roadmap_edit: true },
        teams: ['Alpha'],
      },
    });
  });

  it('getMemberDetailsForProject hides non-members of the project as 404', async () => {
    const { service, projectAuth } = buildService(null, {
      projects: [ownerRow()],
      project_access: [query(null)],
    });
    projectAuth.resolvePermissions.mockResolvedValue(memberPermissions);

    await expect(
      service.getMemberDetailsForProject('project-1', 'outsider-1', 'viewer-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
