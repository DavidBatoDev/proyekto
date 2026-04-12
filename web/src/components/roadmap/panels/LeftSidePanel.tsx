import { useState, useEffect, useRef } from "react";
import {
  ChevronRight,
  FolderOpen,
  Layers,
  FileText,
  Search,
  X,
  Folder,
  ExternalLink,
  Plus,
} from "lucide-react";
import type { Message } from "./ChatPanel";
import { useEpics, useRoadmapStore } from "@/stores/roadmapStore";
import { useShallow } from "zustand/react/shallow";

export type { Message } from "./ChatPanel";

interface LeftSidePanelProps {
  messages: Message[];
  onSendMessage: (message: string) => void;
  isGenerating?: boolean;
  isCollapsed?: boolean;
  onSelectEpic?: (epicId: string) => void;
  onSelectFeature?: (epicId: string, featureId: string) => void;
  onSelectTask?: (taskId: string) => void;
  onOpenEpicEditor?: (epicId: string) => void;
  onOpenFeatureEditor?: (epicId: string, featureId: string) => void;
  onOpenTaskDetail?: (taskId: string) => void;
  onNavigateToNode?: (
    nodeId: string,
    options?: { offsetX?: number; taskId?: string },
  ) => void;
  onNavigateToEpicTab?: (epicId: string) => void;
  highlightedEpicId?: string | null;
}

const TASK_NAVIGATE_OFFSET_X = 620;

export function LeftSidePanel({
  messages: _messages,
  onSendMessage: _onSendMessage,
  isGenerating: _isGenerating = false,
  isCollapsed = false,
  onSelectEpic,
  onSelectFeature,
  onSelectTask,
  onOpenEpicEditor,
  onOpenFeatureEditor,
  onOpenTaskDetail,
  onNavigateToNode,
  onNavigateToEpicTab,
  highlightedEpicId,
}: LeftSidePanelProps) {
  return (
    <div className="h-full w-full flex bg-white">
      {/* Main Content Area - Hidden when collapsed */}
      {!isCollapsed && (
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <ExplorerPanel
            onSelectEpic={onSelectEpic}
            onSelectFeature={onSelectFeature}
            onSelectTask={onSelectTask}
            onOpenEpicEditor={onOpenEpicEditor}
            onOpenFeatureEditor={onOpenFeatureEditor}
            onOpenTaskDetail={onOpenTaskDetail}
            onNavigateToNode={onNavigateToNode}
            onNavigateToEpicTab={onNavigateToEpicTab}
            highlightedEpicId={highlightedEpicId}
          />
        </div>
      )}
    </div>
  );
}

interface ExplorerPanelProps {
  onSelectEpic?: (epicId: string) => void;
  onSelectFeature?: (epicId: string, featureId: string) => void;
  onSelectTask?: (taskId: string) => void;
  onOpenEpicEditor?: (epicId: string) => void;
  onOpenFeatureEditor?: (epicId: string, featureId: string) => void;
  onOpenTaskDetail?: (taskId: string) => void;
  onNavigateToNode?: (
    nodeId: string,
    options?: { offsetX?: number; taskId?: string },
  ) => void;
  onNavigateToEpicTab?: (epicId: string) => void;
  highlightedEpicId?: string | null;
}

interface SearchResult {
  type: "epic" | "feature" | "task";
  id: string;
  title: string;
  epicId?: string;
  featureId?: string;
  epicTitle?: string;
  featureTitle?: string;
}

