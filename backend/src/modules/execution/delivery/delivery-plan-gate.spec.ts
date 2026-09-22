/* eslint-disable @typescript-eslint/unbound-method --
 * The entitlements double is a jest.Mocked<EntitlementsService>; passing its
 * members to expect() is an identity check on the mock, never a call, so
 * `this` scoping is irrelevant. */
import {
  allowAllEntitlements,
  denyingEntitlements,
  type EntitlementsMock,
} from '../../shared/entitlements/__entitlements-test-kit-spec';
import type { FeatureKey } from '../../shared/entitlements/entitlements.service';
import { PlanLimitException } from '../../shared/entitlements/plan-limit.exception';
import { MissingPermissionException } from '../projects/authorization/missing-permission.exception';
import { ChangeRequestsService } from './change-requests.service';
import { DecisionCategoriesService } from './decision-categories.service';
import { DecisionsService } from './decisions.service';
import { DeliverablesService } from './deliverables.service';
import { RisksService } from './risks.service';

/**
 * The delivery registers' plan gate, across all five services.
 *
 * Three properties are pinned here, for every mutator rather than a sample:
 *   1. a Free workspace's write is refused with a PlanLimitException BEFORE any
 *      database call (the stub db throws on first touch);
 *   2. the permission check runs first, so a non-member hears
 *      missing_permission and the plan is never consulted;
 *   3. reads (list, get, candidates) never consult the plan, so a downgraded
 *      workspace keeps seeing everything it recorded.
 */

const P = 'project-1';
const U = 'user-1';
const ID = 'row-1';
const SCOPE = { workspaceId: 'ws-free', exempt: false };
const REVIEW: FeatureKey[] = ['deliverables', 'deliverable_review'];

/** Every flag this suite's services read, all true. */
const PERMS = {
  deliverables: { approve: true, edit: true },
  risks: { view_internal: true, edit: true },
  decisions: { view_internal: true, edit: true },
  change_requests: { create: true, decide: true },
};

/** A db that fails the test on first touch: nothing may run before the gate. */
function untouchableDb() {
  return {
    from: jest.fn((table: string) => {
      throw new Error(`database touched before the plan gate: ${table}`);
    }),
  };
}

/** A db whose every query succeeds: one row for single reads, [] otherwise. */
function readableDb() {
  const row = {
    id: ID,
    project_id: P,
    status: 'draft',
    visibility: 'shared',
    links: [],
    criteria: [],
    reviewers: [],
    options: [],
    attachments: [],
  };
  return {
    from: jest.fn(() => {
      let single = false;
      const query: Record<string, unknown> = {};
      for (const method of [
        'select',
        'eq',
        'in',
        'is',
        'order',
        'limit',
        'overrideTypes',
      ]) {
        query[method] = jest.fn(() => query);
      }
      query.maybeSingle = jest.fn(() => {
        single = true;
        return query;
      });
      query.single = query.maybeSingle;
      query.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) =>
        Promise.resolve({ data: single ? row : [], error: null }).then(
          resolve,
          reject,
        );
      return query;
    }),
  };
}

function build(options: {
  entitlements: EntitlementsMock;
  db?: { from: jest.Mock };
  nonMember?: boolean;
}) {
  const db = options.db ?? untouchableDb();
  const authorization = {
    assertPermission: options.nonMember
      ? jest.fn((_user: string, _project: string, path: string) =>
          Promise.reject(new MissingPermissionException({ path } as never)),
        )
      : jest.fn().mockResolvedValue(PERMS),
    resolvePermissions: jest.fn().mockResolvedValue(PERMS),
    listUsersWithPermission: jest.fn().mockResolvedValue([]),
  };
  const audit = { log: jest.fn() };
  const notifications = { createNotification: jest.fn() };
  const entitlements = options.entitlements;
  entitlements.resolveScopeForProject.mockResolvedValue(SCOPE);

  return {
    db,
    authorization,
    entitlements,
    deliverables: new DeliverablesService(
      db as never,
      authorization as never,
      audit as never,
      entitlements,
    ),
    changeRequests: new ChangeRequestsService(
      db as never,
      authorization as never,
      audit as never,
      notifications as never,
      entitlements,
    ),
    risks: new RisksService(
      db as never,
      authorization as never,
      audit as never,
      entitlements,
    ),
    decisions: new DecisionsService(
      db as never,
      authorization as never,
      audit as never,
      entitlements,
    ),
    categories: new DecisionCategoriesService(
      db as never,
      authorization as never,
      entitlements,
    ),
  };
}

type Services = ReturnType<typeof build>;

interface MutatorCase {
  name: string;
  keys: FeatureKey | FeatureKey[];
  call: (s: Services) => Promise<unknown>;
}

const DTO = {} as never;

