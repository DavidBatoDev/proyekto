import { supabase } from "@/lib/supabase";
import {
  projectService,
  type Project,
  type ProjectMember,
  type ProjectPermissions,
  type ProjectResourcesPayload,
} from "@/services/project.service";
import { roadmapService, type FullRoadmap } from "@/services/roadmap.service";
import type { Roadmap } from "@/types/roadmap";

// New flat brief shape (post-2026_05_07_*_summary_and_custom_fields):
// a single rich-text summary plus a flexible JSONB array of {key, value,
// position} rows the user manages on /overview. Kept here in addition
// to the overview/types.ts copy because the queries layer can't import
// from the components tree without a cycle.
export type ProjectBriefField = {
  key: string;
  value: string;
  position: number;
};

export type ProjectBrief = {
  project_summary?: string | null;
  custom_fields: ProjectBriefField[];
};

export type ProjectBriefResult = {
  brief: ProjectBrief | null;
};

export const projectKeys = {
  all: ["project"] as const,
  detail: (projectId: string) => ["project", "detail", projectId] as const,
  members: (projectId: string) => ["project", "members", projectId] as const,
  invites: (projectId: string) => ["project", "invites", projectId] as const,
  rolePermissions: (projectId: string, role: string) =>
    ["project", "role-permissions", projectId, role] as const,
  myPermissions: (projectId: string) =>
    ["project", "my-permissions", projectId] as const,
  resources: (projectId: string) => ["project", "resources", projectId] as const,
  linkedRoadmap: (projectId: string) =>
    ["project", "linked-roadmap", projectId] as const,
  brief: (projectId: string) => ["project", "brief", projectId] as const,
  roadmapFull: (roadmapId: string) =>
    ["project", "roadmap-full", roadmapId] as const,
};

export const briefSelect = "project_summary, custom_fields";

function normalizeCustomFields(raw: unknown): ProjectBriefField[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row, idx) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const key = typeof r.key === "string" ? r.key : "";
      const value = typeof r.value === "string" ? r.value : "";
      const position =
        typeof r.position === "number" && Number.isFinite(r.position)
          ? r.position
          : idx;
      return { key, value, position };
    })
    .filter((row): row is ProjectBriefField => row !== null)
    .sort((a, b) => a.position - b.position);
}

export async function fetchProject(projectId: string): Promise<Project> {
  return projectService.get(projectId);
}

export async function fetchProjectMembers(projectId: string): Promise<ProjectMember[]> {
  return projectService.getMembers(projectId);
}

export async function fetchMyProjectPermissions(
  projectId: string,
): Promise<ProjectPermissions> {
  return projectService.getMyPermissions(projectId);
}

export async function fetchProjectResources(
  projectId: string,
): Promise<ProjectResourcesPayload> {
  return projectService.getResources(projectId);
}

export async function fetchLinkedRoadmap(projectId: string): Promise<Roadmap | null> {
  return roadmapService.getByProjectId(projectId);
}

export async function fetchProjectBrief(projectId: string): Promise<ProjectBriefResult> {
  const { data, error } = await supabase
    .from("project_briefs")
    .select(briefSelect)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { brief: null };

  const row = data as { project_summary?: string | null; custom_fields?: unknown };
  return {
    brief: {
      project_summary: row.project_summary ?? null,
      custom_fields: normalizeCustomFields(row.custom_fields),
    },
  };
}

export async function fetchRoadmapFull(roadmapId: string): Promise<FullRoadmap> {
  return roadmapService.getFull(roadmapId);
}
