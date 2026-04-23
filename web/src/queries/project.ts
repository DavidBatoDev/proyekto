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

export type ProjectBrief = {
  mission_vision?: string | null;
  scope_statement?: string | null;
  requirements?: unknown;
  constraints?: string | null;
  risk_register?: unknown;
  visibility_mask?: Record<string, unknown> | null;
  notes?: string | null;
};

export type BriefStorageMode = "visibility_mask" | "notes" | "none";

export type ProjectBriefResult = {
  brief: ProjectBrief | null;
  mode: BriefStorageMode;
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

const briefSelectBase =
  "mission_vision, scope_statement, requirements, constraints, risk_register";

function isMissingColumnError(error: unknown, column: string): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { message?: string; details?: string; hint?: string };
  const text =
    `${err.message ?? ""} ${err.details ?? ""} ${err.hint ?? ""}`.toLowerCase();
  return text.includes(column.toLowerCase());
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
  const withVisibility = await supabase
    .from("project_briefs")
    .select(`${briefSelectBase}, visibility_mask`)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!withVisibility.error) {
    return {
      brief: (withVisibility.data as ProjectBrief | null) ?? null,
      mode: "visibility_mask",
    };
  }

  if (!isMissingColumnError(withVisibility.error, "visibility_mask")) {
    throw withVisibility.error;
  }

  const withNotes = await supabase
    .from("project_briefs")
    .select(`${briefSelectBase}, notes`)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!withNotes.error) {
    return {
      brief: (withNotes.data as ProjectBrief | null) ?? null,
      mode: "notes",
    };
  }

  if (!isMissingColumnError(withNotes.error, "notes")) {
    throw withNotes.error;
  }

  const baseOnly = await supabase
    .from("project_briefs")
    .select(briefSelectBase)
    .eq("project_id", projectId)
    .maybeSingle();

  if (baseOnly.error) {
    throw baseOnly.error;
  }

  return {
    brief: (baseOnly.data as ProjectBrief | null) ?? null,
    mode: "none",
  };
}

export async function fetchRoadmapFull(roadmapId: string): Promise<FullRoadmap> {
  return roadmapService.getFull(roadmapId);
}