const MUTATORS: MutatorCase[] = [
  // Deliverables: 14 mutators. Review verbs need the review feature too.
  {
    name: 'deliverables.create',
    keys: 'deliverables',
    call: (s) => s.deliverables.create(P, U, { title: 't' } as never),
  },
  {
    name: 'deliverables.create (naming reviewers)',
    keys: REVIEW,
    call: (s) =>
      s.deliverables.create(P, U, {
        title: 't',
        reviewer_ids: ['user-2'],
      } as never),
  },
  {
    name: 'deliverables.update',
    keys: 'deliverables',
    call: (s) => s.deliverables.update(P, ID, U, DTO),
  },
  {
    name: 'deliverables.submit',
    keys: REVIEW,
    call: (s) => s.deliverables.submit(P, ID, U),
  },
  {
    name: 'deliverables.review',
    keys: REVIEW,
    call: (s) => s.deliverables.review(P, ID, U, DTO),
  },
  {
    name: 'deliverables.addCriterion',
    keys: 'deliverables',
    call: (s) => s.deliverables.addCriterion(P, ID, U, DTO),
  },
  {
    name: 'deliverables.updateCriterion',
    keys: 'deliverables',
    call: (s) => s.deliverables.updateCriterion(P, ID, 'c-1', U, DTO),
  },
  {
    name: 'deliverables.removeCriterion',
    keys: 'deliverables',
    call: (s) => s.deliverables.removeCriterion(P, ID, 'c-1', U),
  },
  {
    name: 'deliverables.addReviewer',
    keys: REVIEW,
    call: (s) => s.deliverables.addReviewer(P, ID, U, DTO),
  },
  {
    name: 'deliverables.removeReviewer',
    keys: REVIEW,
    call: (s) => s.deliverables.removeReviewer(P, ID, 'user-2', U),
  },
  {
    name: 'deliverables.addLink',
    keys: 'deliverables',
    call: (s) => s.deliverables.addLink(P, ID, U, { task_id: 't-1' }),
  },
  {
    name: 'deliverables.removeLink',
    keys: 'deliverables',
    call: (s) => s.deliverables.removeLink(P, ID, 'l-1', U),
  },
  {
    name: 'deliverables.addAttachment',
    keys: 'deliverables',
    call: (s) => s.deliverables.addAttachment(P, ID, U, DTO),
  },
  {
    name: 'deliverables.removeAttachment',
    keys: 'deliverables',
    call: (s) => s.deliverables.removeAttachment(P, ID, 'a-1', U),
  },
  {
    name: 'deliverables.remove',
    keys: 'deliverables',
    call: (s) => s.deliverables.remove(P, ID, U),
  },
  // Change requests: 9 mutators.
  {
    name: 'changeRequests.create',
    keys: 'change_requests',
    call: (s) => s.changeRequests.create(P, U, DTO),
  },
  {
    name: 'changeRequests.update',
    keys: 'change_requests',
    call: (s) => s.changeRequests.update(P, ID, U, DTO),
  },
  {
    name: 'changeRequests.submit',
    keys: 'change_requests',
    call: (s) => s.changeRequests.submit(P, ID, U),
  },
  {
    name: 'changeRequests.withdraw',
    keys: 'change_requests',
    call: (s) => s.changeRequests.withdraw(P, ID, U),
  },
  {
    name: 'changeRequests.decide',
    keys: 'change_requests',
    call: (s) => s.changeRequests.decide(P, ID, U, DTO),
  },
  {
    name: 'changeRequests.markApplied',
    keys: 'change_requests',
    call: (s) => s.changeRequests.markApplied(P, ID, U, DTO),
  },
  {
    name: 'changeRequests.addLink',
    keys: 'change_requests',
    call: (s) => s.changeRequests.addLink(P, ID, U, DTO),
  },
  {
    name: 'changeRequests.removeLink',
    keys: 'change_requests',
    call: (s) => s.changeRequests.removeLink(P, ID, 'l-1', U),
  },
  {
    name: 'changeRequests.remove',
    keys: 'change_requests',
    call: (s) => s.changeRequests.remove(P, ID, U),
  },
  // Risks & issues: 3 mutators.
  {
    name: 'risks.create',
    keys: 'risks',
    call: (s) => s.risks.create(P, U, DTO),
  },
  {
    name: 'risks.update',
    keys: 'risks',
    call: (s) => s.risks.update(P, ID, U, DTO),
  },
  {
    name: 'risks.remove',
    keys: 'risks',
    call: (s) => s.risks.remove(P, ID, U),
  },
  // Decisions: 9 mutators.
  {
    name: 'decisions.create',
    keys: 'decisions',
    call: (s) => s.decisions.create(P, U, DTO),
  },
  {
    name: 'decisions.update',
    keys: 'decisions',
    call: (s) => s.decisions.update(P, ID, U, DTO),
  },
  {
    name: 'decisions.finalize',
    keys: 'decisions',
    call: (s) => s.decisions.finalize(P, ID, U),
  },
  {
    name: 'decisions.remove',
    keys: 'decisions',
    call: (s) => s.decisions.remove(P, ID, U),
  },
  {
    name: 'decisions.addLink',
    keys: 'decisions',
    call: (s) => s.decisions.addLink(P, ID, U, DTO),
  },
  {
    name: 'decisions.removeLink',
    keys: 'decisions',
    call: (s) => s.decisions.removeLink(P, ID, 'l-1', U),
  },
  {
    name: 'decisions.addOption',
    keys: 'decisions',
    call: (s) => s.decisions.addOption(P, ID, U, DTO),
  },
  {
    name: 'decisions.updateOption',
    keys: 'decisions',
    call: (s) => s.decisions.updateOption(P, ID, 'o-1', U, DTO),
  },
  {
    name: 'decisions.removeOption',
    keys: 'decisions',
    call: (s) => s.decisions.removeOption(P, ID, 'o-1', U),
  },
  // Decision categories ride the decision log's feature: 3 mutators.
  {
    name: 'categories.create',
    keys: 'decisions',
    call: (s) => s.categories.create(P, U, { name: 'Scope' } as never),
  },
  {
    name: 'categories.update',
    keys: 'decisions',
    call: (s) => s.categories.update(P, ID, U, DTO),
  },
  {
    name: 'categories.remove',
    keys: 'decisions',
    call: (s) => s.categories.remove(P, ID, U),
  },
];

