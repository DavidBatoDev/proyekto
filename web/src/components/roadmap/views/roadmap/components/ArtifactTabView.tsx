import { useMemo, useState } from "react";
import { Check, FileDiff, X } from "lucide-react";
import { RoadmapView } from "../RoadmapView";
import { useRoadmapStore } from "@/stores/roadmapStore";
import type {
  Roadmap,
  RoadmapTask,
  RoadmapEpic,
  RoadmapFeature,
} from "@/types/roadmap";
import type { RoadmapArtifactPreview } from "@/types/roadmapArtifact";

interface ArtifactTabViewProps {
  artifact: RoadmapArtifactPreview;
  onApply: (artifactId: string) => void;
  onDiscard: (artifactId: string) => void;
}

const STATUS_STYLE: Record<
  RoadmapArtifactPreview["status"],
  { label: string; className: string }
> = {
  draft: {
    label: "Draft",
    className: "border-orange-300 bg-orange-50 text-orange-700",
  },
  applied: {
    label: "Applied",
    className: "border-green-300 bg-green-50 text-green-700",
  },
  discarded: {
    label: "Discarded",
    className: "border-gray-300 bg-gray-100 text-gray-700",
  },
};

const noopUpdateEpic = (_epic: RoadmapEpic) => {};
const noopDeleteEpic = (_epicId: string) => {};
const noopUpdateFeature = (_feature: RoadmapFeature) => {};
const noopDeleteFeature = (_featureId: string) => {};
const noopUpdateTask = (_task: RoadmapTask) => {};

const sortByReferenceOrder = <T extends { id: string; position?: number }>(
  items: T[],
  referenceOrder: Map<string, number>,
): T[] => {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aRef = referenceOrder.get(a.item.id);
      const bRef = referenceOrder.get(b.item.id);
      const aHasRef = typeof aRef === "number";
      const bHasRef = typeof bRef === "number";

      if (aHasRef && bHasRef && aRef !== bRef) return aRef - bRef;
      if (aHasRef !== bHasRef) return aHasRef ? -1 : 1;

      const aPos =
        typeof a.item.position === "number"
          ? a.item.position
          : Number.MAX_SAFE_INTEGER;
      const bPos =
        typeof b.item.position === "number"
          ? b.item.position
          : Number.MAX_SAFE_INTEGER;
      if (aPos !== bPos) return aPos - bPos;

      return a.index - b.index;
    })
    .map((entry) => entry.item);
};

const sortByPosition = <T extends { position?: number }>(items: T[]): T[] => {
  return [...items].sort((a, b) => {
    const aPos =
      typeof a.position === "number" ? a.position : Number.MAX_SAFE_INTEGER;
    const bPos =
      typeof b.position === "number" ? b.position : Number.MAX_SAFE_INTEGER;
    return aPos - bPos;
  });
};

const alignSnapshotOrderingWithFallback = (
  snapshot: Roadmap,
  fallbackRoadmap?: Roadmap | null,
): Roadmap => {
  if (!fallbackRoadmap?.epics?.length || !snapshot.epics?.length) {
    return snapshot;
  }

  const fallbackEpics = sortByPosition(fallbackRoadmap.epics);
  const fallbackEpicOrder = new Map(
    fallbackEpics.map((epic, index) => [epic.id, index]),
  );
  const fallbackEpicById = new Map(
    fallbackEpics.map((epic) => [epic.id, epic]),
  );

  const orderedEpics = sortByReferenceOrder(
    snapshot.epics,
    fallbackEpicOrder,
  ).map((epic, epicIndex) => {
    const fallbackEpic = fallbackEpicById.get(epic.id);
    const fallbackFeatures = sortByPosition(fallbackEpic?.features ?? []);
    const fallbackFeatureOrder = new Map(
      fallbackFeatures.map((feature, index) => [feature.id, index]),
    );
    const fallbackFeatureById = new Map(
      fallbackFeatures.map((feature) => [feature.id, feature]),
    );

    const orderedFeatures = sortByReferenceOrder(
      epic.features ?? [],
      fallbackFeatureOrder,
    ).map((feature, featureIndex) => {
      const fallbackFeature = fallbackFeatureById.get(feature.id);
      const fallbackTasks = sortByPosition(fallbackFeature?.tasks ?? []);
      const fallbackTaskOrder = new Map(
        fallbackTasks.map((task, index) => [task.id, index]),
      );
      const orderedTasks = sortByReferenceOrder(
        feature.tasks ?? [],
        fallbackTaskOrder,
      ).map((task, taskIndex) => ({ ...task, position: taskIndex }));

      return {
        ...feature,
        position: featureIndex,
        tasks: orderedTasks,
      };
    });

    return {
      ...epic,
      position: epicIndex,
      features: orderedFeatures,
    };
  });

  return {
    ...snapshot,
    epics: orderedEpics,
  };
};