function ExplorerPanel({
  onSelectEpic,
  onSelectFeature,
  onSelectTask,
  onOpenEpicEditor,
  onOpenFeatureEditor,
  onOpenTaskDetail,
  onNavigateToNode,
  onNavigateToEpicTab,
  highlightedEpicId,
}: ExplorerPanelProps) {
  const NAVIGATION_OPEN_DELAY_MS = 700;

  // Subscribe to epics from store
  const epics = useEpics();
  const { openAddFeatureModal, openAddTaskPanel } = useRoadmapStore(
    useShallow((state) => ({
      openAddFeatureModal: state.openAddFeatureModal,
      openAddTaskPanel: state.openAddTaskPanel,
    })),
  );
  const [expandedEpics, setExpandedEpics] = useState<Set<string>>(new Set());
  const [expandedFeatures, setExpandedFeatures] = useState<Set<string>>(
    new Set(),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSearchPopup, setShowSearchPopup] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const hasInitializedExpansion = useRef(false);
  const delayedOpenTimeouts = useRef<number[]>([]);

  const runAfterNavigationDelay = (callback: () => void) => {
    const timeoutId = window.setTimeout(() => {
      callback();
      delayedOpenTimeouts.current = delayedOpenTimeouts.current.filter(
        (id) => id !== timeoutId,
      );
    }, NAVIGATION_OPEN_DELAY_MS);
    delayedOpenTimeouts.current.push(timeoutId);
  };

  // Close search popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchRef.current &&
        !searchRef.current.contains(event.target as Node)
      ) {
        setShowSearchPopup(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    return () => {
      delayedOpenTimeouts.current.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      delayedOpenTimeouts.current = [];
    };
  }, []);

  // Search functionality
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setShowSearchPopup(false);
      return;
    }

    const results: SearchResult[] = [];
    const query = searchQuery.toLowerCase();

    sortedEpics.forEach((epic) => {
      // Search in epics
      if (epic.title.toLowerCase().includes(query)) {
        results.push({
          type: "epic",
          id: epic.id,
          title: epic.title,
        });
      }

      // Search in features
      epic.features?.forEach((feature) => {
        if (feature.title.toLowerCase().includes(query)) {
          results.push({
            type: "feature",
            id: feature.id,
            title: feature.title,
            epicId: epic.id,
            epicTitle: epic.title,
          });
        }

        // Search in tasks
        feature.tasks?.forEach((task) => {
          if (task.title.toLowerCase().includes(query)) {
            results.push({
              type: "task",
              id: task.id,
              title: task.title,
              epicId: epic.id,
              featureId: feature.id,
              epicTitle: epic.title,
              featureTitle: feature.title,
            });
          }
        });
      });
    });

    setSearchResults(results);
    setShowSearchPopup(results.length > 0);
  }, [searchQuery, epics]);

  const toggleEpic = (epicId: string) => {
    const newExpanded = new Set(expandedEpics);
    if (newExpanded.has(epicId)) {
      newExpanded.delete(epicId);
    } else {
      newExpanded.add(epicId);
    }
    setExpandedEpics(newExpanded);
  };

  const toggleFeature = (featureId: string) => {
    const newExpanded = new Set(expandedFeatures);
    if (newExpanded.has(featureId)) {
      newExpanded.delete(featureId);
    } else {
      newExpanded.add(featureId);
    }
    setExpandedFeatures(newExpanded);
  };

  const getTaskTextClasses = (status?: string) => {
    switch (status) {
      case "done":
        return "text-gray-400 line-through";
      case "in_progress":
        return "text-blue-600";
      case "in_review":
        return "text-orange-600";
      case "blocked":
        return "text-red-600";
      case "todo":
      default:
        return "text-gray-600";
    }
  };

  const getTaskDotClasses = (status?: string) => {
    switch (status) {
      case "done":
        return "bg-gray-400";
      case "in_progress":
        return "bg-blue-500";
      case "in_review":
        return "bg-orange-500";
      case "blocked":
        return "bg-red-500";
      case "todo":
      default:
        return "bg-gray-400";
    }
  };

  const handleSearchResultClick = (result: SearchResult) => {
    setShowSearchPopup(false);
    setSearchQuery("");

    if (result.type === "epic") {
      onSelectEpic?.(result.id);
      onNavigateToNode?.(result.id);
    } else if (result.type === "feature" && result.epicId) {
      onSelectFeature?.(result.epicId, result.id);
      onNavigateToNode?.(result.id);
    } else if (result.type === "task") {
      onSelectTask?.(result.id);
      if (result.featureId) {
        onNavigateToNode?.(result.featureId, {
          offsetX: TASK_NAVIGATE_OFFSET_X,
          taskId: result.id,
        });
      }
    }
  };

  const sortedEpics = [...epics].sort((a, b) => a.position - b.position);
  const collapsableEpicIds = sortedEpics
    .filter((epic) => (epic.features?.length || 0) > 0)
    .map((epic) => epic.id);
  const collapsableFeatureIds = sortedEpics.flatMap((epic) =>
    (epic.features || [])
      .filter((feature) => (feature.tasks?.length || 0) > 0)
      .map((feature) => feature.id),
  );

  useEffect(() => {
    if (hasInitializedExpansion.current) {
      return;
    }

    if (collapsableEpicIds.length === 0 && collapsableFeatureIds.length === 0) {
      return;
    }

    // Default to collapsed by initializing with empty sets
    setExpandedEpics(new Set());
    setExpandedFeatures(new Set());
    hasInitializedExpansion.current = true;
  }, [collapsableEpicIds, collapsableFeatureIds]);

  const handleCollapseAll = () => {
    setExpandedEpics(new Set());
    setExpandedFeatures(new Set());
  };

  const handleUncollapseAll = () => {
    setExpandedEpics(new Set(collapsableEpicIds));
    setExpandedFeatures(new Set(collapsableFeatureIds));
  };

  const hasAnyExpanded =
    collapsableEpicIds.some((id) => expandedEpics.has(id)) ||
    collapsableFeatureIds.some((id) => expandedFeatures.has(id));

  const handleToggleCollapseAll = () => {
    if (hasAnyExpanded) {
      handleCollapseAll();
      return;
    }
    handleUncollapseAll();
  };

  // Calculate stats
  const totalFeatures = sortedEpics.reduce(
    (sum, epic) => sum + (epic.features?.length || 0),
    0,
  );
  const totalTasks = sortedEpics.reduce(
    (sum, epic) =>
      sum +
      (epic.features?.reduce(
        (fSum, feature) => fSum + (feature.tasks?.length || 0),
        0,
      ) || 0),
    0,
  );

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden bg-white ">
      {/* Header */}
      <div className="px-4 py-4 border-b border-gray-200 bg-white min-w-0">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold text-gray-900">
            Roadmap Structure
          </h2>
          {sortedEpics.length > 0 && (
            <span className="text-xs font-medium text-gray-500">
              {sortedEpics.length} {sortedEpics.length === 1 ? "epic" : "epics"}
            </span>
          )}
        </div>

        {/* Search Input */}
        <div className="relative mb-3" ref={searchRef}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search epics, features, tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => {
                if (searchResults.length > 0) {
                  setShowSearchPopup(true);
                }
              }}
              className="w-full pl-9 pr-9 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setShowSearchPopup(false);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Search Results Popup */}
          {showSearchPopup && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-96 overflow-y-auto z-50">
              <div className="py-1">
                <div className="text-[10px] font-medium text-gray-400 px-3 py-1.5 uppercase tracking-wide">
                  {searchResults.length}{" "}
                  {searchResults.length === 1 ? "result" : "results"}
                </div>
                <div className="space-y-0">
                  {searchResults.map((result, index) => (
                    <button
                      key={`${result.type}-${result.id}-${index}`}
                      onClick={() => handleSearchResultClick(result)}
                      className="w-full text-left px-3 py-1.5 hover:bg-gray-50 transition-colors group border-b border-gray-50 last:border-b-0"
                    >
                      <div className="flex items-center gap-2">
                        {/* Icon */}
                        {result.type === "epic" && (
                          <FolderOpen className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                        )}
                        {result.type === "feature" && (
                          <Layers className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        )}
                        {result.type === "task" && (
                          <FileText className="w-3.5 h-3.5 text-green-500 shrink-0" />
                        )}

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-900 truncate group-hover:text-primary font-medium">
                            {result.title}
                          </div>
                          {/* Hierarchy Path */}
                          {(result.epicTitle || result.featureTitle) && (
                            <div className="flex items-center gap-1 mt-0.5 text-[11px] text-gray-500">
                              {result.type === "feature" &&
                                result.epicTitle && (
                                  <div className="flex items-center gap-1">
                                    <ChevronRight className="w-2.5 h-2.5" />
                                    <span className="truncate">
                                      {result.epicTitle}
                                    </span>
                                  </div>
                                )}
                              {result.type === "task" && (
                                <>
                                  {result.epicTitle && (
                                    <>
                                      <ChevronRight className="w-2.5 h-2.5" />
                                      <span className="truncate max-w-[100px]">
                                        {result.epicTitle}
                                      </span>
                                    </>
                                  )}
                                  {result.featureTitle && (
                                    <>
                                      <ChevronRight className="w-2.5 h-2.5" />
                                      <span className="truncate max-w-[100px]">
                                        {result.featureTitle}
                                      </span>
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {sortedEpics.length > 0 && (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 text-xs text-gray-600">
              <div className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" />
                <span>
                  {totalFeatures} {totalFeatures === 1 ? "feature" : "features"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                <span>
                  {totalTasks} {totalTasks === 1 ? "task" : "tasks"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleToggleCollapseAll}
                className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
                title={hasAnyExpanded ? "Collapse all" : "Uncollapse all"}
                aria-label={hasAnyExpanded ? "Collapse all" : "Uncollapse all"}
              >
                {hasAnyExpanded ? (
                  <Folder className="w-3.5 h-3.5" />
                ) : (
                  <FolderOpen className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Navigation Tree */}
      <div className="flex-1 overflow-y-auto px-3 py-3 hide-scrollbar">
        {sortedEpics.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <FolderOpen className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900 mb-1">
              No roadmap structure yet
            </h3>
            <p className="text-xs text-gray-500 leading-relaxed">
              Your epics, features, and tasks will appear here once you start
              building your roadmap.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {sortedEpics.map((epic) => {
              const isEpicExpanded = expandedEpics.has(epic.id);
              const isEpicHighlighted = highlightedEpicId === epic.id;
              const features = [...(epic.features || [])].sort(
                (a, b) => a.position - b.position,
              );

              return (
                <div key={epic.id} className="min-w-0">
                  {/* Epic */}
                  <div className="group relative flex items-center gap-1 min-w-0">
                    <div
                      className={`flex-1 min-w-0 flex items-center gap-2 px-3 py-2 pr-12 text-sm font-medium rounded-lg transition-all border ${
                        isEpicHighlighted
                          ? "text-primary bg-orange-50 border-orange-200 shadow-sm"
                          : "text-gray-900 bg-gray-50 border-gray-200 hover:bg-white hover:shadow-sm"
                      }`}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleEpic(epic.id);
                        }}
                        className="p-0.5 hover:bg-black/5 rounded cursor-pointer"
                      >
                        <ChevronRight
                          className={`w-4 h-4 transition-transform ${
                            isEpicHighlighted ? "text-primary" : "text-gray-500"
                          } ${isEpicExpanded ? "rotate-90" : ""}`}
                        />
                      </button>
                      <span
                        onClick={() => {
                          onSelectEpic?.(epic.id);
                          onNavigateToNode?.(epic.id);
                        }}
                        onDoubleClick={() => {
                          runAfterNavigationDelay(() => {
                            onOpenEpicEditor?.(epic.id);
                          });
                        }}
                        className="truncate flex-1 min-w-0 text-left hover:text-primary transition-colors cursor-pointer"
                        title={epic.title}
                      >
                        {epic.title}
                      </span>
                      {features.length > 0 && (
                        <span className="text-xs font-normal text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                          {features.length}
                        </span>
                      )}
                    </div>
                    {/* Quick Add Feature Button - Absolutely positioned */}
                    <button
                      type="button"
                      onClick={() => openAddFeatureModal(epic.id)}
                      className="absolute right-10 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center w-7 h-7 text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-50 hover:border-primary hover:text-primary shadow-sm"
                      title="Add feature to epic"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigateToEpicTab?.(epic.id)}
                      className="shrink-0 inline-flex items-center gap-1 px-2 py-2 text-xs font-medium text-blue-700 bg-white border border-gray-200 rounded-lg hover:bg-blue-50 transition-colors"
                      title="Navigate to epic"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Features */}
                  {isEpicExpanded && features.length > 0 && (
                    <div className="ml-6 mt-1.5 space-y-1 pl-3">
                      {features.map((feature) => {
                        const isFeatureExpanded = expandedFeatures.has(
                          feature.id,
                        );
                        const tasks = [...(feature.tasks || [])].sort(
                          (a, b) => a.position - b.position,
                        );

                        return (
                          <div key={feature.id} className="min-w-0">
                            {/* Feature */}
                            <div className="group relative w-full min-w-0 flex items-center gap-1.5 px-2.5 py-1.5 pr-10 text-sm text-gray-700 hover:bg-white hover:shadow-sm rounded-md transition-all border border-transparent hover:border-gray-200">
                              {tasks.length > 0 ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleFeature(feature.id);
                                  }}
                                  className="p-0.5 hover:bg-black/5 rounded cursor-pointer"
                                >
                                  <ChevronRight
                                    className={`w-3.5 h-3.5 text-gray-400 transition-transform ${
                                      isFeatureExpanded ? "rotate-90" : ""
                                    }`}
                                  />
                                </button>
                              ) : (
                                <div className="w-2 h-2 rounded-full bg-gray-300 ml-1 mr-0.5" />
                              )}
                              <span
                                onClick={() => {
                                  onSelectFeature?.(epic.id, feature.id);
                                  onNavigateToNode?.(feature.id);
                                }}
                                onDoubleClick={() => {
                                  runAfterNavigationDelay(() => {
                                    onOpenFeatureEditor?.(epic.id, feature.id);
                                  });
                                }}
                                className="truncate flex-1 min-w-0 text-left hover:text-primary transition-colors cursor-pointer"
                                title={feature.title}
                              >
                                {feature.title}
                              </span>
                              {tasks.length > 0 && (
                                <span className="text-xs font-normal text-gray-500">
                                  {tasks.length}
                                </span>
                              )}
                              {/* Quick Add Task Button - Absolutely positioned */}
                              <button
                                type="button"
                                onClick={() => openAddTaskPanel(feature.id)}
                                className="absolute right-2 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center w-6 h-6 text-gray-700 bg-white border border-gray-200 rounded hover:bg-gray-50 hover:border-primary hover:text-primary shadow-sm"
                                title="Add task to feature"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>

                            {/* Tasks */}
                            {isFeatureExpanded && tasks.length > 0 && (
                              <div className="ml-5 mt-1 space-y-0.5 pl-2">
                                {tasks.map((task) => (
                                  <button
                                    key={task.id}
                                    onClick={() => {
                                      onSelectTask?.(task.id);
                                      onNavigateToNode?.(feature.id, {
                                        offsetX: TASK_NAVIGATE_OFFSET_X,
                                        taskId: task.id,
                                      });
                                    }}
                                    className="w-full flex items-center gap-2 px-2 py-1 text-xs hover:bg-white rounded transition-colors"
                                  >
                                    <div
                                      className={`w-1.5 h-1.5 rounded-full ${getTaskDotClasses(task.status)}`}
                                    />
                                    <span
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        onNavigateToNode?.(feature.id, {
                                          offsetX: TASK_NAVIGATE_OFFSET_X,
                                          taskId: task.id,
                                        });
                                      }}
                                      onDoubleClick={(event) => {
                                        event.stopPropagation();
                                        runAfterNavigationDelay(() => {
                                          onOpenTaskDetail?.(task.id);
                                        });
                                      }}
                                      className={`truncate text-left flex-1 transition-colors hover:text-primary ${getTaskTextClasses(task.status)}`}
                                      title="Focus in canvas"
                                    >
                                      {task.title}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
