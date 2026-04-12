import type {
  RoadmapAiActivityStepStatus,
  RoadmapAiActivityStepTitleList,
} from "./useRoadmapAiAssistantSession";

export const SUPPORTED_TRACE_TOOL_NAMES = [
  "get_roadmap_summary",
  "get_roadmap_overview",
  "resolve_node_reference",
  "search_nodes",
  "search_tasks",
  "get_node_details",
  "get_children_from_resolution",
  "get_features_by_epic",
  "get_feature_details",
  "get_epics_by_roadmap",
  "get_epic_progress",
  "get_tasks_assigned_to_me",
  "get_tasks_by_status",
  "get_tasks_by_parent",
  "get_overdue_tasks",
  "get_blocked_items",
  "create_epic",
  "create_feature",
  "create_task",
  "update_task_status",
  "update_task_priority",
  "update_task_assignee",
  "update_feature_status",
  "update_epic_status",
  "update_titles",
  "delete_task",
  "delete_feature",
  "delete_epic",
  "move_task_to_feature",
  "move_feature_to_epic",
  "reorder_tasks",
  "reorder_features",
  "reorder_epics",
  "bulk_update_task_status",
  "bulk_update_tasks_by_parent",
  "bulk_update_tasks_by_filter",
  "bulk_assign_tasks",
  "bulk_delete_tasks",
  "bulk_move_tasks_to_feature",
  "bulk_update_feature_status",
  "bulk_update_epic_status",
  "plan_roadmap_operations",
  "get_children",
  "get_tasks_by_feature",
  "get_tasks_by_epic",
] as const;

export type SupportedTraceToolName = (typeof SUPPORTED_TRACE_TOOL_NAMES)[number];

const SUPPORTED_TRACE_TOOL_SET = new Set<string>(SUPPORTED_TRACE_TOOL_NAMES);
const UUID_LIKE_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

interface ToolMessageContext {
  toolArgs: Record<string, unknown> | null;
  resultSummary: Record<string, unknown> | null;
  summaryText: string;
  status: RoadmapAiActivityStepStatus;
}

interface ToolMessageDescriptor {
  requestedTitle: string;
  completedTitle: string;
  buildCompletedTitle?: (ctx: ToolMessageContext) => string;
  buildRequestedSummary: (ctx: ToolMessageContext) => string;
  buildResultSummary: (ctx: ToolMessageContext) => string;
}

export interface ToolTraceMessage {
  title: string;
  summary: string;
  usedFallback: boolean;
  titleList?: RoadmapAiActivityStepTitleList;
}

export interface FriendlyMinimalToolLabel {
  requested: string;
  completed: string;
}

const FALLBACK_REQUESTED_TITLE = "Working on your request";
const FALLBACK_COMPLETED_TITLE = "Completed a request step";
const FALLBACK_REQUESTED_SUMMARY =
  "I am working through this step now and validating the output before moving to the next step.";

const warnedUnknownTools = new Set<string>();

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const toStringValue = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const toBooleanValue = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
  }
  return null;
};

const toNumberValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }
  }
  return null;
};

const toArrayValue = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) return [];
  return value;
};

const parseCountFromText = (text: string, key: string): number | null => {
  const escapedKey = key.replace("_", "[_\\s]");
  const match = text.match(new RegExp(`${escapedKey}\\s*[:=]\\s*(\\d+)`, "i"));
  if (!match?.[1]) return null;
  return Number.parseInt(match[1], 10);
};

const humanizeEnum = (value: string | null): string | null => {
  if (!value) return null;
  return value.replace(/_/g, " ").trim();
};

const quote = (value: string | null): string | null => {
  if (!value) return null;
  return `"${value}"`;
};

const listWithAnd = (parts: string[]): string => {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
};

const safeSelection = (
  label: "roadmap item" | "epic" | "feature" | "task" | "parent",
  idValue: unknown,
): string | null => {
  const id = toStringValue(idValue);
  if (!id) return null;
  return `the selected ${label}`;
};

const countFromContext = (
  ctx: ToolMessageContext,
  key: string,
): number | null => {
  const fromSummary = toNumberValue(ctx.resultSummary?.[key]);
  if (fromSummary != null) return fromSummary;
  return parseCountFromText(ctx.summaryText, key);
};

const summarizeCounts = (
  ctx: ToolMessageContext,
  options: {
    tasks?: string;
    matches?: string;
    operations?: string;
    children?: string;
    epics?: string;
  },
): string | null => {
  const parts: string[] = [];
  const tasksCount = countFromContext(ctx, "tasks_count");
  const matchesCount = countFromContext(ctx, "matches_count");
  const operationsCount = countFromContext(ctx, "operations_count");
  const childrenCount = countFromContext(ctx, "children_count");
  const epicsCount = countFromContext(ctx, "epics_count");

  if (tasksCount != null && options.tasks) {
    parts.push(options.tasks.replace("{count}", String(tasksCount)));
  }
  if (matchesCount != null && options.matches) {
    parts.push(options.matches.replace("{count}", String(matchesCount)));
  }
  if (operationsCount != null && options.operations) {
    parts.push(options.operations.replace("{count}", String(operationsCount)));
  }
  if (childrenCount != null && options.children) {
    parts.push(options.children.replace("{count}", String(childrenCount)));
  }
  if (epicsCount != null && options.epics) {
    parts.push(options.epics.replace("{count}", String(epicsCount)));
  }

  if (parts.length === 0) return null;
  return `${parts.join(". ")}.`;
};

