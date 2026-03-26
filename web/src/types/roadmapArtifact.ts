import type { Roadmap } from "./roadmap";

export interface ArtifactSemanticDiffSummary {
  node_added: number;
  node_removed: number;
  node_moved: number;
  status_changed: number;
  date_changed: number;
  dependency_changed: number;
}

export interface ArtifactValidationIssue {
  code: string;
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface RoadmapArtifactPreview {
  artifactId: string;
  title: string;
  summary: string;
  createdAt: string;
  baseRoadmapId: string;
  baseRevision?: number;
  candidateSnapshot: Roadmap;
  semanticDiffSummary: ArtifactSemanticDiffSummary;
  validationIssues: ArtifactValidationIssue[];
  status: "draft" | "applied";
}
