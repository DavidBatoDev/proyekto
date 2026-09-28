import { Logger } from '@nestjs/common';
import { PlanLimitException } from '../../../shared/entitlements/plan-limit.exception';
import { RoadmapJsonPatchProcessor } from '../patch/roadmap-json-patch.processor';
import { RoadmapPatchService } from './roadmap-patch.service';
import {
  planLimitsHarness,
  type PlanLimitsHarnessOptions,
} from './__roadmap-plan-limits-test-kit-spec';

/**
 * The per-roadmap node limit on the legacy full-state paths (POST
 * /roadmaps/full and PATCH /roadmaps/:id/json-patch), run against the real
 * rule (Free = 250 nodes): growth past the limit is refused, an over-limit
 * roadmap can still be re-saved or shrunk, a guest's roadmap is exempt, and a
 * create-full that re-homes a roadmap into another workspace is judged from 0.
 */
describe('RoadmapPatchService plan limits', () => {
  const ROADMAP_ID = '55e431e2-e416-468c-a973-94d97280e97d';
  const USER_ID = 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb';

  const epics = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      title: `Epic ${index}`,
      position: index,
      roadmap_features: [],
    }));

  function build(
    harness: PlanLimitsHarnessOptions,
    existing: {
      nodes: number;
      project_id?: string | null;
      owner_id?: string;
    } | null,
  ) {
    const { planLimits, repo } = planLimitsHarness(harness);
    const roadmapsRepo = {
      findById: jest.fn().mockResolvedValue(
        existing
          ? {
              id: ROADMAP_ID,
              owner_id: existing.owner_id ?? USER_ID,
              project_id: existing.project_id ?? null,
            }
          : null,
      ),
      findFull: jest.fn().mockResolvedValue(
        existing
          ? {
              id: ROADMAP_ID,
              name: 'Roadmap',
              status: 'active',
              roadmap_epics: epics(existing.nodes),
            }
          : null,
      ),
    };
    const patchRepo = {
      upsertFullRoadmap: jest.fn().mockResolvedValue(null),
    };
    const service = new RoadmapPatchService(
      roadmapsRepo as never,
      patchRepo as never,
      new RoadmapJsonPatchProcessor(),
      {
        assertRoadmapPermission: jest.fn().mockResolvedValue({}),
        assertProjectRoadmapPermission: jest.fn().mockResolvedValue({}),
      } as never,
      { publishRoadmapChange: jest.fn() } as never,
      planLimits,
    );
    return { service, patchRepo, entitlementsRepo: repo };
  }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('applyPatch', () => {
    it('refuses growth past the limit without writing', async () => {
      const { service, patchRepo } = build(
        { nodes: { [ROADMAP_ID]: 250 } },
        { nodes: 250 },
      );

      const error = await service
        .applyPatch(
          ROADMAP_ID,
          [{ op: 'add', path: '/roadmap_epics/-', value: { title: 'New' } }],
          USER_ID,
        )
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(PlanLimitException);
      expect((error as PlanLimitException).payload).toMatchObject({
        context: 'full_state',
        used: 250,
        limit: 250,
      });
      expect(patchRepo.upsertFullRoadmap).not.toHaveBeenCalled();
    });

    it('lets an over-limit roadmap shrink and be edited', async () => {
      const shrink = build({ nodes: { [ROADMAP_ID]: 260 } }, { nodes: 260 });
      await shrink.service.applyPatch(
        ROADMAP_ID,
        [{ op: 'remove', path: '/roadmap_epics/0' }],
        USER_ID,
      );
      expect(shrink.patchRepo.upsertFullRoadmap).toHaveBeenCalledTimes(1);

      const edit = build({ nodes: { [ROADMAP_ID]: 260 } }, { nodes: 260 });
      await edit.service.applyPatch(
        ROADMAP_ID,
        [{ op: 'replace', path: '/roadmap_epics/0/title', value: 'Renamed' }],
        USER_ID,
      );
      expect(edit.patchRepo.upsertFullRoadmap).toHaveBeenCalledTimes(1);
    });

    it('exempts a guest-owned standalone roadmap', async () => {
      const { service, patchRepo } = build(
        {
          subjects: {
            [`roadmap:${ROADMAP_ID}`]: { workspace_id: null, exempt: true },
          },
        },
        { nodes: 400 },
      );

      await service.applyPatch(
        ROADMAP_ID,
        [{ op: 'add', path: '/roadmap_epics/-', value: { title: 'New' } }],
        USER_ID,
      );
      expect(patchRepo.upsertFullRoadmap).toHaveBeenCalledTimes(1);
    });
  });

  describe('createFull', () => {
    const dto = (count: number, extra: Record<string, unknown> = {}) =>
      ({
        name: 'Roadmap',
        roadmap_epics: epics(count).map(({ title }) => ({ title })),
        ...extra,
      }) as never;

    it('refuses a new 251-node roadmap for a Free user', async () => {
      const { service, patchRepo } = build(
        { owners: { [USER_ID]: { workspaceId: 'ws-free' } } },
        null,
      );

      const error = await service
        .createFull(dto(251), USER_ID)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(PlanLimitException);
      expect((error as PlanLimitException).payload).toMatchObject({
        context: 'create',
        used: 0,
        workspace_id: 'ws-free',
      });
      expect(patchRepo.upsertFullRoadmap).not.toHaveBeenCalled();
    });

    it('lets a new 250-node roadmap through', async () => {
      const { service, patchRepo } = build(
        { owners: { [USER_ID]: { workspaceId: 'ws-free' } } },
        null,
      );

      await service.createFull(dto(250), USER_ID);
      expect(patchRepo.upsertFullRoadmap).toHaveBeenCalledTimes(1);
    });

    it('exempts a guest creating a standalone roadmap', async () => {
      const { service, patchRepo } = build(
        { owners: { [USER_ID]: { workspaceId: null, isGuest: true } } },
        null,
      );

      await service.createFull(dto(400), USER_ID);
      expect(patchRepo.upsertFullRoadmap).toHaveBeenCalledTimes(1);
    });

    it('allows an over-limit re-save at the same count (grandfathered)', async () => {
      const { service, patchRepo, entitlementsRepo } = build(
        { nodes: { [ROADMAP_ID]: 260 } },
        { nodes: 260 },
      );

      await service.createFull(dto(260, { id: ROADMAP_ID }), USER_ID);

      expect(entitlementsRepo.countRoadmapNodes).toHaveBeenCalledWith([
        ROADMAP_ID,
      ]);
      expect(patchRepo.upsertFullRoadmap).toHaveBeenCalledTimes(1);
    });

    it('refuses an over-limit re-save that grows', async () => {
      const { service, patchRepo } = build(
        { nodes: { [ROADMAP_ID]: 260 } },
        { nodes: 260 },
      );

      await expect(
        service.createFull(dto(261, { id: ROADMAP_ID }), USER_ID),
      ).rejects.toBeInstanceOf(PlanLimitException);
      expect(patchRepo.upsertFullRoadmap).not.toHaveBeenCalled();
    });

    it('judges a roadmap re-homed into a Free project from 0', async () => {
      const { service, patchRepo } = build(
        {
          subjects: {
            [`roadmap:${ROADMAP_ID}`]: { workspace_id: 'ws-pro' },
            'project:p-free': { workspace_id: 'ws-free' },
          },
          nodes: { [ROADMAP_ID]: 300 },
        },
        { nodes: 300 },
      );

      const error = await service
        .createFull(dto(300, { id: ROADMAP_ID, project_id: 'p-free' }), USER_ID)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(PlanLimitException);
      expect((error as PlanLimitException).payload).toMatchObject({
        context: 'link',
        used: 0,
        workspace_id: 'ws-free',
      });
      expect(patchRepo.upsertFullRoadmap).not.toHaveBeenCalled();
    });

    it('never counts on an unlimited plan', async () => {
      const { service, patchRepo, entitlementsRepo } = build(
        {
          subjects: { [`roadmap:${ROADMAP_ID}`]: { workspace_id: 'ws-pro' } },
          nodes: { [ROADMAP_ID]: 900 },
        },
        { nodes: 900 },
      );

      await service.createFull(dto(950, { id: ROADMAP_ID }), USER_ID);

      expect(entitlementsRepo.countRoadmapNodes).not.toHaveBeenCalled();
      expect(patchRepo.upsertFullRoadmap).toHaveBeenCalledTimes(1);
    });
  });
});
