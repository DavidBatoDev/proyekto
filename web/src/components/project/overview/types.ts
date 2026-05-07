import type { RoadmapMilestone } from "@/types/roadmap";

export type ProjectBriefField = {
  key: string;
  value: string;
  position: number;
};

export type ProjectBrief = {
  project_summary?: string | null;
  custom_fields: ProjectBriefField[];
};

export type OverviewTimelineItem = {
  id: string;
  title: string;
  target_date: string;
  status: RoadmapMilestone["status"];
  kind: "epic" | "feature" | "task";
};
