import type {
  DeliverableCriterionRow,
  DeliverableLinkRow,
  DeliverableProgress,
} from './delivery.types';

/**
 * Turning a deliverable's links into "18 / 21 tasks completed".
 *
 * A link can target a task, a feature, or a milestone, so the task count is
 * NOT a row count over `deliverable_links`. Each link kind expands differently:
 *
 *   task link      → that task
 *   feature link   → the feature's child tasks
 *   milestone link → milestone_features → features → their tasks
 *
 * The result must be de-duplicated by task id: nothing stops a deliverable from
 * linking both a feature and one of that feature's own tasks (the unique indexes
 * are per-column), and counting such a task twice would understate progress.
 *
 * Split out from the service so the expansion rules are directly testable
 * without a database.
 */

/** Task shape the expansion needs. `done` is the completed value for tasks. */
export interface TaskLike {
  id: string;
  status: string | null;
}

/** Feature → its tasks, as loaded for expansion. */
export interface FeatureTasks {
  featureId: string;
  tasks: TaskLike[];
}

export interface ExpansionInput {
  links: DeliverableLinkRow[];
  /** Tasks named directly by a task link. */
  directTasks: TaskLike[];
  /** Tasks grouped by the feature that owns them. */
  featureTasks: FeatureTasks[];
  /** Which features each linked milestone covers, via milestone_features. */
  milestoneFeatureIds: Map<string, string[]>;
}

/**
 * Every distinct task a deliverable covers.
 *
 * Exported for its own sake because the count and the "which tasks" question
 * have different callers.
 */
export function expandLinkedTasks(input: ExpansionInput): TaskLike[] {
  const byId = new Map<string, TaskLike>();
  const tasksByFeature = new Map<string, TaskLike[]>();
  for (const entry of input.featureTasks) {
    tasksByFeature.set(entry.featureId, entry.tasks);
  }

  const addFeature = (featureId: string) => {
    for (const task of tasksByFeature.get(featureId) ?? []) {
      byId.set(task.id, task);
    }
  };

  for (const task of input.directTasks) byId.set(task.id, task);

  for (const link of input.links) {
    if (link.feature_id) {
      addFeature(link.feature_id);
      continue;
    }
    if (link.milestone_id) {
      // A milestone reaches tasks only through features: milestone_epics was
      // dropped in the v2 roadmap migration.
      for (const featureId of input.milestoneFeatureIds.get(
        link.milestone_id,
      ) ?? []) {
        addFeature(featureId);
      }
    }
  }

  return [...byId.values()];
}

/** `roadmap_tasks.status` uses `done` — not `completed`, unlike feature_status. */
export function isTaskDone(task: TaskLike): boolean {
  return task.status === 'done';
}

export function computeProgress(
  tasks: TaskLike[],
  criteria: DeliverableCriterionRow[] = [],
): DeliverableProgress {
  const tasksTotal = tasks.length;
  const tasksDone = tasks.filter(isTaskDone).length;
  const criteriaTotal = criteria.length;
  const criteriaMet = criteria.filter((criterion) => criterion.is_met).length;

  // Prefer linked work as the measure; fall back to criteria so a deliverable
  // with a checklist but no linked tasks still reads as progressing rather than
  // as a permanent 0%. Null (not 0) when there is nothing to measure at all, so
  // the UI can say "not tracked yet" instead of implying no work has happened.
  let percent: number | null = null;
  if (tasksTotal > 0) {
    percent = Math.round((tasksDone / tasksTotal) * 100);
  } else if (criteriaTotal > 0) {
    percent = Math.round((criteriaMet / criteriaTotal) * 100);
  }

  return {
    tasks_total: tasksTotal,
    tasks_done: tasksDone,
    percent,
    criteria_total: criteriaTotal,
    criteria_met: criteriaMet,
  };
}