describe('delivery plan gate', () => {
  it('covers all 38 register mutators (plus the reviewer-naming create)', () => {
    expect(MUTATORS).toHaveLength(39);
  });

  describe.each(MUTATORS)('$name', ({ keys, call }) => {
    it('is refused with plan_limit before any database call', async () => {
      const s = build({
        entitlements: denyingEntitlements({
          kind: 'feature',
          limit_key: Array.isArray(keys) ? keys[0] : keys,
        }),
      });

      const error: unknown = await call(s).then(
        () => null,
        (err: unknown) => err,
      );

      expect(error).toBeInstanceOf(PlanLimitException);
      expect((error as PlanLimitException).getStatus()).toBe(403);
      expect(s.db.from).not.toHaveBeenCalled();
      expect(s.entitlements.resolveScopeForProject).toHaveBeenCalledWith(P);
    });

    it('asks for the right feature(s), on the project scope, as a write', async () => {
      const s = build({ entitlements: allowAllEntitlements() });

      // Allowed through, the method reaches the untouchable db and throws;
      // only the gate call matters here.
      await call(s).catch(() => undefined);

      expect(s.entitlements.assertFeature).toHaveBeenCalledTimes(1);
      expect(s.entitlements.assertFeature).toHaveBeenCalledWith(SCOPE, keys, {
        context: 'write',
      });
    });

    it('answers a non-member with missing_permission and never consults the plan', async () => {
      const s = build({
        entitlements: denyingEntitlements(),
        nonMember: true,
      });

      const error: unknown = await call(s).then(
        () => null,
        (err: unknown) => err,
      );

      expect(error).toBeInstanceOf(MissingPermissionException);
      expect(error).not.toBeInstanceOf(PlanLimitException);
      expect((error as MissingPermissionException).getResponse()).toMatchObject(
        { code: 'missing_permission' },
      );
      expect(s.entitlements.resolveScopeForProject).not.toHaveBeenCalled();
      expect(s.entitlements.assertFeature).not.toHaveBeenCalled();
      expect(s.db.from).not.toHaveBeenCalled();
    });
  });

  describe('reads stay open on a plan without the feature', () => {
    const READS: Array<{ name: string; call: (s: Services) => unknown }> = [
      { name: 'deliverables.list', call: (s) => s.deliverables.list(P, U, {}) },
      { name: 'deliverables.get', call: (s) => s.deliverables.get(P, ID, U) },
      {
        name: 'changeRequests.list',
        call: (s) => s.changeRequests.list(P, U, {}),
      },
      {
        name: 'changeRequests.get',
        call: (s) => s.changeRequests.get(P, ID, U),
      },
      { name: 'risks.list', call: (s) => s.risks.list(P, U, {}) },
      { name: 'risks.candidates', call: (s) => s.risks.candidates(P, U) },
      { name: 'decisions.list', call: (s) => s.decisions.list(P, U, {}) },
      { name: 'decisions.get', call: (s) => s.decisions.get(P, ID, U) },
      { name: 'categories.list', call: (s) => s.categories.list(P, U) },
    ];

    it.each(READS)('$name never calls the gate', async ({ call }) => {
      const s = build({
        entitlements: denyingEntitlements(),
        db: readableDb(),
      });

      await expect(call(s)).resolves.toBeDefined();

      expect(s.entitlements.resolveScopeForProject).not.toHaveBeenCalled();
      expect(s.entitlements.assertFeature).not.toHaveBeenCalled();
      expect(s.entitlements.hasFeature).not.toHaveBeenCalled();
    });
  });
});
