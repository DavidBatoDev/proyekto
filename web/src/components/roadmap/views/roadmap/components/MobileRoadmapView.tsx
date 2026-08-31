import { AnimatePresence, motion } from "framer-motion";
import {
	FileText,
	MessageCircle,
	MoreHorizontal,
	Share2,
	X,
} from "lucide-react";
import { useState } from "react";
import { useRoadmapStore } from "@/stores/roadmapStore";
import type { Roadmap } from "@/types/roadmap";
import { RoadmapAiAssistantPanel } from "../../../ai/RoadmapAiAssistantPanel";
import type { RoadmapPerformanceMode } from "../models/types";
import { RoadmapCanvas } from "./RoadmapCanvas";

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
 * desktop three-column layout (resizable explorer + canvas + AI side panel) on
 * small screens: a slim header with an overflow menu, the explorer tree as the
 * body (rendered by RoadmapCanvas in `mobile` mode so the editor overlays stay
 * wired), and the AI assistant as a slide-up sheet. The canvas is never mounted
 * here.
 *
 * This shell also carries the Timeline route, which reaches mobile through the
 * same `isMobile` branch in RoadmapViewContent; `RoadmapCanvas` picks the Gantt
 * or the explorer off the view mode, and the header titles itself to match.
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
	const canvasViewMode = useRoadmapStore((state) => state.canvasViewMode);

	return (
		<div className="flex h-full flex-col bg-white">
			{/* Compact header */}
			<header className="relative z-10 shrink-0 border-b border-slate-200 bg-white">
				<div className="flex items-center gap-2 px-3 pt-2">
					<h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
						{canvasViewMode === "milestones" ? "Timeline" : roadmap.name}
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
