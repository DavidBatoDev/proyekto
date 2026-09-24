import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EngagementProjectService } from './engagement-project.service';

type Result = { data: unknown; error: unknown };

/**
 * A query builder whose terminal result is picked per call by `resolve`,
 * which sees every filter applied so far — enough to answer "the consultant's
 * seat" and "the counterparty's" differently from the same table.
 */
function table(
  resolve: (filters: Record<string, unknown>) => Result,
  inserts: unknown[] = [],
) {
  const make = () => {
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'order', 'in']) {
      builder[method] = jest.fn(() => builder);
    }
    builder.eq = jest.fn((column: string, value: unknown) => {
      filters[column] = value;
      return builder;
    });
    builder.neq = jest.fn((column: string, value: unknown) => {
      filters[`not.${column}`] = value;
      return builder;
    });
    builder.insert = jest.fn((payload: unknown) => {
      inserts.push(payload);
      return Promise.resolve({ data: null, error: null });
    });
    builder.maybeSingle = jest.fn(() => Promise.resolve(resolve(filters)));
    builder.then = (done: (value: Result) => void) => done(resolve(filters));
    return builder;
  };
  return { from: make };
}

function harness(options: {
  capacity?: string;
  kind?: string;
  scope?: string;
  seatTeam?: { id: string; name: string } | null;
  ownedTeams?: Array<{ id: string; name: string }>;
  projectRole?: string | null;
  teamBook?: boolean;
  addProjectBook?: jest.Mock;
}) {
  const linkInserts: unknown[] = [];
  const seatTeam =
    options.seatTeam === undefined
      ? { id: 'team-1', name: 'JC Studio' }
      : options.seatTeam;
  const tables: Record<string, ReturnType<typeof table>> = {
    engagement_parties: table((filters) =>
      filters['not.user_id']
        ? { data: { display_name_snapshot: 'Alina Reyes' }, error: null }
        : {
            data: {
              position: 'provider',
              capacity: options.capacity ?? 'consultant',
              team_id: seatTeam?.id ?? null,
              team_name_snapshot: seatTeam?.name ?? null,
            },
            error: null,
          },
    ),
    engagements: table(() => ({
      data: {
        id: 'eng-1',
        kind: options.kind ?? 'client_services',
        scope_mode: options.scope ?? 'flexible',
        status: 'active',
        activated_by_contract_id: 'contract-1',
      },
      error: null,
    })),
    contracts: table(() => ({
      data: {
        id: 'contract-1',
        project_id: null,
        project_title_snapshot: null,
        currency: 'PHP',
      },
      error: null,
    })),
    engagement_project_links: table(() => ({ data: [], error: null }), linkInserts),
    teams: table(() => ({ data: options.ownedTeams ?? [], error: null })),
    project_teams: table(() => ({
      data: [{ team_id: 'team-1', is_primary: true }],
      error: null,
    })),
    projects: table(() => ({
      data: { id: 'project-9', title: 'Existing' },
      error: null,
    })),
    finance_books: table((filters) =>
      filters.kind === 'team'
        ? { data: options.teamBook === false ? null : { id: 'book-team' }, error: null }
        : { data: { id: 'book-existing' }, error: null },
    ),
  };
  const supabase = {
    from: jest.fn((name: string) => tables[name].from()),
  } as unknown as SupabaseClient;
  const projects = {
    createProject: jest.fn().mockResolvedValue({
      project: { id: 'project-new', title: 'Aurora — loyalty' },
    }),
  };
  const projectTeams = { attach: jest.fn() };
  const projectAuth = {
    getUserProjectRole: jest.fn().mockResolvedValue(options.projectRole ?? 'owner'),
  };
  const financeBooks = {
    addProjectBook:
      options.addProjectBook ?? jest.fn().mockResolvedValue({ id: 'book-project' }),
  };
  const service = new EngagementProjectService(
    supabase,
    projects as never,
    projectTeams as never,
    projectAuth as never,
    financeBooks as never,
  );
  return { service, projects, projectTeams, financeBooks, linkInserts };
}

describe('EngagementProjectService.setUp', () => {
  it('creates the project under the team the contract was signed for, links it, and opens its book', async () => {
    const { service, projects, financeBooks, linkInserts } = harness({});

    const result = await service.setUp('consultant-1', 'eng-1', {
      mode: 'create',
      title: 'Aurora — loyalty',
    });

    expect(projects.createProject).toHaveBeenCalledWith(
      'consultant-1',
      expect.objectContaining({
        creation_mode: 'consultant',
        primary_team_id: 'team-1',
        currency: 'PHP',
      }),
    );
    expect(linkInserts[0]).toMatchObject({
      engagement_id: 'eng-1',
      project_id: 'project-new',
      basis: 'operational_assignment',
    });
    expect(financeBooks.addProjectBook).toHaveBeenCalledWith(
      'consultant-1',
      'book-team',
      'project-new',
    );
    expect(result).toMatchObject({
      project_id: 'project-new',
      team_id: 'team-1',
      finance_book_id: 'book-project',
      team_book_exists: true,
    });
  });

  it('is 404 to anyone but the consultant seat', async () => {
    const { service } = harness({ capacity: 'client' });
    await expect(
      service.setUp('client-1', 'eng-1', { mode: 'create', title: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses talent engagements', async () => {
    const { service } = harness({ kind: 'talent_services' });
    await expect(
      service.setUp('consultant-1', 'eng-1', { mode: 'create', title: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a project-specific engagement, which already has its project', async () => {
    const { service } = harness({ scope: 'project_specific' });
    await expect(
      service.setUp('consultant-1', 'eng-1', { mode: 'create', title: 'x' }),
    ).rejects.toThrow(/already scoped/);
  });

  it('only links a project the caller owns', async () => {
    const { service } = harness({ projectRole: 'editor' });
    await expect(
      service.setUp('consultant-1', 'eng-1', {
        mode: 'link',
        project_id: '00000000-0000-0000-0000-000000000009',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('asks for a team when an older contract named none and the consultant has several', async () => {
    const { service } = harness({
      seatTeam: null,
      ownedTeams: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    });
    await expect(
      service.setUp('consultant-1', 'eng-1', { mode: 'create', title: 'x' }),
    ).rejects.toThrow(/Choose the team/);
  });

  it('still succeeds when the team keeps no finance books', async () => {
    const { service, financeBooks } = harness({ teamBook: false });
    const result = await service.setUp('consultant-1', 'eng-1', {
      mode: 'create',
      title: 'x',
    });
    expect(financeBooks.addProjectBook).not.toHaveBeenCalled();
    expect(result).toMatchObject({ finance_book_id: null, team_book_exists: false });
  });

  it('returns the existing book when the project already has one', async () => {
    const { service } = harness({
      addProjectBook: jest.fn().mockRejectedValue(new ConflictException('dup')),
    });
    const result = await service.setUp('consultant-1', 'eng-1', {
      mode: 'create',
      title: 'x',
    });
    expect(result.finance_book_id).toBe('book-existing');
  });
});
