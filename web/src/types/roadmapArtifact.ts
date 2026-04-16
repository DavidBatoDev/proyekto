import type { Roadmap } from "./roadmap";

export interface ArtifactSemanticDiffSummary {
  node_added: number;
  node_removed: number;
  node_moved: number;
  title_changed: number;
  description_changed: number;
  status_changed: number;
  priority_changed: number;
  assignee_changed: number;
  tags_changed: number;
  color_changed: number;
  deliverable_changed: number;
  date_changed: number;
  dependency_changed: number;
}

export interface ArtifactValidationIssue {
  code: string;
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface ArtifactSemanticDiffChange {
  type: string;
  node: {
    type: "roadmap" | "epic" | "feature" | "task";
    id: string;
  };
  from?: Record<string, unknown>;
  to?: Record<string, unknown>;
}

export type NormalizedArtifactSnapshot = Roadmap;

export interface RoadmapArtifactPreview {
  artifactId: string;
  changeId?: string;
  title: string;
  summary: string;
  createdAt: string;
  baseRoadmapId: string;
  baseRevision?: number;
  candidateSnapshot: NormalizedArtifactSnapshot;
  semanticDiffSummary: ArtifactSemanticDiffSummary;
  semanticDiffChanges: ArtifactSemanticDiffChange[];
  validationIssues: ArtifactValidationIssue[];
  status: "draft" | "applied" | "discarded";
}
