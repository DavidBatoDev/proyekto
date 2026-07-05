import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarDays,
  FileText,
  LayoutGrid,
  MessageCircle,
  MoreHorizontal,
  Share2,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useRoadmapStore } from "@/stores/roadmapStore";
import type { Roadmap } from "@/types/roadmap";
import { RoadmapCanvas } from "./RoadmapCanvas";
import { RoadmapAiAssistantPanel } from "../../../ai/RoadmapAiAssistantPanel";
import type { RoadmapPerformanceMode } from "../models/types";

interface MobileRoadmapViewProps {
  projectId: string;
  roadmap: Roadmap;
  performanceMode: RoadmapPerformanceMode;
  isAiChatPanelOpen: boolean;
  onToggleAiPanel: () => void;
  onEditBrief: () => void;
  onShare: () => void;
  onNodeOpen: (nodeId: string) => void;
  onNodeClose: () => void;
  /** Hero-handoff prompt threaded through to the AI panel's auto-send. */
  initialAiMessage?: string | null;
  onInitialAiMessageConsumed?: () => void;
}

/**
 * Compact, phone-friendly shell for the roadmap detail page. Replaces the
 * desktop three-column layout (resizable explorer + XYFlow canvas + AI side
 * panel) on small screens: a slim header with a Roadmap/Milestones toggle and
 * an overflow menu, the explorer tree as the body (rendered by RoadmapCanvas in
 * `mobile` mode so the editor overlays stay wired), and the AI assistant as a
 * slide-up sheet. The XYFlow canvas is never mounted here.
 */
export function MobileRoadmapView({
  projectId,
  roadmap,
  performanceMode,
  isAiChatPanelOpen,
  onToggleAiPanel,
  onEditBrief,
  onShare,
  onNodeOpen,
  onNodeClose,
  initialAiMessage,
  onInitialAiMessageConsumed,
}: MobileRoadmapViewProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { viewMode, setViewMode, setSelectedEpicId } = useRoadmapStore(
    useShallow((state) => ({
      viewMode: state.canvasViewMode,
      setViewMode: state.setCanvasViewMode,
      setSelectedEpicId: state.setCanvasSelectedEpicId,
    })),
  );

  // "epic" tab mode isn't reachable on mobile; treat anything that isn't the
  // milestones timeline as the roadmap tree for the toggle's active state.
  const isMilestones = viewMode === "milestones";

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Compact header */}
      <header className="relative z-10 shrink-0 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-2 px-3 pt-2">
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
            {roadmap.name}
          </h1>
          <button
            type="button"
            onClick={onToggleAiPanel}
            aria-label="Toggle AI assistant"
            className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
              isAiChatPanelOpen
                ? "border-primary bg-primary/10 text-primary"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <MessageCircle className="h-5 w-5" />
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              aria-label="More actions"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50"
            >
              <MoreHorizontal className="h-5 w-5" />
            </button>
            {isMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsMenuOpen(false)}
                />
                <div className="absolute right-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      onEditBrief();
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <FileText className="h-4 w-4 text-slate-500" />
                    Edit Roadmap
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      onShare();
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <Share2 className="h-4 w-4 text-slate-500" />
                    Share
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Roadmap / Milestones toggle */}
        <div className="flex items-center gap-1 px-3 py-2">
          <button
            type="button"
            onClick={() => {
              setViewMode("roadmap");
              setSelectedEpicId(null);
            }}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              !isMilestones
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
            Roadmap
          </button>
          <button
            type="button"
            onClick={() => setViewMode("milestones")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              isMilestones
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            <CalendarDays className="h-4 w-4" />
            Milestones
          </button>
        </div>
      </header>

      {/* Body: explorer tree / placeholders (RoadmapCanvas in mobile mode) */}
      <div className="min-h-0 flex-1">
        <RoadmapCanvas
          roadmap={roadmap}
          mobile
          onNodeOpen={onNodeOpen}
          onNodeClose={onNodeClose}
          performanceMode={performanceMode}
        />
      </div>

      {/* AI assistant — slide-up sheet */}
      <AnimatePresence>
        {isAiChatPanelOpen && (
          <>
            <motion.div
              key="ai-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[60] bg-black/40"
              onClick={onToggleAiPanel}
            />
            <motion.div
              key="ai-sheet"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="fixed inset-x-0 bottom-0 top-14 z-[60] flex flex-col overflow-hidden rounded-t-2xl bg-white"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
                <span className="text-sm font-semibold text-slate-900">
                  AI Assistant
                </span>
                <button
                  type="button"
                  onClick={onToggleAiPanel}
                  aria-label="Close AI assistant"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <RoadmapAiAssistantPanel
                  projectId={projectId}
                  roadmapId={roadmap.id}
                  roadmapSnapshot={roadmap}
                  isVisible={isAiChatPanelOpen}
                  initialMessage={initialAiMessage}
                  onInitialMessageConsumed={onInitialAiMessageConsumed}
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
