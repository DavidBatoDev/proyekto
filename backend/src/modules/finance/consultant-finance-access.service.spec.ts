import type { SupabaseClient } from '@supabase/supabase-js';
import { ConsultantFinanceAccessService } from './consultant-finance-access.service';

const project = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Alpha',
  status: 'active',
  currency: 'USD',
  owner_id: null,
  consultant_id: 'consultant-1',
  created_at: '2026-08-01T00:00:00.000Z',
};

function fakeSupabase(input: {
  verified?: boolean;
  project?: typeof project | null;
  projects?: (typeof project)[];
  accessCount?: number;
  accessRows?: Array<{ project_id: string }>;
}): SupabaseClient {
  return {
    from(table: string) {
      let head = false;
      const builder = {
        select(_columns: string, options?: { head?: boolean }) {
          head = options?.head === true;
          return builder;
        },
        eq() {
          return builder;
        },
        in() {
          return builder;
        },
        ilike() {
          return builder;
        },
        order() {
          return builder;
        },
        maybeSingle() {
          if (table === 'profiles') {
            return Promise.resolve({
              data: {
                role: 'consultant',
                is_consultant_verified: input.verified ?? true,
              },
              error: null,
            });
          }
          return Promise.resolve({
            data: input.project === undefined ? project : input.project,
            error: null,
          });
        },
        then(resolve: (value: unknown) => unknown) {
          if (table === 'projects') {
            return Promise.resolve({
              data: input.projects ?? [project],
              error: null,
            }).then(resolve);
          }
          return Promise.resolve(
            head
              ? { data: null, error: null, count: input.accessCount ?? 1 }
              : {
                  data: input.accessRows ?? [{ project_id: project.id }],
                  error: null,
                },
          ).then(resolve);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('ConsultantFinanceAccessService', () => {
  it('hides finance projects from unverified callers', async () => {
    const service = new ConsultantFinanceAccessService(
      fakeSupabase({ verified: false }),
    );

    await expect(
      service.assertProject('consultant-1', project.id),
    ).rejects.toThrow('Finance project not found');
  });

  it('requires a matching project_access row', async () => {
    const service = new ConsultantFinanceAccessService(
      fakeSupabase({ accessCount: 0 }),
    );

    await expect(
      service.assertProject('consultant-1', project.id),
    ).rejects.toThrow('Finance project not found');
  });

  it('intersects consultant-owned projects with project_access', async () => {
    const inaccessible = {
      ...project,
      id: '22222222-2222-4222-8222-222222222222',
    };
    const service = new ConsultantFinanceAccessService(
      fakeSupabase({
        projects: [project, inaccessible],
        accessRows: [{ project_id: project.id }],
      }),
    );

    await expect(service.listProjects('consultant-1')).resolves.toEqual([
      project,
    ]);
  });
});
