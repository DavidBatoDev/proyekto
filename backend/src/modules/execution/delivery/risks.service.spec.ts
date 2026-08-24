import { NotFoundException } from '@nestjs/common';
import { RisksService } from './risks.service';
import type { RiskRow } from './delivery.types';

/**
 * Unit coverage for the risk register's visibility gate.
 *
 * `visibility='internal'` rows are withheld from anyone without
 * `risks.view_internal`, and a single-row read answers 404 rather than 403 —
 * telling someone an internal risk exists is itself the leak the permission
 * protects. `get` is newer than the rest of the service (the web register
 * renders from `list` alone); it exists so the MCP surface has a single-row
 * read that respects that rule instead of filtering a list after the fact.
 *
 * Supabase is stubbed rather than mocked-as-a-database, matching
 * `decisions.service.spec.ts`.
 */

type Queued = { data?: unknown; error?: unknown };

/** Chainable, awaitable Supabase query stub. */
function thenable(response: Queued) {
  const stub: Record<string, unknown> = {};
  for (const method of [
    'select',
    'insert',
    'update',
    'delete',
    'eq',
    'neq',
    'in',
    'order',
    'limit',
    'maybeSingle',
    'single',
    'overrideTypes',
  ]) {
    stub[method] = jest.fn(() => stub);
  }
  stub.then = (onFulfilled: (v: Queued) => unknown) =>
    Promise.resolve(response).then(onFulfilled);
  return stub;
}

function riskFixture(overrides: Partial<RiskRow> = {}): RiskRow {
  return {
    id: 'risk-1',
    project_id: 'p1',
    kind: 'risk',
    title: 'Vendor API may rate-limit us',
    description: null,
    severity: 'high',
    likelihood: 'medium',
    status: 'open',
    impact: null,
    mitigation: null,
    owner_id: null,
    due_date: null,
    resolved_at: null,
    resolved_by: null,
    visibility: 'internal',
    source_kind: 'manual',
    created_by: 'user-1',
    created_at: '2026-08-16T00:00:00Z',
    updated_at: '2026-08-16T00:00:00Z',
    links: [],
    ...overrides,
  } as RiskRow;
}

function permissions(viewInternal: boolean) {
  return { risks: { edit: true, view_internal: viewInternal } };
}

function build(
  options: {
    queued?: Array<ReturnType<typeof thenable>>;
    viewInternal?: boolean;
  } = {},
) {
  const queued = options.queued ?? [];
  let index = 0;
  const db = {
    from: () => {
      const next = queued[index++];
      if (!next) throw new Error(`Unexpected supabase.from() call #${index}`);
      return next;
    },
  };
  const resolved = permissions(options.viewInternal ?? true);
  const authorization = {
    assertPermission: jest.fn().mockResolvedValue(resolved),
    resolvePermissions: jest.fn().mockResolvedValue(resolved),
  };
  const audit = { log: jest.fn() };

  const service = new RisksService(
    db as never,
    authorization as never,
    audit as never,
  );
  return { service, authorization, audit };
}

describe('RisksService', () => {
  describe('get', () => {
    it('gates on access.delivery, the shared read key for all four surfaces', async () => {
      const { service, authorization } = build({
        queued: [thenable({ data: riskFixture({ visibility: 'shared' }) })],
      });

      await service.get('p1', 'risk-1', 'user-1');

      expect(authorization.assertPermission).toHaveBeenCalledWith(
        'user-1',
        'p1',
        'access.delivery',
      );
    });

    it('returns a shared row to any project member', async () => {
      const { service } = build({
        viewInternal: false,
        queued: [thenable({ data: riskFixture({ visibility: 'shared' }) })],
      });

      const risk = await service.get('p1', 'risk-1', 'user-1');

      expect(risk.id).toBe('risk-1');
    });

    it('returns an internal row to someone holding risks.view_internal', async () => {
      const { service } = build({
        viewInternal: true,
        queued: [thenable({ data: riskFixture({ visibility: 'internal' }) })],
      });

      const risk = await service.get('p1', 'risk-1', 'user-1');

      expect(risk.visibility).toBe('internal');
    });

    it('404s an internal row for someone without risks.view_internal', async () => {
      const { service } = build({
        viewInternal: false,
        queued: [thenable({ data: riskFixture({ visibility: 'internal' }) })],
      });

      // Deliberately NOT a 403: a 403 would confirm the row exists, which is
      // the very thing risks.view_internal is protecting.
      await expect(
        service.get('p1', 'risk-1', 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s a row that belongs to another project', async () => {
      const { service } = build({ queued: [thenable({ data: null })] });

      await expect(
        service.get('p1', 'risk-9', 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
