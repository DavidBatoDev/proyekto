import type { Roadmap, RoadmapEpic, RoadmapFeature, RoadmapTask } from "@/types/roadmap";

export class ArtifactSnapshotNormalizationError extends Error {
  constructor(
    public code: "INVALID_CANDIDATE_SNAPSHOT",
    message: string,
    public path: string,
  ) {
    super(message);
    this.name = "ArtifactSnapshotNormalizationError";
  }
}

interface NormalizePreviewSnapshotInput {
  candidateSnapshot: Record<string, unknown> | undefined;
  baseUpdatedAt: string | undefined;
  fallbackRoadmap?: Roadmap | null;
}

function asObject(
  value: unknown,
  path: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ArtifactSnapshotNormalizationError(
      "INVALID_CANDIDATE_SNAPSHOT",
      `Expected object at ${path}.`,
      path,
    );
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function requiredString(
  value: unknown,
  path: string,
): string {
  const parsed = readString(value);
  if (!parsed || !parsed.trim()) {
    throw new ArtifactSnapshotNormalizationError(
      "INVALID_CANDIDATE_SNAPSHOT",
      `Missing required string at ${path}.`,
      path,
    );
  }
  return parsed;
}

function resolveSourceCollections(
  record: Record<string, unknown>,
  canonicalKey: string,
  alternateKey: string,
): Record<string, unknown>[] {
  return asArray(record[canonicalKey]).length > 0
    ? asArray(record[canonicalKey])
    : asArray(record[alternateKey]);
}

function normalizeTasks(
  featureRecord: Record<string, unknown>,
  featureId: string,
): RoadmapTask[] {
  const taskRecords = resolveSourceCollections(featureRecord, "roadmap_tasks", "tasks");
  return taskRecords.map((taskRecord, taskIndex) => {
    const taskId = requiredString(taskRecord.id, `roadmap_features[${featureId}].roadmap_tasks[${taskIndex}].id`);
    return {
      id: taskId,
      feature_id: featureId,
      title: readString(taskRecord.title) ?? "Untitled task",
      description: readString(taskRecord.description),
      status: (readString(taskRecord.status) ?? "todo") as RoadmapTask["status"],
      priority: (readString(taskRecord.priority) ?? "medium") as RoadmapTask["priority"],
      position: readNumber(taskRecord.position) ?? taskIndex,
      assignee_id: readString(taskRecord.assignee_id) ?? null,
      due_date: readString(taskRecord.due_date),
      completed_at: readString(taskRecord.completed_at),
      created_at: readString(taskRecord.created_at) ?? "",
      updated_at: readString(taskRecord.updated_at) ?? "",
    };
  });
}

function normalizeFeatures(
  epicRecord: Record<string, unknown>,
  epicId: string,
  roadmapId: string,
): RoadmapFeature[] {
  const featureRecords = resolveSourceCollections(epicRecord, "roadmap_features", "features");
  return featureRecords.map((featureRecord, featureIndex) => {
    const featureId = requiredString(featureRecord.id, `roadmap_epics[${epicId}].roadmap_features[${featureIndex}].id`);
    return {
      id: featureId,
      roadmap_id: roadmapId,
      epic_id: epicId,
      title: readString(featureRecord.title) ?? "Untitled feature",
      description: readString(featureRecord.description),
      status: (readString(featureRecord.status) ?? "not_started") as RoadmapFeature["status"],
      position: readNumber(featureRecord.position) ?? featureIndex,
      is_deliverable: readBoolean(featureRecord.is_deliverable) ?? true,
      start_date: readString(featureRecord.start_date),
      end_date: readString(featureRecord.end_date),
      created_at: readString(featureRecord.created_at) ?? "",
      updated_at: readString(featureRecord.updated_at) ?? "",
      tasks: normalizeTasks(featureRecord, featureId),
    };
  });
}

function normalizeEpics(
  snapshotRecord: Record<string, unknown>,
  roadmapId: string,
): RoadmapEpic[] {
  const epicRecords = resolveSourceCollections(snapshotRecord, "roadmap_epics", "epics");
  return epicRecords.map((epicRecord, epicIndex) => {
    const epicId = requiredString(epicRecord.id, `roadmap_epics[${epicIndex}].id`);
    return {
      id: epicId,
      roadmap_id: roadmapId,
      title: readString(epicRecord.title) ?? "Untitled epic",
      description: readString(epicRecord.description),
      priority: (readString(epicRecord.priority) ?? "medium") as RoadmapEpic["priority"],
      status: (readString(epicRecord.status) ?? "backlog") as RoadmapEpic["status"],
      position: readNumber(epicRecord.position) ?? epicIndex,
      color: readString(epicRecord.color),
      estimated_hours: readNumber(epicRecord.estimated_hours),
      actual_hours: readNumber(epicRecord.actual_hours),
      start_date: readString(epicRecord.start_date),
      end_date: readString(epicRecord.end_date),
      completed_date: readString(epicRecord.completed_date),
      tags: readStringArray(epicRecord.tags),
      created_at: readString(epicRecord.created_at) ?? "",
      updated_at: readString(epicRecord.updated_at) ?? "",
      features: normalizeFeatures(epicRecord, epicId, roadmapId),
    };
  });
}

export function normalizeArtifactCandidateSnapshot({
  candidateSnapshot,
  baseUpdatedAt,
  fallbackRoadmap,
}: NormalizePreviewSnapshotInput): Roadmap {
  const snapshotRecord = asObject(candidateSnapshot, "candidate_snapshot");
  const roadmapId = requiredString(snapshotRecord.id, "candidate_snapshot.id");
  const fallbackTimestamp =
    readString(snapshotRecord.updated_at) ||
    fallbackRoadmap?.updated_at ||
    baseUpdatedAt ||
    new Date().toISOString();

  const normalizedRoadmap: Roadmap = {
    id: roadmapId,
    project_id:
      readString(snapshotRecord.project_id) ??
      fallbackRoadmap?.project_id ??
      null,
    name: readString(snapshotRecord.name) ?? fallbackRoadmap?.name ?? "Roadmap Preview",
    description: readString(snapshotRecord.description) ?? fallbackRoadmap?.description,
    category: readString(snapshotRecord.category) ?? fallbackRoadmap?.category,
    owner_id: readString(snapshotRecord.owner_id) ?? fallbackRoadmap?.owner_id ?? "preview-owner",
    is_public:
      readBoolean(snapshotRecord.is_public) ??
      fallbackRoadmap?.is_public,
    is_templatable:
      readBoolean(snapshotRecord.is_templatable) ??
      fallbackRoadmap?.is_templatable,
    status: (readString(snapshotRecord.status) ?? fallbackRoadmap?.status ?? "draft") as Roadmap["status"],
    start_date: readString(snapshotRecord.start_date) ?? fallbackRoadmap?.start_date,
    end_date: readString(snapshotRecord.end_date) ?? fallbackRoadmap?.end_date,
    settings:
      (snapshotRecord.settings as Record<string, unknown> | undefined) ??
      fallbackRoadmap?.settings,
    created_at:
      readString(snapshotRecord.created_at) ??
      fallbackRoadmap?.created_at ??
      fallbackTimestamp,
    updated_at: fallbackTimestamp,
    epics: normalizeEpics(snapshotRecord, roadmapId).map((epic) => ({
      ...epic,
      created_at: epic.created_at || fallbackTimestamp,
      updated_at: epic.updated_at || fallbackTimestamp,
      features: (epic.features ?? []).map((feature) => ({
        ...feature,
        created_at: feature.created_at || fallbackTimestamp,
        updated_at: feature.updated_at || fallbackTimestamp,
        tasks: (feature.tasks ?? []).map((task) => ({
          ...task,
          created_at: task.created_at || fallbackTimestamp,
          updated_at: task.updated_at || fallbackTimestamp,
        })),
      })),
    })),
    milestones: [],
  };

  return normalizedRoadmap;
}
