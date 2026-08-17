import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DecisionsService } from './decisions.service';
import type { DecisionRow } from './delivery.types';

/**
 * Unit coverage for the rules the decision log enforces before it writes:
 * the supersede chain, the internal-visibility gate, the single-selected-option
 * invariant, and reference allocation.
 *
 * Supabase is stubbed rather than mocked-as-a-database — the same split as
 * `change-requests.service.spec.ts`. Every assertion here is about a decision
 * made BEFORE the write; persistence belongs in the real-DB harness.
 */

type Queued = { data?: unknown; error?: unknown; count?: number };

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

function decisionFixture(overrides: Partial<DecisionRow> = {}): DecisionRow {
  return {
    id: 'dec-1',
    project_id: 'p1',
    reference: 3,
    title: 'Database choice',
    context: null,
    decision: 'Use PostgreSQL rather than MongoDB.',
    rationale: null,
    alternatives_considered: null,
    category_id: null,
    decided_by: 'user-1',
    decided_on: '2026-08-17',
    status: 'final',
    supersedes_decision_id: null,
    version: 1,
    source_chat_message_id: null,
    visibility: 'shared',
    created_by: 'user-1',
    created_at: '2026-08-17T00:00:00Z',
    updated_at: '2026-08-17T00:00:00Z',
    links: [],
    options: [],
    ...overrides,
  };
}

/** `allTrue`-ish permission shape; only the keys this service reads matter. */
function permissions(viewInternal: boolean) {
  return { decisions: { edit: true, view_internal: viewInternal } };
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

  const authorization = {
    assertPermission: jest
      .fn()
      .mockResolvedValue(permissions(options.viewInternal ?? true)),
  };
  const audit = { log: jest.fn() };

  const service = new DecisionsService(
    db as never,
    authorization as never,
    audit as never,
  );
  return { service, authorization, audit, db };
}

