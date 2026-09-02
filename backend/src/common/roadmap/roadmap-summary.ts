import { SupabaseClient } from '@supabase/supabase-js';

/**
 * The per-project roadmap rollup behind every project card — epic/feature/task
 * counts and a progress percentage.
 *
 * Shared by the dashboard project list and the team's Projects tab, which show
 * the same card. It lives here rather than on the projects repository because
 * the teams module has no repository layer, and reaching across for one private
 * method would have meant exporting a repository token between two modules that
 * are already joined by a `forwardRef`.
 */

// Mirrors get_task_progress in the roadmap canvas schema so the card's progress
// bar agrees with the cascade the canvas itself computes.
const TASK_STATUS_PROGRESS: Record<string, number> = {
  todo: 0,
  in_progress: 25,
  in_review: 75,
  done: 100,
  blocked: 0,
};

export interface ProjectRoadmapSummary {
  roadmap_id: string;
  name: string;
  epic_count: number;
  feature_count: number;
  task_count: number;
  done_task_count: number;
  /** 0-100, rounded to the nearest integer. */
  progress: number;
}

export type RoadmapSummaryRow = {
  id: string;
  name: string;
  project_id: string | null;
  updated_at: string;
  epics?: Array<{
    id: string;
    features?: Array<{
      id: string;
      tasks?: Array<{ status: string }>;
    }>;
  }>;
};

const average = (values: number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

export function buildRoadmapSummary(
  row: RoadmapSummaryRow,
): ProjectRoadmapSummary {
  const epics = row.epics ?? [];
  let featureCount = 0;
  let taskCount = 0;
  let doneTaskCount = 0;

  const epicProgress = epics.map((epic) => {
    const features = epic.features ?? [];
    featureCount += features.length;
    const featureProgress = features.map((feature) => {
      const tasks = feature.tasks ?? [];
      taskCount += tasks.length;
      doneTaskCount += tasks.filter((task) => task.status === 'done').length;
      return average(
        tasks.map((task) => TASK_STATUS_PROGRESS[task.status] ?? 0),
      );
    });
    return average(featureProgress);
  });

  return {
    roadmap_id: row.id,
    name: row.name,
    epic_count: epics.length,
    feature_count: featureCount,
    task_count: taskCount,
    done_task_count: doneTaskCount,
    progress: Math.round(average(epicProgress)),
  };
}

/**
 * One roadmap summary per project id. A project with several roadmaps reports
 * its most recently updated one, and a project with none is simply absent from
 * the map — callers treat that as `null` rather than an error, because a
 * project without a roadmap is an ordinary state, not a failure.
 */
export async function fetchRoadmapSummaries(
  supabase: SupabaseClient,
  projectIds: string[],
): Promise<Map<string, ProjectRoadmapSummary>> {
  const summaries = new Map<string, ProjectRoadmapSummary>();
  if (projectIds.length === 0) return summaries;

  const { data, error } = await supabase
    .from('roadmaps')
    .select(
      'id, name, project_id, updated_at, epics:roadmap_epics(id, features:roadmap_features(id, tasks:roadmap_tasks(status)))',
    )
    .in('project_id', projectIds);

  if (error || !data) return summaries;

  const latestByProject = new Map<string, RoadmapSummaryRow>();
  for (const row of data as unknown as RoadmapSummaryRow[]) {
    if (!row.project_id) continue;
    const current = latestByProject.get(row.project_id);
    if (!current || row.updated_at > current.updated_at) {
      latestByProject.set(row.project_id, row);
    }
  }

  for (const [projectId, row] of latestByProject) {
    summaries.set(projectId, buildRoadmapSummary(row));
  }
  return summaries;
}