const resultSummaryWithDefault = (
  ctx: ToolMessageContext,
  options: {
    tasks?: string;
    matches?: string;
    operations?: string;
    children?: string;
    epics?: string;
  },
  fallback: string,
): string => {
  const summary = summarizeCounts(ctx, options);
  return summary ? `This step finished successfully. ${summary}` : fallback;
};

interface ToolResultCounts {
  tasksCount: number | null;
  matchesCount: number | null;
  operationsCount: number | null;
  childrenCount: number | null;
  epicsCount: number | null;
}

const toSentence = (value: string): string => {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const toOutcomeSentenceFromTitle = (completedTitle: string): string => {
  const trimmed = completedTitle.trim();
  if (!trimmed) return "I completed this step.";
  const lowerFirst = `${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`;
  return toSentence(`I ${lowerFirst}`);
};

const sanitizeFallbackContext = (value: string): string | null => {
  const compact = value
    .replace(/^This step finished successfully\.\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return null;
  if (UUID_LIKE_PATTERN.test(compact)) return null;
  if (/[a-z]+_[a-z0-9_]+/i.test(compact)) return null;
  if (/[{}[\]]/.test(compact)) return null;
  return toSentence(compact);
};

const getResultCounts = (ctx: ToolMessageContext): ToolResultCounts => ({
  tasksCount: countFromContext(ctx, "tasks_count"),
  matchesCount: countFromContext(ctx, "matches_count"),
  operationsCount: countFromContext(ctx, "operations_count"),
  childrenCount: countFromContext(ctx, "children_count"),
  epicsCount: countFromContext(ctx, "epics_count"),
});

const getResultTitleList = (
  ctx: ToolMessageContext,
): RoadmapAiActivityStepTitleList | undefined => {
  const titles = toArrayValue(ctx.resultSummary?.item_titles)
    .map((item) => toStringValue(item))
    .filter((item): item is string => Boolean(item));
  if (titles.length === 0) return undefined;

  const shownCount = toNumberValue(ctx.resultSummary?.item_titles_shown_count);
  const totalCount = toNumberValue(ctx.resultSummary?.item_titles_total_count);
  const hasMoreFlag = toBooleanValue(ctx.resultSummary?.item_titles_has_more);
  const shown = shownCount ?? titles.length;
  const total = totalCount ?? Math.max(shown, titles.length);
  const hasMore = hasMoreFlag ?? total > shown;

  return {
    items: titles,
    shownCount: shown,
    totalCount: total,
    hasMore,
  };
};

const getStatusScope = (toolArgs: Record<string, unknown> | null): string | null => {
  const status = humanizeEnum(toStringValue(toolArgs?.status));
  if (!status || status === "all") return "across all statuses";
  return `with status ${status}`;
};

const getLimitSuffix = (toolArgs: Record<string, unknown> | null): string => {
  const limit = toNumberValue(toolArgs?.limit);
  if (limit == null) return "";
  return ` (up to ${limit})`;
};

const getIncludeCompletedSuffix = (
  toolArgs: Record<string, unknown> | null,
): string => {
  const includeCompleted = toBooleanValue(toolArgs?.include_completed);
  if (includeCompleted === true) return " including completed tasks";
  if (includeCompleted === false) return " excluding completed tasks";
  return "";
};

const getSelectedTaskCount = (toolArgs: Record<string, unknown> | null): number | null => {
  const taskIds = toArrayValue(toolArgs?.task_ids);
  if (taskIds.length > 0) return taskIds.length;
  return null;
};

const getToolScopePhrase = (
  toolName: SupportedTraceToolName,
  toolArgs: Record<string, unknown> | null,
): string | null => {
  if (!toolArgs) return null;
  const limitSuffix = getLimitSuffix(toolArgs);
  switch (toolName) {
    case "get_tasks_assigned_to_me": {
      return `tasks ${getStatusScope(toolArgs) ?? "across the roadmap"}${limitSuffix}`;
    }
    case "get_tasks_by_status": {
      return `tasks ${getStatusScope(toolArgs) ?? "across the roadmap"}${limitSuffix}`;
    }
    case "get_tasks_by_parent": {
      const parentScope = readParentScopePhrase(toolArgs) || "under the selected parent";
      const statusScope = getStatusScope(toolArgs);
      const statusPart = statusScope ? ` ${statusScope}` : "";
      return `tasks ${parentScope}${statusPart}${getIncludeCompletedSuffix(toolArgs)}${limitSuffix}`;
    }
    case "get_tasks_by_feature":
    case "get_tasks_by_epic":
    case "search_tasks": {
      const statusScope = getStatusScope(toolArgs);
      const statusPart = statusScope ? ` ${statusScope}` : "";
      return `tasks${statusPart}${limitSuffix}`;
    }
    case "get_features_by_epic": {
      return `features under the selected epic${getStatusScope(toolArgs) ? ` ${getStatusScope(toolArgs)}` : ""}${limitSuffix}`;
    }
    case "get_epics_by_roadmap": {
      return `epics${getStatusScope(toolArgs) ? ` ${getStatusScope(toolArgs)}` : ""}${limitSuffix}`;
    }
    case "get_overdue_tasks": {
      const date = toStringValue(toolArgs.reference_date);
      return `overdue tasks${date ? ` against ${quote(date)}` : ""}${limitSuffix}`;
    }
    case "get_blocked_items": {
      return `blocked items${limitSuffix}`;
    }
    case "bulk_update_tasks_by_filter": {
      const filters = toRecord(toolArgs.filters);
      return `tasks ${describeBulkFilterScope(filters)}${limitSuffix}`;
    }
    case "bulk_update_tasks_by_parent": {
      const parentScope = readParentScopePhrase(toolArgs) || "under the selected parent";
      return `tasks ${parentScope}${getIncludeCompletedSuffix(toolArgs)}${limitSuffix}`;
    }
    case "bulk_update_task_status":
    case "bulk_assign_tasks":
    case "bulk_delete_tasks":
    case "bulk_move_tasks_to_feature": {
      const selectedCount = getSelectedTaskCount(toolArgs);
      if (selectedCount != null) {
        return `${selectedCount} selected tasks`;
      }
      return `selected tasks${limitSuffix}`;
    }
    default: {
      return null;
    }
  }
};

const getToolTargetPhrase = (
  toolName: SupportedTraceToolName,
  toolArgs: Record<string, unknown> | null,
): string | null => {
  if (!toolArgs) return null;
  if (toolName === "bulk_update_tasks_by_filter") {
    return describeBulkUpdateTarget(toRecord(toolArgs.update));
  }
  if (toolName === "bulk_update_task_status") {
    const status = humanizeEnum(toStringValue(toolArgs.status));
    return status ? `set status to ${status}` : "apply the requested status update";
  }
  if (toolName === "bulk_assign_tasks") {
    if (toolArgs.assignee_id === null) return "clear assignee";
    if (toStringValue(toolArgs.assignee_id)) return "assign to the selected teammate";
  }
  return null;
};

const getCountPhraseForTool = (
  toolName: SupportedTraceToolName,
  counts: ToolResultCounts,
): string | null => {
  const tasksLabel =
    toolName === "get_tasks_assigned_to_me"
      ? "assigned tasks"
      : toolName === "get_overdue_tasks"
        ? "overdue tasks"
        : toolName === "get_blocked_items"
          ? "blocked tasks"
          : "tasks";

  if (counts.operationsCount != null) {
    return `prepared ${counts.operationsCount} roadmap changes`;
  }
  if (counts.tasksCount != null) {
    return `found ${counts.tasksCount} ${tasksLabel}`;
  }
  if (counts.matchesCount != null) {
    if (toolName === "resolve_node_reference") {
      return `found ${counts.matchesCount} matching roadmap items`;
    }
    if (toolName === "get_features_by_epic") {
      return `found ${counts.matchesCount} features`;
    }
    if (toolName === "get_blocked_items") {
      return `found ${counts.matchesCount} blocked items`;
    }
    return `found ${counts.matchesCount} matches`;
  }
  if (counts.childrenCount != null) {
    return `found ${counts.childrenCount} related items`;
  }
  if (counts.epicsCount != null) {
    return `found ${counts.epicsCount} epics`;
  }
  return null;
};

const buildToolResultContextSentence = (
  toolName: SupportedTraceToolName,
  ctx: ToolMessageContext,
  descriptorResultSummary: string,
): string => {
  const scope = getToolScopePhrase(toolName, ctx.toolArgs);
  const target = getToolTargetPhrase(toolName, ctx.toolArgs);
  const countPhrase = getCountPhraseForTool(toolName, getResultCounts(ctx));
  const titleList = getResultTitleList(ctx);
  const titleEvidence = titleList
    ? " and listed the matching titles below"
    : "";

  const actionParts: string[] = [];
  if (target) {
    actionParts.push(`prepared updates to ${target}`);
  }
  if (countPhrase) {
    actionParts.push(countPhrase);
  }

  if (scope && actionParts.length > 0) {
    return toSentence(
      `I checked ${scope} and ${listWithAnd(actionParts)}${titleEvidence}`,
    );
  }
  if (scope) {
    return toSentence(`I checked ${scope} and confirmed the outcome${titleEvidence}`);
  }
  if (actionParts.length > 0) {
    return toSentence(`I ${listWithAnd(actionParts)}${titleEvidence}`);
  }

  return (
    sanitizeFallbackContext(descriptorResultSummary) ||
    "I confirmed this step and prepared the next action."
  );
};

const readLimitPhrase = (toolArgs: Record<string, unknown> | null): string => {
  const limit = toNumberValue(toolArgs?.limit);
  if (limit == null) return "";
  return ` (up to ${limit} items)`;
};

const readStatusPhrase = (
  toolArgs: Record<string, unknown> | null,
  key = "status",
): string => {
  const status = humanizeEnum(toStringValue(toolArgs?.[key]));
  if (!status || status === "all") return "";
  return ` with status ${status}`;
};

const readParentScopePhrase = (
  toolArgs: Record<string, unknown> | null,
): string => {
  const parentType =
    humanizeEnum(toStringValue(toolArgs?.parent_type)) ?? "parent";
  const parentId = safeSelection("parent", toolArgs?.parent_id);
  if (!parentId) return "";
  return ` under ${parentId.replace("parent", parentType)}`;
};

const describeBulkFilterScope = (
  filters: Record<string, unknown> | null,
): string => {
  if (!filters) return "across the roadmap";
  const parts: string[] = [];

  const parentType =
    humanizeEnum(toStringValue(filters.parent_type)) ?? "parent";
  const parentId = safeSelection("parent", filters.parent_id);
  if (parentId) {
    parts.push(`under ${parentId.replace("parent", parentType)}`);
  }

  const assignee = toStringValue(filters.assignee_id);
  if (assignee) {
    parts.push("assigned to the selected teammate");
  }

  const status = humanizeEnum(toStringValue(filters.status));
  if (status && status !== "all") {
    parts.push(`with status ${status}`);
  }

  const keyword = quote(toStringValue(filters.keyword));
  if (keyword) {
    parts.push(`matching ${keyword}`);
  }

  const includeCompleted = toBooleanValue(filters.include_completed);
  if (includeCompleted === true) {
    parts.push("including completed tasks");
  } else if (includeCompleted === false) {
    parts.push("excluding completed tasks");
  }

  if (parts.length === 0) return "across the roadmap";
  return listWithAnd(parts);
};

const describeBulkUpdateTarget = (
  update: Record<string, unknown> | null,
): string => {
  if (!update) return "prepare the requested task updates";
  const updates: string[] = [];
  const status = humanizeEnum(toStringValue(update.status));
  if (status) {
    updates.push(`set status to ${status}`);
  }
  const priority = humanizeEnum(toStringValue(update.priority));
  if (priority) {
    updates.push(`set priority to ${priority}`);
  }
  if (update.assignee_id === null) {
    updates.push("clear assignee");
  } else if (toStringValue(update.assignee_id)) {
    updates.push("assign to the selected teammate");
  }
  if (updates.length === 0) return "prepare the requested task updates";
  return updates.join(", ");
};

const actionFromStatus = (
  status: string | null,
  fallback = "update",
): string => {
  if (!status) return fallback;
  switch (status) {
    case "done":
      return "mark as done";
    case "blocked":
      return "mark as blocked";
    case "in progress":
      return "mark as in progress";
    case "in review":
      return "mark as in review";
    case "todo":
      return "mark as to do";
    default:
      return `set status to ${status}`;
  }
};

const outcomeTitle = (
  ctx: ToolMessageContext,
  found: string,
  notFound: string,
  ...keys: string[]
): string => {
  for (const key of keys) {
    const count = countFromContext(ctx, key);
    if (count != null) return count > 0 ? found : notFound;
  }
  return found;
};

const descriptor = (
  requestedTitle: string,
  completedTitle: string,
  buildRequestedSummary: (ctx: ToolMessageContext) => string,
  buildResultSummary: (ctx: ToolMessageContext) => string,
  buildCompletedTitle?: (ctx: ToolMessageContext) => string,
): ToolMessageDescriptor => ({
  requestedTitle,
  completedTitle,
  buildCompletedTitle,
  buildRequestedSummary,
  buildResultSummary,
});

const normalizeToolName = (toolName: string | null): string | null => {
  if (!toolName) return null;
  const normalized = toolName.trim().toLowerCase();
  return normalized || null;
};

const extractToolNameFromText = (text: string): string | null => {
  const lowered = text.toLowerCase();
  for (const toolName of SUPPORTED_TRACE_TOOL_NAMES) {
    if (lowered.includes(toolName)) return toolName;
  }
  return null;
};

const maybeWarnUnknownTool = (toolName: string | null): void => {
  if (!toolName || SUPPORTED_TRACE_TOOL_SET.has(toolName)) return;
  if (warnedUnknownTools.has(toolName)) return;
  warnedUnknownTools.add(toolName);
  console.warn("[RoadmapAiToolMessaging] missing_tool_mapping", { tool_name: toolName });
};

const TOOL_MESSAGE_CATALOG: Record<SupportedTraceToolName, ToolMessageDescriptor> = {
  get_roadmap_summary: descriptor(
    "Loading roadmap summary",
    "Loaded roadmap summary",
    () => "I am loading your roadmap summary to understand the current state.",
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { epics: "Reviewed {count} epics", tasks: "Reviewed {count} tasks" },
        "I loaded the roadmap summary and can use it for planning.",
      ),
  ),
  get_roadmap_overview: descriptor(
    "Reviewing roadmap overview",
    "Reviewed roadmap overview",
    (ctx) => {
      const includeEpics = toBooleanValue(ctx.toolArgs?.include_epics);
      const epicsPart =
        includeEpics === false
          ? " without epic-level breakdown"
          : " with epic-level progress";
      return `I am reviewing a high-level roadmap overview${epicsPart}${readLimitPhrase(ctx.toolArgs)}.`;
    },
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { epics: "Reviewed {count} epics", tasks: "Reviewed {count} tasks" },
        "I reviewed the roadmap overview and captured high-level progress.",
      ),
  ),
  resolve_node_reference: descriptor(
    "Finding the right roadmap item",
    "Found the right roadmap item",
    (ctx) => {
      const label = quote(toStringValue(ctx.toolArgs?.label));
      const nodeType = humanizeEnum(toStringValue(ctx.toolArgs?.node_type));
      const nodeTypePhrase = nodeType ? ` as a ${nodeType}` : "";
      return `I am looking up ${label ?? "the referenced item"}${nodeTypePhrase} so I can make changes to the right place.`;
    },
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { matches: "Found {count} matches", children: "Found {count} related items" },
        "I found the right item in your roadmap.",
      ),
    (ctx) => outcomeTitle(ctx, "Found the right roadmap item", "No matching roadmap item found", "matches_count"),
  ),
  search_nodes: descriptor(
    "Searching roadmap items",
    "Searched roadmap items",
    (ctx) =>
      `I am searching roadmap items for ${quote(toStringValue(ctx.toolArgs?.query)) ?? "your query"}${readLimitPhrase(ctx.toolArgs)}.`,
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { matches: "Found {count} matches" },
        "I finished searching roadmap items and collected the best matches.",
      ),
    (ctx) => outcomeTitle(ctx, "Searched roadmap items", "No matching roadmap items found", "matches_count"),
  ),
  search_tasks: descriptor(
    "Searching tasks",
    "Searched tasks",
    (ctx) =>
      `I am searching tasks for ${quote(toStringValue(ctx.toolArgs?.query)) ?? "your query"}${readLimitPhrase(ctx.toolArgs)}.`,
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { tasks: "Found {count} tasks", matches: "Found {count} matches" },
        "I finished searching tasks and identified relevant results.",
      ),
    (ctx) => outcomeTitle(ctx, "Searched tasks", "No matching tasks found", "tasks_count", "matches_count"),
  ),
  get_node_details: descriptor(
    "Loading item details",
    "Loaded item details",
    () =>
      "I am loading detailed information for the selected roadmap item.",
    () => "I loaded the item details and have what I need to continue.",
  ),
  get_children_from_resolution: descriptor(
    "Loading related items",
    "Loaded related items",
    () =>
      "I am loading the items nested under this roadmap entry.",
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { children: "Found {count} related items" },
        "I loaded related items from the selected reference.",
      ),
    (ctx) => outcomeTitle(ctx, "Loaded related items", "No related items found", "children_count"),
  ),
  get_features_by_epic: descriptor(
    "Listing epic features",
    "Listed epic features",
    (ctx) =>
      `I am listing features under the selected epic${readStatusPhrase(ctx.toolArgs)}${readLimitPhrase(ctx.toolArgs)}.`,
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { matches: "Found {count} features", children: "Found {count} related items" },
        "I listed features for the selected epic.",
      ),
    (ctx) => outcomeTitle(ctx, "Listed epic features", "No features found under this epic", "matches_count", "children_count"),
  ),
  get_feature_details: descriptor(
    "Loading feature details",
    "Loaded feature details",
    () => "I am loading detailed information for the selected feature.",
    () => "I loaded the feature details and have what I need to continue.",
  ),
  get_epics_by_roadmap: descriptor(
    "Listing roadmap epics",
    "Listed roadmap epics",
    (ctx) => {
      const priority = humanizeEnum(toStringValue(ctx.toolArgs?.priority));
      const priorityPhrase =
        priority && priority !== "all" ? ` and priority ${priority}` : "";
      return `I am listing epics${readStatusPhrase(ctx.toolArgs)}${priorityPhrase}${readLimitPhrase(ctx.toolArgs)}.`;
    },
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { epics: "Found {count} epics", matches: "Found {count} matches" },
        "I listed your roadmap epics and their current progress.",
      ),
    (ctx) => outcomeTitle(ctx, "Listed roadmap epics", "No epics found", "epics_count", "matches_count"),
  ),
  get_epic_progress: descriptor(
    "Computing epic progress",
    "Computed epic progress",
    () =>
      "I am calculating progress for the selected epic based on feature and task completion.",
    () => "I calculated progress for the selected epic.",
  ),
  get_tasks_assigned_to_me: descriptor(
    "Reviewing your assigned tasks",
    "Reviewed your assigned tasks",
    (ctx) =>
      `I am listing tasks assigned to you${readStatusPhrase(ctx.toolArgs)}${readLimitPhrase(ctx.toolArgs)}.`,
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { tasks: "Reviewed {count} assigned tasks" },
        "I reviewed your assigned tasks and confirmed the set.",
      ),
    (ctx) => outcomeTitle(ctx, "Reviewed your assigned tasks", "No assigned tasks found", "tasks_count"),
  ),
  get_tasks_by_status: descriptor(
    "Listing tasks by status",
    "Listed tasks by status",
    (ctx) =>
      `I am listing tasks${readStatusPhrase(ctx.toolArgs)}${readLimitPhrase(ctx.toolArgs)}.`,
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { tasks: "Found {count} tasks" },
        "I listed tasks by status and prepared the result set.",
      ),
    (ctx) => outcomeTitle(ctx, "Listed tasks by status", "No tasks found with that status", "tasks_count"),
  ),
  get_tasks_by_parent: descriptor(
    "Listing tasks under a parent item",
    "Listed tasks under a parent item",
    (ctx) => {
      const includeCompleted = toBooleanValue(ctx.toolArgs?.include_completed);
      const completionPhrase =
        includeCompleted === true
          ? " including completed tasks"
          : includeCompleted === false
            ? " excluding completed tasks"
            : "";
      return `I am listing tasks${readParentScopePhrase(ctx.toolArgs)}${readStatusPhrase(ctx.toolArgs)}${completionPhrase}${readLimitPhrase(ctx.toolArgs)}.`;
    },
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { tasks: "Found {count} tasks" },
        "I listed tasks under the selected parent item.",
      ),
    (ctx) => outcomeTitle(ctx, "Listed tasks under a parent item", "No tasks found under this item", "tasks_count"),
  ),
  get_overdue_tasks: descriptor(
    "Listing overdue tasks",
    "Listed overdue tasks",
    (ctx) => {
      const date = toStringValue(ctx.toolArgs?.reference_date);
      const datePhrase = date ? ` against ${quote(date)}` : "";
      return `I am listing overdue tasks${datePhrase}${readLimitPhrase(ctx.toolArgs)}.`;
    },
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { tasks: "Found {count} overdue tasks" },
        "I listed overdue tasks and prepared them for action.",
      ),
    (ctx) => outcomeTitle(ctx, "Listed overdue tasks", "No overdue tasks found", "tasks_count"),
  ),
  get_blocked_items: descriptor(
    "Listing blocked items",
    "Listed blocked items",
    (ctx) => {
      const includeEpics = toBooleanValue(ctx.toolArgs?.include_epics);
      const includeFeatures = toBooleanValue(ctx.toolArgs?.include_features);
      const includeTasks = toBooleanValue(ctx.toolArgs?.include_tasks);
      const includedKinds: string[] = [];
      if (includeEpics !== false) includedKinds.push("epics");
      if (includeFeatures !== false) includedKinds.push("features");
      if (includeTasks !== false) includedKinds.push("tasks");
      const kindsPhrase =
        includedKinds.length > 0 ? ` across ${listWithAnd(includedKinds)}` : "";
      return `I am listing blocked items${kindsPhrase}${readLimitPhrase(ctx.toolArgs)}.`;
    },
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { matches: "Found {count} blocked items", tasks: "Found {count} blocked tasks" },
        "I listed blocked items and captured blockers for follow-up.",
      ),
    (ctx) => outcomeTitle(ctx, "Listed blocked items", "No blocked items found", "matches_count", "tasks_count"),
  ),
  create_epic: descriptor(
    "Preparing a new epic",
    "Prepared a new epic",
    (ctx) =>
      `I am preparing a new epic${toStringValue(ctx.toolArgs?.title) ? ` titled ${quote(toStringValue(ctx.toolArgs?.title))}` : ""}.`,
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} change operations" },
        "I prepared the new epic operation.",
      ),
  ),
  create_feature: descriptor(
    "Preparing a new feature",
    "Prepared a new feature",
    (ctx) =>
      `I am preparing a new feature${toStringValue(ctx.toolArgs?.title) ? ` titled ${quote(toStringValue(ctx.toolArgs?.title))}` : ""} under the selected epic.`,
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} change operations" },
        "I prepared the new feature operation.",
      ),
  ),
  create_task: descriptor(
    "Preparing a new task",
    "Prepared a new task",
    (ctx) =>
      `I am preparing a new task${toStringValue(ctx.toolArgs?.title) ? ` titled ${quote(toStringValue(ctx.toolArgs?.title))}` : ""} under the selected feature.`,
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} change operations" },
        "I prepared the new task operation.",
      ),
  ),
  update_task_status: descriptor(
    "Updating task status",
    "Updated task status",
    (ctx) => {
      const status = humanizeEnum(toStringValue(ctx.toolArgs?.status));
      return `I am updating the selected task to ${actionFromStatus(status, "the requested status")}.`;
    },
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} status changes" },
        "I prepared the task status update.",
      ),
  ),
  update_task_priority: descriptor(
    "Updating task priority",
    "Updated task priority",
    (ctx) =>
      `I am setting the selected task priority to ${humanizeEnum(toStringValue(ctx.toolArgs?.priority)) ?? "the requested value"}.`,
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} priority updates" },
        "I prepared the task priority update.",
      ),
  ),
  update_task_assignee: descriptor(
    "Updating task assignee",
    "Updated task assignee",
    (ctx) => {
      if (ctx.toolArgs?.assignee_id === null) {
        return "I am removing the assignee from the selected task.";
      }
      return "I am assigning the selected task to the selected teammate.";
    },
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} assignee updates" },
        "I prepared the task assignee update.",
      ),
  ),
  update_feature_status: descriptor(
    "Updating feature status",
    "Updated feature status",
    (ctx) =>
      `I am updating the selected feature to ${actionFromStatus(humanizeEnum(toStringValue(ctx.toolArgs?.status)), "the requested status")}.`,
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} status changes" },
        "I prepared the feature status update.",
      ),
  ),
  update_epic_status: descriptor(
    "Updating epic status",
    "Updated epic status",
    (ctx) =>
      `I am updating the selected epic to ${actionFromStatus(humanizeEnum(toStringValue(ctx.toolArgs?.status)), "the requested status")}.`,
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} status changes" },
        "I prepared the epic status update.",
      ),
  ),
  update_titles: descriptor(
    "Renaming roadmap item",
    "Renamed roadmap item",
    (ctx) => {
      const nodeType = humanizeEnum(toStringValue(ctx.toolArgs?.node_type));
      const title = quote(toStringValue(ctx.toolArgs?.title));
      return `I am renaming the selected ${nodeType ?? "item"}${title ? ` to ${title}` : ""}.`;
    },
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} rename changes" },
        "I prepared the rename change.",
      ),
  ),
  delete_task: descriptor(
    "Preparing task deletion",
    "Prepared task deletion",
    () => "I am preparing deletion of the selected task.",
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} deletion changes" },
        "I prepared the task deletion change.",
      ),
  ),
  delete_feature: descriptor(
    "Preparing feature deletion",
    "Prepared feature deletion",
    () => "I am preparing deletion of the selected feature.",
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} deletion changes" },
        "I prepared the feature deletion change.",
      ),
  ),
  delete_epic: descriptor(
    "Preparing epic deletion",
    "Prepared epic deletion",
    () => "I am preparing deletion of the selected epic.",
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} deletion changes" },
        "I prepared the epic deletion change.",
      ),
  ),
  move_task_to_feature: descriptor(
    "Moving task to a feature",
    "Moved task to a feature",
    () =>
      "I am moving the selected task under the selected feature.",
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} move changes" },
        "I prepared the task move change.",
      ),
  ),
  move_feature_to_epic: descriptor(
    "Moving feature to an epic",
    "Moved feature to an epic",
    () =>
      "I am moving the selected feature under the selected epic.",
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} move changes" },
        "I prepared the feature move change.",
      ),
  ),
  reorder_tasks: descriptor(
    "Reordering tasks",
    "Reordered tasks",
    (ctx) =>
      `I am reordering ${toArrayValue(ctx.toolArgs?.task_ids).length || "the selected"} tasks within the selected feature.`,
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} ordering changes" },
        "I prepared the task reorder changes.",
      ),
  ),
  reorder_features: descriptor(
    "Reordering features",
    "Reordered features",
    (ctx) =>
      `I am reordering ${toArrayValue(ctx.toolArgs?.feature_ids).length || "the selected"} features within the selected epic.`,
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} ordering changes" },
        "I prepared the feature reorder changes.",
      ),
  ),
  reorder_epics: descriptor(
    "Reordering epics",
    "Reordered epics",
    (ctx) =>
      `I am reordering ${toArrayValue(ctx.toolArgs?.epic_ids).length || "the selected"} epics in the roadmap.`,
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} ordering changes" },
        "I prepared the epic reorder changes.",
      ),
  ),
  bulk_update_task_status: descriptor(
    "Updating task statuses in bulk",
    "Updated task statuses in bulk",
    (ctx) => {
      const status = humanizeEnum(toStringValue(ctx.toolArgs?.status));
      const total = toArrayValue(ctx.toolArgs?.task_ids).length;
      const taskScope = total > 0 ? `${total} selected tasks` : "selected tasks";
      return `I am applying status updates to ${taskScope} to ${actionFromStatus(status, "the requested status")}.`;
    },
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} status changes", tasks: "Processed {count} tasks" },
        "I prepared bulk task status updates.",
      ),
  ),
  bulk_update_tasks_by_parent: descriptor(
    "Updating parent tasks in bulk",
    "Updated parent tasks in bulk",
    (ctx) => {
      const parentType =
        humanizeEnum(toStringValue(ctx.toolArgs?.parent_type)) ?? "parent item";
      const status = humanizeEnum(toStringValue(ctx.toolArgs?.status));
      const includeCompleted = toBooleanValue(ctx.toolArgs?.include_completed);
      const completionPhrase =
        includeCompleted === true
          ? ", including completed tasks"
          : includeCompleted === false
            ? ", excluding completed tasks"
            : "";
      return `I am marking tasks under the selected ${parentType} to ${actionFromStatus(status, "the requested status")}${completionPhrase}.`;
    },
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} status changes", tasks: "Processed {count} tasks" },
        "I prepared bulk parent-scope task updates.",
      ),
  ),
  bulk_update_tasks_by_filter: descriptor(
    "Updating filtered tasks",
    "Updated filtered tasks",
    (ctx) => {
      const filters = toRecord(ctx.toolArgs?.filters);
      const update = toRecord(ctx.toolArgs?.update);
      const filterDescription = describeBulkFilterScope(filters);
      const targetDescription = describeBulkUpdateTarget(update);
      return `I am selecting tasks ${filterDescription} to generate changes that ${targetDescription}.`;
    },
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} change operations", tasks: "Processed {count} tasks" },
        "I prepared updates for the filtered task set.",
      ),
  ),
  bulk_assign_tasks: descriptor(
    "Assigning tasks in bulk",
    "Assigned tasks in bulk",
    (ctx) => {
      const total = toArrayValue(ctx.toolArgs?.task_ids).length;
      const taskScope = total > 0 ? `${total} selected tasks` : "selected tasks";
      if (ctx.toolArgs?.assignee_id === null) {
        return `I am unassigning ${taskScope}.`;
      }
      return `I am assigning ${taskScope} to the selected teammate.`;
    },
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} assignment changes", tasks: "Processed {count} tasks" },
        "I prepared bulk assignee updates.",
      ),
  ),
  bulk_delete_tasks: descriptor(
    "Deleting tasks in bulk",
    "Deleted tasks in bulk",
    (ctx) => {
      const total = toArrayValue(ctx.toolArgs?.task_ids).length;
      const taskScope = total > 0 ? `${total} selected tasks` : "selected tasks";
      return `I am preparing deletion for ${taskScope}.`;
    },
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} deletion changes", tasks: "Processed {count} tasks" },
        "I prepared bulk task deletions.",
      ),
  ),
  bulk_move_tasks_to_feature: descriptor(
    "Moving tasks to a feature in bulk",
    "Moved tasks to a feature in bulk",
    (ctx) => {
      const total = toArrayValue(ctx.toolArgs?.task_ids).length;
      const taskScope = total > 0 ? `${total} selected tasks` : "selected tasks";
      return `I am moving ${taskScope} to the selected feature.`;
    },
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} move changes", tasks: "Processed {count} tasks" },
        "I prepared bulk task move changes.",
      ),
  ),
  bulk_update_feature_status: descriptor(
    "Updating feature statuses in bulk",
    "Updated feature statuses in bulk",
    (ctx) => {
      const total = toArrayValue(ctx.toolArgs?.feature_ids).length;
      const status = humanizeEnum(toStringValue(ctx.toolArgs?.status));
      const scope = total > 0 ? `${total} selected features` : "selected features";
      return `I am updating ${scope} to ${actionFromStatus(status, "the requested status")}.`;
    },
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} status changes", matches: "Processed {count} features" },
        "I prepared bulk feature status updates.",
      ),
  ),
  bulk_update_epic_status: descriptor(
    "Updating epic statuses in bulk",
    "Updated epic statuses in bulk",
    (ctx) => {
      const total = toArrayValue(ctx.toolArgs?.epic_ids).length;
      const status = humanizeEnum(toStringValue(ctx.toolArgs?.status));
      const scope = total > 0 ? `${total} selected epics` : "selected epics";
      return `I am updating ${scope} to ${actionFromStatus(status, "the requested status")}.`;
    },
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} status changes", matches: "Processed {count} epics" },
        "I prepared bulk epic status updates.",
      ),
  ),
  plan_roadmap_operations: descriptor(
    "Preparing your roadmap changes",
    "Prepared your roadmap changes",
    () =>
      "I am putting together all the roadmap changes you requested.",
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { operations: "Prepared {count} roadmap changes" },
        "I finalized your roadmap changes and they are ready to apply.",
      ),
    (ctx) => outcomeTitle(ctx, "Prepared your roadmap changes", "No roadmap changes needed", "operations_count"),
  ),
  get_children: descriptor(
    "Loading child items",
    "Loaded child items",
    () =>
      "I am loading the items nested under the selected roadmap entry.",
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { children: "Found {count} child items", tasks: "Found {count} tasks" },
        "I loaded child items for the selected parent.",
      ),
    (ctx) => outcomeTitle(ctx, "Loaded child items", "No child items found", "children_count", "tasks_count"),
  ),
  get_tasks_by_feature: descriptor(
    "Listing tasks by feature",
    "Listed tasks by feature",
    (ctx) =>
      `I am listing tasks under the selected feature${readStatusPhrase(ctx.toolArgs)}${readLimitPhrase(ctx.toolArgs)}.`,
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { tasks: "Found {count} tasks" },
        "I listed tasks under the selected feature.",
      ),
    (ctx) => outcomeTitle(ctx, "Listed tasks by feature", "No tasks found under this feature", "tasks_count"),
  ),
  get_tasks_by_epic: descriptor(
    "Listing tasks by epic",
    "Listed tasks by epic",
    (ctx) =>
      `I am listing tasks under the selected epic${readStatusPhrase(ctx.toolArgs)}${readLimitPhrase(ctx.toolArgs)}.`,
    (ctx) =>
      resultSummaryWithDefault(
        ctx,
        { tasks: "Found {count} tasks" },
        "I listed tasks under the selected epic.",
      ),
    (ctx) => outcomeTitle(ctx, "Listed tasks by epic", "No tasks found under this epic", "tasks_count"),
  ),
};

