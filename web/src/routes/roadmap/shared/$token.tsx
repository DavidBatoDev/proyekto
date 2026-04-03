import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  LogIn,
} from "lucide-react";
import { motion } from "framer-motion";
import {
  RoadmapLeftSidePanel,
  type Message,
  RoadmapCanvas,
  RoadmapTopBar,
} from "@/components/roadmap";
import { roadmapSharesServiceAPI } from "@/services/roadmap-shares.service";
import { useUser } from "@/stores/authStore";
import type {
  Roadmap,
  RoadmapMilestone,
  RoadmapEpic,
  ShareRole,
} from "@/types/roadmap";
import { useRoadmapStore } from "@/stores/roadmapStore";

export const Route = createFileRoute("/roadmap/shared/$token")({
  component: SharedRoadmapPage,
});

function SharedRoadmapPage() {
  const { token } = Route.useParams();
  const user = useUser();

  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [milestones, setMilestones] = useState<RoadmapMilestone[]>([]);
  const [epics, setEpics] = useState<RoadmapEpic[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<ShareRole | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const canvasViewMode = useRoadmapStore((state) => state.canvasViewMode);

  // Messages for the AI chat panel (read-only for shared viewers)
  const [messages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content:
        "You're viewing a shared roadmap. Depending on your access level, you may view, comment, or edit.",
      timestamp: new Date(),
    },
  ]);

  // Load roadmap via share token
  useEffect(() => {
    const loadSharedRoadmap = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const data =
          await roadmapSharesServiceAPI.sharing.getRoadmapByShareToken(token);

        setRoadmap(data);
        setMilestones(data.milestones || []);
        setEpics(data.epics || []);
        setCurrentUserRole(data.currentUserRole as ShareRole);

        // Populate store with shared roadmap data for RoadmapLeftSidePanel to subscribe
        useRoadmapStore.setState({
          roadmap: data,
          epics: data.epics || [],
          milestones: data.milestones || [],
        });
      } catch (error: any) {
        console.error("Failed to load shared roadmap:", error);

        if (error.statusCode === 404) {
          setError("This share link does not exist or has been disabled.");
        } else if (error.statusCode === 410) {
          setError("This share link has expired.");
        } else {
          setError("Failed to load the roadmap. Please try again later.");
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadSharedRoadmap();

    // Cleanup store on unmount
    return () => {
      useRoadmapStore.getState().resetRoadmap();
    };
  }, [token, user]); // Re-fetch if user logs in to check for upgraded permissions

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f6f7f8] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-gray-600">Loading shared roadmap...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !roadmap) {
    return (
      <div className="min-h-screen bg-[#f6f7f8] flex items-center justify-center">
        <div className="text-center max-w-md">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Cannot Access Roadmap
          </h2>
          <p className="text-gray-600 mb-6">
            {error || "The shared roadmap could not be loaded."}
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            Go to Home
          </Link>
        </div>
      </div>
    );
  }

  const isReadOnly = currentUserRole === "viewer";
  const canEdit = currentUserRole === "editor";
  // No-op handlers for read-only mode
  const noOpHandler = () => {
    if (isReadOnly) {
      alert("You have view-only access to this roadmap.");
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f7f8] relative overflow-hidden">
      {/* Shared Access Banner */}
      <div className="relative z-50 bg-linear-to-r from-blue-500/90 to-blue-600 text-white px-4 py-2 text-sm flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2">
          <span className="font-medium">🔗 Shared Roadmap</span>
          <span className="opacity-90">
            You have{" "}
            <strong>
              {currentUserRole === "viewer"
                ? "view-only"
                : currentUserRole === "commenter"
                  ? "commenting"
                  : "editing"}
            </strong>{" "}
            access
          </span>
        </div>
        {!user && (
          <Link
            to="/auth/signup"
            search={{ redirect: `/roadmap/shared/${token}` }}
            className="flex items-center gap-2 px-4 py-1.5 bg-white text-blue-600 rounded-md hover:bg-gray-50 transition-colors font-medium"
          >
            <LogIn className="w-4 h-4" />
            Sign In for More Access
          </Link>
        )}
      </div>

      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      <div className="fixed top-12 left-0 right-0 bottom-0 flex flex-col">
        {/* Canvas navigation tabs */}
        <RoadmapTopBar />

        <div className="flex-1 flex overflow-hidden">
          {/* Left: Chat Sidebar (Info Only) — hidden in milestones view */}
          {canvasViewMode !== "milestones" && (
            <motion.div
              id="roadmap-info-panel"
              className="relative h-full border-r border-gray-200 bg-white overflow-x-hidden"
              initial={{ width: "30%" }}
              animate={{ width: isSidebarOpen ? "30%" : "56px" }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              style={{ minWidth: 56 }}
            >
              <RoadmapLeftSidePanel
                messages={messages}
                onSendMessage={() => {}} // Disabled for shared view
                isGenerating={false}
                isCollapsed={!isSidebarOpen}
              />
            </motion.div>
          )}

          {/* Toggle button - positioned outside motion.div to avoid clipping */}
          {canvasViewMode !== "milestones" && (
            <motion.button
              type="button"
              aria-controls="roadmap-info-panel"
              aria-expanded={isSidebarOpen}
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="absolute top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center hover:bg-gray-50"
              title={isSidebarOpen ? "Collapse panel" : "Expand panel"}
              initial={{ left: "calc(30% - 12px)" }}
              animate={{ left: isSidebarOpen ? "calc(30% - 12px)" : "44px" }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
            >
              {isSidebarOpen ? (
                <ChevronLeft className="w-4 h-4 text-gray-600" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-600" />
              )}
            </motion.button>
          )}

          {/* Right: Roadmap Canvas */}
          <div className="flex-1">
            <RoadmapCanvas
              projectTitle={roadmap.name}
              roadmap={roadmap}
              milestones={milestones}
              epics={epics}
              hideMiniMap={false}
              canEditTimelineDates={canEdit}
              onUpdateRoadmap={canEdit ? () => {} : noOpHandler}
              onAddMilestone={canEdit ? () => {} : noOpHandler}
              onUpdateMilestone={canEdit ? () => {} : noOpHandler}
              onDeleteMilestone={canEdit ? () => {} : noOpHandler}
              // Note: Epic/Feature/Task CRUD now handled by roadmapStore
              // No share or export for shared view
            />
          </div>
        </div>
      </div>
    </div>
  );
}
