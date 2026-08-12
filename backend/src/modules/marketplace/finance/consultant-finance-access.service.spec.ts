import type { SupabaseClient } from '@supabase/supabase-js';
import { ConsultantFinanceAccessService } from './consultant-finance-access.service';

const project = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Alpha',
  status: 'active',
  currency: 'USD',
  owner_id: null,
  created_at: '2026-08-01T00:00:00.000Z',
};

function fakeSupabase(input: {
  verified?: boolean;
  project?: typeof project | null;
  projects?: (typeof project)[];
  accessCount?: number;
  accessRows?: Array<{ project_id: string }>;
  eqCalls?: Array<[string, unknown]>;
}): SupabaseClient {
  return {
    from(table: string) {
      let head = false;
      const builder = {
        select(_columns: string, options?: { head?: boolean }) {
          head = options?.head === true;
          return builder;
        },
        eq(column: string, value: unknown) {
          input.eqCalls?.push([column, value]);
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
            const allowed = new Set(
              (input.accessRows ?? [{ project_id: project.id }]).map(
                (row) => row.project_id,
              ),
            );
            return Promise.resolve({
              data: (input.projects ?? [project]).filter((row) =>
                allowed.has(row.id),
              ),
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

  it('requires an owner access row with consultant origin', async () => {
    const eqCalls: Array<[string, unknown]> = [];
    const service = new ConsultantFinanceAccessService(
      fakeSupabase({ accessCount: 0, eqCalls }),
    );

    await expect(
      service.assertProject('consultant-1', project.id),
    ).rejects.toThrow('Finance project not found');
    expect(eqCalls).toContainEqual(['role', 'owner']);
    expect(eqCalls).toContainEqual(['origin', 'consultant']);
  });

  it('lists only owner/consultant-origin project_access rows', async () => {
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

  it('excludes a client-origin admin even when the caller is verified', async () => {
    const eqCalls: Array<[string, unknown]> = [];
    const service = new ConsultantFinanceAccessService(
      fakeSupabase({ accessRows: [], eqCalls }),
    );

    await expect(service.listProjects('client-admin-1')).resolves.toEqual([]);
    expect(eqCalls).toContainEqual(['role', 'owner']);
    expect(eqCalls).toContainEqual(['origin', 'consultant']);
  });
});