const hasSameStructureIds = (
  snapshot: Roadmap,
  fallbackRoadmap?: Roadmap | null,
): boolean => {
  if (!fallbackRoadmap?.epics?.length || !snapshot.epics?.length) {
    return false;
  }

  const snapshotEpicIds = new Set(
    (snapshot.epics ?? []).map((epic) => epic.id),
  );
  const fallbackEpicIds = new Set(
    (fallbackRoadmap.epics ?? []).map((epic) => epic.id),
  );
  if (snapshotEpicIds.size !== fallbackEpicIds.size) return false;
  for (const epicId of snapshotEpicIds) {
    if (!fallbackEpicIds.has(epicId)) return false;
  }

  const fallbackEpicById = new Map(
    (fallbackRoadmap.epics ?? []).map((epic) => [epic.id, epic]),
  );

  for (const snapshotEpic of snapshot.epics ?? []) {
    const fallbackEpic = fallbackEpicById.get(snapshotEpic.id);
    if (!fallbackEpic) return false;

    const snapshotFeatureIds = new Set(
      (snapshotEpic.features ?? []).map((feature) => feature.id),
    );
    const fallbackFeatureIds = new Set(
      (fallbackEpic.features ?? []).map((feature) => feature.id),
    );
    if (snapshotFeatureIds.size !== fallbackFeatureIds.size) return false;
    for (const featureId of snapshotFeatureIds) {
      if (!fallbackFeatureIds.has(featureId)) return false;
    }

    const fallbackFeatureById = new Map(
      (fallbackEpic.features ?? []).map((feature) => [feature.id, feature]),
    );

    for (const snapshotFeature of snapshotEpic.features ?? []) {
      const fallbackFeature = fallbackFeatureById.get(snapshotFeature.id);
      if (!fallbackFeature) return false;

      const snapshotTaskIds = new Set(
        (snapshotFeature.tasks ?? []).map((task) => task.id),
      );
      const fallbackTaskIds = new Set(
        (fallbackFeature.tasks ?? []).map((task) => task.id),
      );
      if (snapshotTaskIds.size !== fallbackTaskIds.size) return false;
      for (const taskId of snapshotTaskIds) {
        if (!fallbackTaskIds.has(taskId)) return false;
      }
    }
  }

  return true;
};