export const extractTraceToolName = (step: {
  title: string;
  summary: string;
  details?: Record<string, unknown>;
}): string | null => {
  const detailToolName = normalizeToolName(toStringValue(step.details?.tool_name));
  if (detailToolName) return detailToolName;
  return (
    extractToolNameFromText(step.title) ||
    extractToolNameFromText(step.summary)
  );
};

const toToolMessageContext = (step: {
  summary: string;
  status: RoadmapAiActivityStepStatus;
  details?: Record<string, unknown>;
}): ToolMessageContext => ({
  toolArgs: toRecord(step.details?.tool_args),
  resultSummary: toRecord(step.details?.result_summary),
  summaryText: step.summary,
  status: step.status,
});

export const buildFriendlyMinimalToolLabel = (
  toolName: string | null,
): FriendlyMinimalToolLabel => {
  const normalized = normalizeToolName(toolName);
  if (!normalized) {
    return {
      requested: FALLBACK_REQUESTED_TITLE,
      completed: FALLBACK_COMPLETED_TITLE,
    };
  }
  const toolDescriptor = TOOL_MESSAGE_CATALOG[
    normalized as SupportedTraceToolName
  ];
  if (!toolDescriptor) {
    maybeWarnUnknownTool(normalized);
    return {
      requested: FALLBACK_REQUESTED_TITLE,
      completed: FALLBACK_COMPLETED_TITLE,
    };
  }
  return {
    requested: toolDescriptor.requestedTitle,
    completed: toolDescriptor.completedTitle,
  };
};