describe('DecisionsService', () => {
  describe('permissions', () => {
    it('gates writing on decisions.edit, not project.edit_content', async () => {
      // An editor can edit deliverables and risks; before this key existed they
      // could not record a decision, which is the gap this closes.
      const { service, authorization } = build({
        queued: [thenable({ data: { id: 'dec-9' } })],
      });

      await service.remove('p1', 'dec-1', 'user-1').catch(() => undefined);

      expect(authorization.assertPermission).toHaveBeenCalledWith(
        'user-1',
        'p1',
        'decisions.edit',
      );
    });
  });

  describe('list', () => {
    it('hides internal decisions from a caller without decisions.view_internal', async () => {
      const query = thenable({ data: [] });
      const { service } = build({ queued: [query], viewInternal: false });

      await service.list('p1', 'user-1');

      expect(query.eq).toHaveBeenCalledWith('visibility', 'shared');
    });

    it('does not filter for a caller who can see internal decisions', async () => {
      const query = thenable({ data: [] });
      const { service } = build({ queued: [query], viewInternal: true });

      await service.list('p1', 'user-1');

      expect(query.eq).not.toHaveBeenCalledWith('visibility', 'shared');
    });

    it('applies the status and category filters when given', async () => {
      const query = thenable({ data: [] });
      const { service } = build({ queued: [query] });

      await service.list('p1', 'user-1', {
        status: 'proposed',
        category_id: 'cat-1',
      });

      expect(query.eq).toHaveBeenCalledWith('status', 'proposed');
      expect(query.eq).toHaveBeenCalledWith('category_id', 'cat-1');
    });

    it('returns links and options sorted by position, not by whatever came back', async () => {
      // PostgREST does not order embedded rows.
      const row = decisionFixture({
        links: [
          { id: 'l2', position: 1 },
          { id: 'l1', position: 0 },
        ] as never,
        options: [
          { id: 'o2', position: 1 },
          { id: 'o1', position: 0 },
        ] as never,
      });
      const { service } = build({ queued: [thenable({ data: [row] })] });

      const [result] = await service.list('p1', 'user-1');

      expect(result.links?.map((l) => l.id)).toEqual(['l1', 'l2']);
      expect(result.options?.map((o) => o.id)).toEqual(['o1', 'o2']);
    });
  });

  describe('get', () => {
    it('404s an internal decision for a caller who cannot see internals', async () => {
      // A 404 rather than a 403: whether it exists is itself privileged.
      const { service } = build({
        queued: [
          thenable({ data: decisionFixture({ visibility: 'internal' }) }),
        ],
        viewInternal: false,
      });

      await expect(service.get('p1', 'dec-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns an internal decision to a caller who can see internals', async () => {
      const { service } = build({
        queued: [
          thenable({ data: decisionFixture({ visibility: 'internal' }) }),
        ],
        viewInternal: true,
      });

      await expect(service.get('p1', 'dec-1', 'user-1')).resolves.toMatchObject(
        {
          id: 'dec-1',
        },
      );
    });
  });

  describe('create', () => {
    it('refuses to supersede a decision that is already superseded', async () => {
      const { service } = build({
        queued: [thenable({ data: decisionFixture({ status: 'superseded' }) })],
      });

      await expect(
        service.create('p1', 'user-1', {
          title: 'Database choice',
          decision: 'Use MySQL.',
          supersedes_decision_id: 'dec-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('bumps the version off the decision it replaces', async () => {
      const insert = thenable({ data: { id: 'dec-2' } });
      const { service } = build({
        queued: [
          thenable({ data: decisionFixture({ version: 3 }) }), // loadOrThrow(previous)
          thenable({ data: { reference: 8 } }), // nextReference
          insert, // insert
          thenable({ data: null, error: null }), // supersede the old row
          thenable({ data: decisionFixture({ id: 'dec-2' }) }), // reload
        ],
      });

      await service.create('p1', 'user-1', {
        title: 'Database choice',
        decision: 'Use MySQL.',
        supersedes_decision_id: 'dec-1',
      });

      expect(insert.insert).toHaveBeenCalledWith(
        expect.objectContaining({ version: 4, reference: 9 }),
      );
    });

    it('rejects more than one pre-selected option', async () => {
      const { service } = build({ queued: [] });

      await expect(
        service.create('p1', 'user-1', {
          title: 'Database choice',
          decision: 'Use PostgreSQL.',
          options: [
            { title: 'PostgreSQL', is_selected: true },
            { title: 'MongoDB', is_selected: true },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('leaves a proposed decision unattributed', async () => {
      // Stamping a decider on something nobody has decided would be a lie the
      // History panel then repeats back.
      const insert = thenable({ data: { id: 'dec-2' } });
      const { service } = build({
        queued: [
          thenable({ data: { reference: 0 } }),
          insert,
          thenable({ data: decisionFixture({ id: 'dec-2' }) }),
        ],
      });

      await service.create('p1', 'user-1', {
        title: 'Queue technology',
        decision: 'Probably SQS.',
        status: 'proposed',
      });

      expect(insert.insert).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'proposed', decided_by: null }),
      );
    });

    it('starts references at 1 for a project with no decisions', async () => {
      const insert = thenable({ data: { id: 'dec-1' } });
      const { service } = build({
        queued: [
          thenable({ data: null }), // no rows yet
          insert,
          thenable({ data: decisionFixture() }),
        ],
      });

      await service.create('p1', 'user-1', {
        title: 'First',
        decision: 'Do the thing.',
      });

      expect(insert.insert).toHaveBeenCalledWith(
        expect.objectContaining({ reference: 1 }),
      );
    });
  });

  describe('finalize', () => {
    it('refuses to reopen a superseded decision', async () => {
      const { service } = build({
        queued: [thenable({ data: decisionFixture({ status: 'superseded' }) })],
      });

      await expect(service.finalize('p1', 'dec-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('is a no-op on a decision that is already final', async () => {
      const { service, audit } = build({
        queued: [thenable({ data: decisionFixture({ status: 'final' }) })],
      });

      await service.finalize('p1', 'dec-1', 'user-1');

      // No second from() call, and nothing written to the activity log.
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('stamps the caller as decider when the proposal had none', async () => {
      const update = thenable({ error: null });
      const { service } = build({
        queued: [
          thenable({
            data: decisionFixture({ status: 'proposed', decided_by: null }),
          }),
          update,
          thenable({ data: decisionFixture() }),
        ],
      });

      await service.finalize('p1', 'dec-1', 'user-2');

      expect(update.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'final', decided_by: 'user-2' }),
      );
    });
  });

  describe('options', () => {
    it('clears the sibling before selecting a new option', async () => {
      // The partial unique index uq_decision_options_selected rejects a second
      // selected row, so the order of these two writes is load-bearing.
      const clear = thenable({ error: null });
      const update = thenable({ error: null });
      const { service } = build({
        queued: [
          thenable({ data: decisionFixture() }), // assertEditable
          clear, // clearSelected
          update, // the option itself
          thenable({ data: decisionFixture() }), // reload
        ],
      });

      await service.updateOption('p1', 'dec-1', 'opt-2', 'user-1', {
        is_selected: true,
      });

      expect(clear.update).toHaveBeenCalledWith({ is_selected: false });
      expect(clear.neq).toHaveBeenCalledWith('id', 'opt-2');
      expect(update.update).toHaveBeenCalledWith({ is_selected: true });
    });

    it('does not clear anything when merely renaming an option', async () => {
      const update = thenable({ error: null });
      const { service } = build({
        queued: [
          thenable({ data: decisionFixture() }),
          update,
          thenable({ data: decisionFixture() }),
        ],
      });

      await service.updateOption('p1', 'dec-1', 'opt-2', 'user-1', {
        title: 'PostgreSQL 16',
      });

      expect(update.update).toHaveBeenCalledWith({ title: 'PostgreSQL 16' });
    });

    it('refuses to edit the options of a superseded decision', async () => {
      const { service } = build({
        queued: [thenable({ data: decisionFixture({ status: 'superseded' }) })],
      });

      await expect(
        service.addOption('p1', 'dec-1', 'user-1', { title: 'Redis' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('links', () => {
    it('treats a duplicate link as a no-op rather than an error', async () => {
      // The partial unique indexes make relinking the same target harmless;
      // surfacing 23505 would be a message the user cannot act on.
      const { service } = build({
        queued: [
          thenable({ data: decisionFixture() }), // assertEditable
          thenable({ data: null }), // nextLinkPosition
          thenable({ error: { code: '23505' } }), // insert
          thenable({ data: decisionFixture() }), // reload
        ],
      });

      await expect(
        service.addLink('p1', 'dec-1', 'user-1', { feature_id: 'f1' }),
      ).resolves.toMatchObject({ id: 'dec-1' });
    });

    it('rejects a link with no target', async () => {
      const { service } = build({
        queued: [thenable({ data: decisionFixture() })],
      });

      await expect(
        service.addLink('p1', 'dec-1', 'user-1', {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a link naming two targets at once', async () => {
      const { service } = build({
        queued: [thenable({ data: decisionFixture() })],
      });

      await expect(
        service.addLink('p1', 'dec-1', 'user-1', {
          feature_id: 'f1',
          task_id: 't1',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
