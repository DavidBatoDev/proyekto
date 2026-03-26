import { useMemo, useState } from "react";
import { Check, FileDiff, X } from "lucide-react";
import { RoadmapView } from "../RoadmapView";
import type { RoadmapTask, RoadmapEpic, RoadmapFeature } from "@/types/roadmap";
import type { RoadmapArtifactPreview } from "@/types/roadmapArtifact";

interface ArtifactTabViewProps {
  artifact: RoadmapArtifactPreview;
  onApply: (artifactId: string) => void;
  onDiscard: (artifactId: string) => void;
}

const noopUpdateEpic = (_epic: RoadmapEpic) => {};
const noopDeleteEpic = (_epicId: string) => {};
const noopUpdateFeature = (_feature: RoadmapFeature) => {};
const noopDeleteFeature = (_featureId: string) => {};
const noopUpdateTask = (_task: RoadmapTask) => {};

export function ArtifactTabView({
  artifact,
  onApply,
  onDiscard,
}: ArtifactTabViewProps) {
  const [isDiffOpen, setIsDiffOpen] = useState(false);
  const candidateRoadmap = artifact.candidateSnapshot;
  const summaryRows = useMemo(
    () =>
      Object.entries(artifact.semanticDiffSummary).filter(
        ([, value]) => value > 0,
      ),
    [artifact.semanticDiffSummary],
  );

  return (
    <div className="relative h-full bg-white">
      <RoadmapView
        roadmap={candidateRoadmap}
        epics={candidateRoadmap.epics || []}
        showMiniMap={false}
        onUpdateEpic={noopUpdateEpic}
        onDeleteEpic={noopDeleteEpic}
        onUpdateFeature={noopUpdateFeature}
        onDeleteFeature={noopDeleteFeature}
        onUpdateTask={noopUpdateTask}
      />

      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsDiffOpen((prev) => !prev)}
          className="h-9 px-3 rounded-lg border border-gray-300 bg-white text-sm text-gray-700 inline-flex items-center gap-1.5 hover:bg-gray-50"
        >
          <FileDiff className="w-4 h-4" />
          See Diff
        </button>
        <button
          type="button"
          onClick={() => onApply(artifact.artifactId)}
          className="h-9 px-3 rounded-lg border border-green-300 bg-green-50 text-sm text-green-700 inline-flex items-center gap-1.5 hover:bg-green-100"
        >
          <Check className="w-4 h-4" />
          Apply/Commit
        </button>
        <button
          type="button"
          onClick={() => onDiscard(artifact.artifactId)}
          className="h-9 px-3 rounded-lg border border-red-300 bg-red-50 text-sm text-red-700 inline-flex items-center gap-1.5 hover:bg-red-100"
        >
          <X className="w-4 h-4" />
          Discard
        </button>
      </div>

      {isDiffOpen && (
        <aside className="absolute top-0 right-0 z-30 h-full w-[360px] border-l border-gray-200 bg-white shadow-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <div>
              <p className="text-sm font-semibold text-gray-900">Artifact Diff</p>
              <p className="text-xs text-gray-500">Mock semantic diff and validation</p>
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
                      <span className="text-gray-600">{key.replaceAll("_", " ")}</span>
                      <span className="font-semibold text-gray-900">{value}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-gray-500">No semantic changes.</p>
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