export const buildCuratedToolRequestedMessage = (
  toolName: string | null,
  step: {
    summary: string;
    status: RoadmapAiActivityStepStatus;
    details?: Record<string, unknown>;
  },
): ToolTraceMessage => {
  const normalized = normalizeToolName(toolName);
  if (!normalized) {
    return {
      title: FALLBACK_REQUESTED_TITLE,
      summary: FALLBACK_REQUESTED_SUMMARY,
      usedFallback: true,
    };
  }
  const toolDescriptor = TOOL_MESSAGE_CATALOG[
    normalized as SupportedTraceToolName
  ];
  if (!toolDescriptor) {
    maybeWarnUnknownTool(normalized);
    return {
      title: FALLBACK_REQUESTED_TITLE,
      summary: FALLBACK_REQUESTED_SUMMARY,
      usedFallback: true,
    };
  }
  return {
    title: toolDescriptor.requestedTitle,
    summary: toolDescriptor.buildRequestedSummary(toToolMessageContext(step)),
    usedFallback: false,
  };
};

export const buildCuratedToolResultMessage = (
  toolName: string | null,
  step: {
    summary: string;
    status: RoadmapAiActivityStepStatus;
    details?: Record<string, unknown>;
  },
): ToolTraceMessage => {
  const normalized = normalizeToolName(toolName);
  if (!normalized) {
    return {
      title: FALLBACK_COMPLETED_TITLE,
      summary:
        "I completed this step. I confirmed the result and prepared the next action.",
      usedFallback: true,
    };
  }
  const toolDescriptor = TOOL_MESSAGE_CATALOG[
    normalized as SupportedTraceToolName
  ];
  if (!toolDescriptor) {
    maybeWarnUnknownTool(normalized);
    return {
      title: FALLBACK_COMPLETED_TITLE,
      summary:
        "I completed this step. I confirmed the result and prepared the next action.",
      usedFallback: true,
    };
  }
  const ctx = toToolMessageContext(step);
  const descriptorSummary = toolDescriptor.buildResultSummary(ctx);
  const titleList = getResultTitleList(ctx);
  const resolvedTitle = toolDescriptor.buildCompletedTitle
    ? toolDescriptor.buildCompletedTitle(ctx)
    : toolDescriptor.completedTitle;
  return {
    title: resolvedTitle,
    summary: `${toOutcomeSentenceFromTitle(resolvedTitle)} ${buildToolResultContextSentence(
      normalized as SupportedTraceToolName,
      ctx,
      descriptorSummary,
    )}`,
    usedFallback: false,
    titleList,
  };
};

export const isSupportedTraceToolName = (toolName: string): boolean => {
  const normalized = toolName.trim().toLowerCase();
  return SUPPORTED_TRACE_TOOL_SET.has(normalized);
};

export const containsUuidLikeText = (value: string): boolean =>
  UUID_LIKE_PATTERN.test(value);
