// Widget components for ReactFlow
export { EpicWidget, type EpicWidgetData } from "./widgets/EpicWidget";
export { FeatureWidget, type FeatureWidgetData } from "./widgets/FeatureWidget";
export { TaskWidget, type TaskWidgetData } from "./widgets/TaskWidget";
export { TaskListItem } from "./widgets/TaskListItem";

// View components
export { RoadmapCanvas } from "./views/roadmap/components/RoadmapCanvas";
export { RoadmapView } from "./views/roadmap/RoadmapView";
export { RoadmapViewContent } from "./views/roadmap/components/RoadmapViewContent";
export { RoadmapTopBar } from "./views/RoadmapTopBar";
export { EpicTab } from "./views/roadmap/components/EpicTab";
export { MilestonesView } from "./views/milestones/MilestonesView";

// Panel components
export {
  RoadmapLeftSidePanel,
  RoadmapLeftSidePanel as LeftSidePanel,
  type Message,
} from "./panels/RoadmapLeftSidePanel";
export { SidePanel } from "./panels/SidePanel";
export { JSONRoadmapSidePanel } from "./panels/JSONRoadmapSidePanel";
export { ChatPanel } from "./panels/ChatPanel";
export { FeatureReorderConfirmModal } from "./panels/FeatureReorderConfirmModal";
export { EpicReorderConfirmModal } from "./panels/EpicReorderConfirmModal";

// Modal components
export { EpicModal } from "./modals/EpicModal";
export { FeatureModal } from "./modals/FeatureModal";
export { ShareRoadmapModal } from "./modals/ShareRoadmapModal";
export {
  RoadmapMetadataModal,
  type RoadmapMetadataFormData,
} from "./modals/RoadmapMetadataModal";
export { MakeProjectDialog } from "./modals/MakeProjectDialog";
export { RoadmapModalLayout } from "./modals/RoadmapModalLayout";

// Shared utilities
export { CommentsSection } from "./shared/CommentsSection";

// AI components
export { TryAiFloatingAssistant } from "./ai/TryAiFloatingAssistant";
