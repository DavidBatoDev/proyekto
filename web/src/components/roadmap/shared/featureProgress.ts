import type { RoadmapFeature, RoadmapTask, TaskStatus } from "@/types/roadmap";

const TASK_STATUS_PROGRESS_WEIGHT: Record<TaskStatus, number> = {
  todo: 0,
  in_progress: 50,
  in_review: 80,
  done: 100,
  blocked: 0,
};

export function calculateFeatureProgressFromTasks(
  tasks?: RoadmapTask[],
): number {
  if (!tasks?.length) return 0;

  const total = tasks.reduce((sum, task) => {
    return sum + (TASK_STATUS_PROGRESS_WEIGHT[task.status] ?? 0);
  }, 0);

  return Math.round(total / tasks.length);
}

export function getCompletedTaskCount(tasks?: RoadmapTask[]): number {
  return tasks?.filter((task) => task.status === "done").length ?? 0;
}

export function calculateEpicProgressFromFeatures(
  features?: RoadmapFeature[],
): number {
  if (!features?.length) return 0;

  const allTasks = features.flatMap((feature) => feature.tasks ?? []);
  return calculateFeatureProgressFromTasks(allTasks);
}
