import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ListChecks, AlertCircle, Loader2, Plus } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useRoadmapFullQuery } from "@/hooks/useProjectQueries";
import { useRoadmapStore } from "@/stores/roadmapStore";
import { KanbanView } from "@/components/roadmap/views/kanban/KanbanView";
import { WorkItemsBrowserModal } from "@/components/roadmap/modals/WorkItemsBrowserModal";

export const Route = createFileRoute(
  "/project/$projectId/work-items/$roadmapId",
)({
  component: WorkItemsBoardPage,
});

function WorkItemsBoardPage() {
  const { projectId, roadmapId } = Route.useParams();
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const roadmapFullQuery = useRoadmapFullQuery(roadmapId);
  const { applyRoadmapSnapshot } = useRoadmapStore(
    useShallow((s) => ({
      applyRoadmapSnapshot: s.applyRoadmapSnapshot,
    })),
  );

  useEffect(() => {
    if (roadmapFullQuery.data) {
      applyRoadmapSnapshot(roadmapFullQuery.data);
    }
  }, [roadmapFullQuery.data, applyRoadmapSnapshot]);

  const isLoading = roadmapFullQuery.isPending;
  const error = roadmapFullQuery.error;

  return (
    <div className="relative flex flex-col h-full min-h-0 bg-slate-50/30">
      {/* Header */}
      <div className="px-6 py-2.5 bg-white border-b border-slate-100 shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#0f172a]/10 flex items-center justify-center shrink-0">
              <ListChecks className="w-4 h-4 text-[#0f172a]" />
            </div>
            <div className="leading-tight">
              <h1 className="text-sm font-semibold text-slate-900">
                Work Items
              </h1>
              <p className="text-[11px] text-slate-400">
                Board view of every task in this roadmap
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsBrowserOpen(true)}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 text-white px-3 py-1.5 text-xs font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add work items
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex flex-col">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <p className="text-sm font-medium text-slate-700">
              Couldn't load the roadmap
            </p>
            <p className="text-xs text-slate-500">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </div>
        ) : (
          <KanbanView />
        )}
      </div>

      <WorkItemsBrowserModal
        projectId={projectId}
        roadmapId={roadmapId}
        isOpen={isBrowserOpen}
        onClose={() => setIsBrowserOpen(false)}
      />
    </div>
  );
}