export function ArtifactTabView({
  artifact,
  onApply,
  onDiscard,
}: ArtifactTabViewProps) {
  const [isDiffOpen, setIsDiffOpen] = useState(false);
  const currentRoadmap = useRoadmapStore((state) => state.roadmap);
  const isDraft = artifact.status === "draft";
  const isApplied = artifact.status === "applied";
  const isDiscarded = artifact.status === "discarded";
  const statusStyle = STATUS_STYLE[artifact.status];
  const candidateRoadmap = artifact.candidateSnapshot;
  const displayRoadmap = useMemo(() => {
    if (!hasSameStructureIds(candidateRoadmap, currentRoadmap)) {
      return candidateRoadmap;
    }
    return alignSnapshotOrderingWithFallback(candidateRoadmap, currentRoadmap);
  }, [candidateRoadmap, currentRoadmap]);
  const summaryRows = useMemo(
    () =>
      Object.entries(artifact.semanticDiffSummary).filter(
        ([, value]) => value > 0,
      ),
    [artifact.semanticDiffSummary],
  );
  const changeRows = artifact.semanticDiffChanges ?? [];
  const blockingValidationIssueCount = artifact.validationIssues.filter(
    (issue) => issue.severity === "error",
  ).length;
  const canApply = isDraft || isDiscarded;
  const applyLabel = isDiscarded ? "Reapply" : "Apply";

  return (
    <div className="relative h-full bg-white">
      <RoadmapView
        roadmap={displayRoadmap}
        epics={displayRoadmap.epics || []}
        showMiniMap={false}
        onUpdateEpic={noopUpdateEpic}
        onDeleteEpic={noopDeleteEpic}
        onUpdateFeature={noopUpdateFeature}
        onDeleteFeature={noopDeleteFeature}
        onUpdateTask={noopUpdateTask}
      />

      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        <span
          className={`inline-flex h-9 items-center rounded-lg border px-3 text-xs font-semibold ${statusStyle.className}`}
        >
          {statusStyle.label}
        </span>
        <button
          type="button"
          onClick={() => setIsDiffOpen((prev) => !prev)}
          className="h-9 px-3 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 inline-flex items-center gap-1.5 hover:bg-gray-50"
        >
          <FileDiff className="w-4 h-4" />
          See Diff
        </button>
        {canApply && (
          <button
            type="button"
            onClick={() => onApply(artifact.artifactId)}
            disabled={isDraft && blockingValidationIssueCount > 0}
            className="h-9 px-3 rounded-lg border border-green-300 bg-green-50 text-sm text-green-700 inline-flex items-center gap-1.5 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check className="w-4 h-4" />
            {applyLabel}
          </button>
        )}
        {isApplied && (
          <button
            type="button"
            onClick={() => onDiscard(artifact.artifactId)}
            className="h-9 px-3 rounded-lg border border-red-300 bg-red-50 text-sm text-red-700 inline-flex items-center gap-1.5 hover:bg-red-100"
          >
            <X className="w-4 h-4" />
            Discard
          </button>
        )}
      </div>

      {isDiffOpen && (
        <aside className="absolute top-0 right-0 z-30 h-full w-[360px] border-l border-gray-200 bg-white shadow-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <div>
              <p className="text-sm font-semibold text-gray-900">
                Artifact Diff
              </p>
              <p className="text-xs text-gray-500">
                {isDiscarded
                  ? "Discarded change snapshot"
                  : isApplied
                    ? "Applied change snapshot"
                    : "Draft preview snapshot"}
              </p>
              {artifact.changeId && (
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Change: {artifact.changeId}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsDiffOpen(false)}
              className="h-8 w-8 rounded-md border border-gray-200 inline-flex items-center justify-center text-gray-600 hover:bg-gray-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 space-y-4 overflow-y-auto h-[calc(100%-57px)]">
            <section>
              <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
                Summary
              </h4>
              <div className="space-y-1.5">
                {summaryRows.length > 0 ? (
                  summaryRows.map(([key, value]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between rounded-md border border-gray-200 px-2.5 py-2 text-xs"
                    >
                      <span className="text-gray-600">
                        {key.replaceAll("_", " ")}
                      </span>
                      <span className="font-semibold text-gray-900">
                        {value}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-gray-500">No semantic changes.</p>
                )}
              </div>
            </section>

            <section>
              <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
                Change Details
              </h4>
              <div className="space-y-2">
                {changeRows.length > 0 ? (
                  changeRows.map((change, index) => (
                    <div
                      key={`${change.type}-${change.node.id}-${index}`}
                      className="rounded-md border border-gray-200 px-2.5 py-2 text-xs"
                    >
                      <p className="font-semibold text-gray-900">
                        {change.type.replaceAll("_", " ")}
                      </p>
                      <p className="mt-0.5 text-gray-600">
                        {change.node.type} · {change.node.id}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-gray-500">No detailed changes.</p>
                )}
              </div>
            </section>

            <section>
              <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
                Validation Issues
              </h4>
              <div className="space-y-2">
                {artifact.validationIssues.length > 0 ? (
                  artifact.validationIssues.map((issue, index) => (
                    <div
                      key={`${issue.code}-${index}`}
                      className={`rounded-md border px-2.5 py-2 text-xs ${
                        issue.severity === "error"
                          ? "border-red-200 bg-red-50 text-red-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                      }`}
                    >
                      <p className="font-semibold">{issue.code}</p>
                      <p className="mt-0.5">{issue.message}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-gray-500">No validation issues.</p>
                )}
              </div>
            </section>
          </div>
        </aside>
      )}
    </div>
  );
}
