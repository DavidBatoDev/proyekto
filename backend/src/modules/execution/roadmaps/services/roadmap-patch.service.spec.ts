import { BadRequestException, Logger } from '@nestjs/common';
import type {
  CreateFullRoadmapDto,
  FullRoadmapState,
  FullRoadmapTaskDto,
  JsonPatchOperationDto,
} from '../dto/patch-roadmap.dto';
import { RoadmapJsonPatchProcessor } from '../patch/roadmap-json-patch.processor';
import { RoadmapPatchService } from './roadmap-patch.service';

/**
 * Task assignees on the legacy full-roadmap paths (POST /roadmaps/full and
 * PATCH /roadmaps/:id/json-patch): which callers get the full `assignee_ids`
 * set sent to upsert_full_roadmap, and which are passed through scalar-only so
 * the RPC's changed-scalar branch decides whether the join table moves.
 */
describe('RoadmapPatchService task assignees', () => {
  const ROADMAP_ID = '55e431e2-e416-468c-a973-94d97280e97d';
  const USER_ID = 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb';
  const EPIC_ID = 'dad5697a-8962-4f80-8bc3-8a964edd8e56';
  const FEATURE_ID = '60bcab3f-3989-448d-9c84-3261cf38685b';
  const TASK_ID = '1beecdd2-f057-4c41-bf6d-8bb9e5e4b2b1';
  const OTHER_TASK_ID = '7a1f0c2e-5b3d-4e6f-8a9b-0c1d2e3f4a5b';
  const NEW_TASK_ID = '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
  const ANA = '0f7be23f-3b57-4cf4-a269-a98d2164a45a';
  const BEN = '8d1c2b3a-4e5f-4a6b-9c7d-0e1f2a3b4c5d';
  const CID = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
  const TASKS_PATH = '/roadmap_epics/0/roadmap_features/0/roadmap_tasks';
  const TASK_PATH = `${TASKS_PATH}/0`;

  type SentTask = Record<string, unknown>;
  type PatchRepo = { upsertFullRoadmap: jest.Mock };

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());

  // What the JSON-patch path reads back through findFull: the lean shape
  // embeds id-only join rows, primary first, next to the legacy scalar.
  const storedState = (): Record<string, unknown> => ({
    id: ROADMAP_ID,
    name: 'Roadmap',
    status: 'active',
    roadmap_epics: [
      {
        id: EPIC_ID,
        title: 'Epic',
        roadmap_features: [
          {
            id: FEATURE_ID,
            title: 'Feature',
            roadmap_tasks: [
              {
                id: TASK_ID,
                title: 'Task',
                status: 'todo',
                assignee_id: ANA,
                assignees: [{ id: ANA }, { id: BEN }],
              },
              {
                id: OTHER_TASK_ID,
                title: 'Other',
                status: 'todo',
                assignee_id: null,
                assignees: [],
              },
            ],
          },
        ],
      },
    ],
  });

  const createService = () => {
    const roadmapsRepo = {
      findById: jest.fn().mockResolvedValue({
        id: ROADMAP_ID,
        owner_id: USER_ID,
        project_id: null,
      }),
      findFull: jest.fn().mockResolvedValue(storedState()),
    };
    const patchRepo: PatchRepo = {
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
    );
    return { service, patchRepo, roadmapsRepo };
  };

  const sentTasks = (patchRepo: PatchRepo): SentTask[] => {
    expect(patchRepo.upsertFullRoadmap).toHaveBeenCalledTimes(1);
    const { fullState } = patchRepo.upsertFullRoadmap.mock.calls[0][0] as {
      fullState: FullRoadmapState;
    };
    return (fullState.roadmap_epics?.[0].roadmap_features?.[0].roadmap_tasks ??
      []) as unknown as SentTask[];
  };

  const sentTask = (patchRepo: PatchRepo, id: string = TASK_ID): SentTask => {
    const task = sentTasks(patchRepo).find((candidate) => candidate.id === id);
    if (!task) throw new Error(`task ${id} was not sent to the RPC`);
    return task;
  };

  const fullDto = (tasks: FullRoadmapTaskDto[]): CreateFullRoadmapDto => ({
    name: 'New roadmap',
    roadmap_epics: [
      {
        title: 'Epic',
        roadmap_features: [{ title: 'Feature', roadmap_tasks: tasks }],
      },
    ],
  });

  describe('createFull (POST /roadmaps/full)', () => {
    it('sends a scalar-only task with no assignee_ids key and the scalar untouched', async () => {
      const { service, patchRepo } = createService();

      await service.createFull(
        fullDto([
          { title: 'Scalar', assignee_id: ANA },
          { title: 'Unassigned' },
        ]),
        USER_ID,
      );

      const [scalar, unassigned] = sentTasks(patchRepo);
      expect(scalar.assignee_id).toBe(ANA);
      expect(scalar).not.toHaveProperty('assignee_ids');
      expect(unassigned.assignee_id).toBeUndefined();
      expect(unassigned).not.toHaveProperty('assignee_ids');
      expect(patchRepo.upsertFullRoadmap).toHaveBeenCalledWith(
        expect.objectContaining({ createIfMissing: true, actorId: USER_ID }),
      );
    });

    it('an explicit assignee_ids wins over the scalar, deduped, primary mirrored', async () => {
      const { service, patchRepo } = createService();

      await service.createFull(
        fullDto([
          { title: 'Set', assignee_id: ANA, assignee_ids: [BEN, CID, BEN] },
        ]),
        USER_ID,
      );

      expect(sentTasks(patchRepo)[0]).toMatchObject({
        assignee_ids: [BEN, CID],
        assignee_id: BEN,
      });
    });

    it('join rows (assignees[]) derive the set with the scalar rotated to the front', async () => {
      const { service, patchRepo } = createService();

      await service.createFull(
        fullDto([
          {
            title: 'Rows',
            assignee_id: BEN,
            assignees: [{ id: ANA }, { profile: { id: BEN } }],
          } as FullRoadmapTaskDto,
        ]),
        USER_ID,
      );

      expect(sentTasks(patchRepo)[0]).toMatchObject({
        assignee_ids: [BEN, ANA],
        assignee_id: BEN,
      });
    });
  });

  describe('applyPatch (PATCH /roadmaps/:id/json-patch)', () => {
    const apply = (
      service: RoadmapPatchService,
      operations: JsonPatchOperationDto[],
    ) => service.applyPatch(ROADMAP_ID, operations, USER_ID);

    it('an unrelated edit still sends the full stored set derived from the join rows', async () => {
      const { service, patchRepo } = createService();

      await apply(service, [
        { op: 'replace', path: `${TASK_PATH}/title`, value: 'Renamed' },
      ]);

      expect(sentTask(patchRepo)).toMatchObject({
        title: 'Renamed',
        assignee_ids: [ANA, BEN],
        assignee_id: ANA,
      });
      const other = sentTask(patchRepo, OTHER_TASK_ID);
      expect(other.assignee_ids).toEqual([]);
      expect(other.assignee_id).toBeUndefined();
    });

    it('replace .../assignee_ids replaces the set and mirrors the primary', async () => {
      const { service, patchRepo } = createService();

      await apply(service, [
        {
          op: 'replace',
          path: `${TASK_PATH}/assignee_ids`,
          value: [BEN, CID, BEN],
        },
      ]);

      expect(sentTask(patchRepo)).toMatchObject({
        assignee_ids: [BEN, CID],
        assignee_id: BEN,
      });
    });

    it('replace .../assignee_id with a different id drops the stale set so the scalar reaches the RPC', async () => {
      const { service, patchRepo } = createService();

      await apply(service, [
        { op: 'replace', path: `${TASK_PATH}/assignee_id`, value: CID },
      ]);

      const task = sentTask(patchRepo);
      expect(task.assignee_id).toBe(CID);
      expect(task).not.toHaveProperty('assignee_ids');
      // The sibling that was not patched keeps its derived set.
      expect(sentTask(patchRepo, OTHER_TASK_ID).assignee_ids).toEqual([]);
    });

    it('replace .../assignee_id with null unassigns through the scalar', async () => {
      const { service, patchRepo } = createService();

      await apply(service, [
        { op: 'replace', path: `${TASK_PATH}/assignee_id`, value: null },
      ]);

      const task = sentTask(patchRepo);
      expect(task.assignee_id).toBeNull();
      expect(task).not.toHaveProperty('assignee_ids');
    });

    it('re-sending the unchanged scalar keeps the co-assignees', async () => {
      const { service, patchRepo } = createService();

      await apply(service, [
        { op: 'replace', path: `${TASK_PATH}/assignee_id`, value: ANA },
      ]);

      expect(sentTask(patchRepo)).toMatchObject({
        assignee_ids: [ANA, BEN],
        assignee_id: ANA,
      });
    });

    it('when the set and the scalar are both patched, the set wins', async () => {
      const { service, patchRepo } = createService();

      await apply(service, [
        { op: 'replace', path: `${TASK_PATH}/assignee_ids`, value: [CID] },
        { op: 'replace', path: `${TASK_PATH}/assignee_id`, value: BEN },
      ]);

      expect(sentTask(patchRepo)).toMatchObject({
        assignee_ids: [CID],
        assignee_id: CID,
      });
    });

    it('resolves a patched scalar by task id when an earlier op shifted the array', async () => {
      const { service, patchRepo } = createService();

      await apply(service, [
        {
          op: 'add',
          path: `${TASKS_PATH}/0`,
          value: { id: NEW_TASK_ID, title: 'Inserted', assignee_id: CID },
        },
        // The original task now sits at index 1.
        { op: 'replace', path: `${TASKS_PATH}/1/assignee_id`, value: CID },
      ]);

      const patched = sentTask(patchRepo);
      expect(patched.assignee_id).toBe(CID);
      expect(patched).not.toHaveProperty('assignee_ids');
      const inserted = sentTask(patchRepo, NEW_TASK_ID);
      expect(inserted.assignee_id).toBe(CID);
      expect(inserted).not.toHaveProperty('assignee_ids');
      expect(sentTask(patchRepo, OTHER_TASK_ID).assignee_ids).toEqual([]);
    });

    it('rejects assignee_ids outside a task path before writing', async () => {
      const { service, patchRepo } = createService();

      await expect(
        apply(service, [
          {
            op: 'replace',
            path: '/roadmap_epics/0/roadmap_features/0/assignee_ids',
            value: [ANA],
          },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(patchRepo.upsertFullRoadmap).not.toHaveBeenCalled();
    });
  });
});
