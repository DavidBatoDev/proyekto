import {
  AlertTriangle,
  CheckCircle2,
  Circle,
} from "lucide-react";
import type { ProjectMember } from "@/services/project.service";
import { cleanHTML } from "@/components/common/RichTextEditor/utils/formatting";
import type {
  Roadmap,
  RoadmapEpic,
  RoadmapFeature,
  RoadmapMilestone,
  RoadmapTask,
} from "@/types/roadmap";
import type { OverviewTimelineItem } from "./types";
import { deriveFeatureStatus } from "@/utils/featureStatus";

export const MAX_OVERVIEW_MILESTONES = 6;

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export const toItems = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const candidate =
          (item as Record<string, unknown>).title ??
          (item as Record<string, unknown>).name ??
          (item as Record<string, unknown>).text;
        if (typeof candidate === "string") return candidate;
      }
      return null;
    })
    .filter((value): value is string => Boolean(value));
};

export const toRichHtml = (raw: unknown): string => {
  if (raw == null) return "";

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return "";

    if (/\<[a-z][\s\S]*\>/i.test(trimmed)) {
      return cleanHTML(trimmed);
    }

    return `<p>${escapeHtml(trimmed).replace(/\n/g, "<br>")}</p>`;
  }

  if (Array.isArray(raw)) {
    const items = toItems(raw);
    if (items.length === 0) return "";
    return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }

  if (typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    if (typeof record.html === "string") {
      return cleanHTML(record.html);
    }
    if (typeof record.text === "string") {
      const text = record.text.trim();
      return text ? `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>` : "";
    }
  }

  return "";
};

export const isPastDate = (value?: string) => {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return parsed < now;
};

export const mapTaskStatus = (task: RoadmapTask): RoadmapMilestone["status"] => {
  if (task.status === "done") return "completed";
  if (task.status === "blocked") return "at_risk";
  if (task.status === "in_progress" || task.status === "in_review") {
    return "in_progress";
  }
  if (isPastDate(task.due_date)) return "missed";
  return "not_started";
};

export const mapFeatureStatus = (
  feature: RoadmapFeature,
): RoadmapMilestone["status"] => {
  const derived = deriveFeatureStatus(feature.tasks);
  if (derived === "completed") return "completed";
  if (derived === "blocked") return "at_risk";
  if (derived === "in_progress" || derived === "in_review") {
    return "in_progress";
  }
  if (isPastDate(feature.end_date)) return "missed";
  return "not_started";
};

export const mapEpicStatus = (epic: RoadmapEpic): RoadmapMilestone["status"] => {
  if (epic.status === "completed") return "completed";
  if (epic.status === "on_hold") return "at_risk";
  if (epic.status === "in_progress" || epic.status === "in_review") {
    return "in_progress";
  }
  if (isPastDate(epic.end_date)) return "missed";
  return "not_started";
};

export const deriveTimelineItems = (
  roadmap: Roadmap | null,
): OverviewTimelineItem[] => {
  if (!roadmap?.epics?.length) return [];

  const items: OverviewTimelineItem[] = [];

  for (const epic of roadmap.epics) {
    const epicDate = epic.end_date ?? epic.start_date;
    if (epicDate) {
      items.push({
        id: `epic-${epic.id}`,
        title: epic.title,
        target_date: epicDate,
        status: mapEpicStatus(epic),
        kind: "epic",
      });
    }

    for (const feature of epic.features ?? []) {
      const featureDate = feature.end_date ?? feature.start_date;
      if (featureDate) {
        items.push({
          id: `feature-${feature.id}`,
          title: feature.title,
          target_date: featureDate,
          status: mapFeatureStatus(feature),
          kind: "feature",
        });
      }

      for (const task of feature.tasks ?? []) {
        if (!task.due_date) continue;
        items.push({
          id: `task-${task.id}`,
          title: task.title,
          target_date: task.due_date,
          status: mapTaskStatus(task),
          kind: "task",
        });
      }
    }
  }

  return items.sort(
    (a, b) =>
      new Date(a.target_date).getTime() - new Date(b.target_date).getTime(),
  );
};

export const milestoneState = (status: RoadmapMilestone["status"]) => {
  switch (status) {
    case "completed":
      return {
        dot: "bg-blue-500 border-blue-500 text-white",
        icon: CheckCircle2,
        title: "text-blue-700",
      };
    case "in_progress":
      return {
        dot: "bg-blue-100 border-blue-400 text-blue-600",
        icon: Circle,
        title: "text-blue-700",
      };
    case "at_risk":
      return {
        dot: "bg-amber-100 border-amber-400 text-amber-600",
        icon: AlertTriangle,
        title: "text-amber-700",
      };
    case "missed":
      return {
        dot: "bg-red-100 border-red-400 text-red-600",
        icon: AlertTriangle,
        title: "text-red-700",
      };
    case "not_started":
    default:
      return {
        dot: "bg-gray-100 border-gray-300 text-gray-400",
        icon: Circle,
        title: "text-gray-700",
      };
  }
};

export const nameFromMember = (member: ProjectMember) => {
  return (
    member.user?.display_name ||
    [member.user?.first_name, member.user?.last_name]
      .filter(Boolean)
      .join(" ") ||
    member.user?.email ||
    member.role
  );
};
