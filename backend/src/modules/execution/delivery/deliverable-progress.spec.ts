import {
  computeProgress,
  expandLinkedTasks,
  type TaskLike,
} from './deliverable-progress';
import type {
  DeliverableCriterionRow,
  DeliverableLinkRow,
} from './delivery.types';

const link = (partial: Partial<DeliverableLinkRow>): DeliverableLinkRow => ({
  id: `link-${Math.abs(partial.position ?? 0)}`,
  feature_id: null,
  task_id: null,
  milestone_id: null,
  position: 0,
  ...partial,
});

const task = (id: string, status = 'todo'): TaskLike => ({ id, status });

const criterion = (is_met: boolean): DeliverableCriterionRow =>
  ({ is_met }) as unknown as DeliverableCriterionRow;

describe('expandLinkedTasks', () => {
  it('takes tasks named directly', () => {
    const tasks = expandLinkedTasks({
      links: [link({ task_id: 't1' })],
      directTasks: [task('t1', 'done')],
      featureTasks: [],
      milestoneFeatureIds: new Map(),
    });
    expect(tasks.map((t) => t.id)).toEqual(['t1']);
  });

  it('expands a feature link to its child tasks', () => {
    const tasks = expandLinkedTasks({
      links: [link({ feature_id: 'f1' })],
      directTasks: [],
      featureTasks: [{ featureId: 'f1', tasks: [task('t1'), task('t2')] }],
      milestoneFeatureIds: new Map(),
    });
    expect(tasks.map((t) => t.id).sort()).toEqual(['t1', 't2']);
  });

  it('reaches tasks through a milestone via its features', () => {
    const tasks = expandLinkedTasks({
      links: [link({ milestone_id: 'm1' })],
      directTasks: [],
      featureTasks: [
        { featureId: 'f1', tasks: [task('t1')] },
        { featureId: 'f2', tasks: [task('t2')] },
        { featureId: 'f3', tasks: [task('t3')] },
      ],
      milestoneFeatureIds: new Map([['m1', ['f1', 'f2']]]),
    });
    // f3 is not part of the milestone, so its task must not be counted.
    expect(tasks.map((t) => t.id).sort()).toEqual(['t1', 't2']);
  });

  // The unique indexes are per-column, so nothing stops a deliverable linking
  // both a feature and one of that feature's own tasks. Counting twice would
  // understate progress.
  it('counts a task once when both it and its feature are linked', () => {
    const tasks = expandLinkedTasks({
      links: [
        link({ feature_id: 'f1', position: 0 }),
        link({ task_id: 't1', position: 1 }),
      ],
      directTasks: [task('t1', 'done')],
      featureTasks: [
        { featureId: 'f1', tasks: [task('t1', 'done'), task('t2')] },
      ],
      milestoneFeatureIds: new Map(),
    });
    expect(tasks).toHaveLength(2);
    expect(tasks.filter((t) => t.id === 't1')).toHaveLength(1);
  });

  it('de-duplicates across two milestones sharing a feature', () => {
    const tasks = expandLinkedTasks({
      links: [
        link({ milestone_id: 'm1', position: 0 }),
        link({ milestone_id: 'm2', position: 1 }),
      ],
      directTasks: [],
      featureTasks: [{ featureId: 'f1', tasks: [task('t1')] }],
      milestoneFeatureIds: new Map([
        ['m1', ['f1']],
        ['m2', ['f1']],
      ]),
    });
    expect(tasks).toHaveLength(1);
  });

  it('returns nothing when a feature link has no tasks', () => {
    expect(
      expandLinkedTasks({
        links: [link({ feature_id: 'f-empty' })],
        directTasks: [],
        featureTasks: [],
        milestoneFeatureIds: new Map(),
      }),
    ).toEqual([]);
  });
});

describe('computeProgress', () => {
  // roadmap_tasks.status uses `done`, unlike feature_status which uses
  // `completed` — mixing them up would silently report 0%.
  it('counts `done`, not `completed`', () => {
    const progress = computeProgress([
      task('t1', 'done'),
      task('t2', 'completed'),
      task('t3', 'in_progress'),
    ]);
    expect(progress.tasks_done).toBe(1);
    expect(progress.tasks_total).toBe(3);
    expect(progress.percent).toBe(33);
  });

  it('reports null rather than 0% when nothing is tracked', () => {
    const progress = computeProgress([], []);
    expect(progress.percent).toBeNull();
    expect(progress.tasks_total).toBe(0);
  });

  it('falls back to criteria when no work is linked', () => {
    const progress = computeProgress(
      [],
      [criterion(true), criterion(true), criterion(false), criterion(false)],
    );
    expect(progress.percent).toBe(50);
    expect(progress.criteria_met).toBe(2);
    expect(progress.criteria_total).toBe(4);
  });

  it('prefers linked work over criteria when both exist', () => {
    const progress = computeProgress(
      [task('t1', 'done'), task('t2', 'done')],
      [criterion(false)],
    );
    expect(progress.percent).toBe(100);
    expect(progress.criteria_met).toBe(0);
  });
});
