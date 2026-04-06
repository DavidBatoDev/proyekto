import { describe, expect, it } from "vitest";
import { useRoadmapStore } from "./roadmapStore";
import type { RoadmapArtifactPreview } from "@/types/roadmapArtifact";

describe("roadmapStore artifact apply", () => {
  it("applies artifact snapshot milestones when present", () => {
    const artifact: RoadmapArtifactPreview = {
      artifactId: "artifact-1",
      title: "Preview",
      summary: "summary",
      createdAt: "2026-03-29T00:00:00.000Z",
      baseRoadmapId: "roadmap-1",
      candidateSnapshot: {
        id: "roadmap-1",
        project_id: "project-1",
        name: "Roadmap",
        owner_id: "owner-1",
        status: "active",
        created_at: "2026-03-01T00:00:00.000Z",
        updated_at: "2026-03-01T00:00:00.000Z",
        epics: [],
        milestones: [
          {
            id: "ms-1",
            roadmap_id: "roadmap-1",
            title: "Milestone A",
            target_date: "2026-05-01",
            status: "in_progress",
            position: 0,
            created_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z",
          },
        ],
      },
      semanticDiffSummary: {
        node_added: 0,
        node_removed: 0,
        node_moved: 0,
        status_changed: 0,
        date_changed: 0,
        dependency_changed: 0,
      },
      semanticDiffChanges: [],
      validationIssues: [],
      status: "draft",
    };

    useRoadmapStore.setState((state) => ({
      ...state,
      roadmap: {
        id: "roadmap-1",
        project_id: "project-1",
        name: "Roadmap",
        owner_id: "owner-1",
        status: "active",
        created_at: "2026-03-01T00:00:00.000Z",
        updated_at: "2026-03-01T00:00:00.000Z",
        epics: [],
        milestones: [
          {
            id: "ms-old",
            roadmap_id: "roadmap-1",
            title: "Existing",
            target_date: "2026-04-01",
            status: "not_started",
            position: 0,
            created_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z",
          },
        ],
      },
      artifactsById: { "artifact-1": artifact },
    }));

    useRoadmapStore.getState().applyArtifactSnapshot("artifact-1");

    const next = useRoadmapStore.getState();
    expect(next.milestones).toHaveLength(1);
    expect(next.milestones[0]?.id).toBe("ms-1");
  });

  it("marks applied artifact as discarded without closing tab", () => {
    const artifact: RoadmapArtifactPreview = {
      artifactId: "artifact-2",
      title: "Applied Preview",
      summary: "summary",
      createdAt: "2026-03-29T00:00:00.000Z",
      baseRoadmapId: "roadmap-1",
      candidateSnapshot: {
        id: "roadmap-1",
        project_id: "project-1",
        name: "Roadmap",
        owner_id: "owner-1",
        status: "active",
        created_at: "2026-03-01T00:00:00.000Z",
        updated_at: "2026-03-01T00:00:00.000Z",
        epics: [],
        milestones: [],
      },
      semanticDiffSummary: {
        node_added: 0,
        node_removed: 0,
        node_moved: 0,
        status_changed: 0,
        date_changed: 0,
        dependency_changed: 0,
      },
      semanticDiffChanges: [],
      validationIssues: [],
      status: "applied",
    };

    useRoadmapStore.setState((state) => ({
      ...state,
      artifactsById: { "artifact-2": artifact },
      canvasOpenArtifactTabs: ["artifact-2"],
      canvasSelectedArtifactId: "artifact-2",
      canvasViewMode: "artifact",
    }));

    useRoadmapStore.getState().discardArtifact("artifact-2");

    const next = useRoadmapStore.getState();
    expect(next.artifactsById["artifact-2"]?.status).toBe("discarded");
    expect(next.canvasOpenArtifactTabs).toContain("artifact-2");
    expect(next.canvasSelectedArtifactId).toBe("artifact-2");
    expect(next.canvasViewMode).toBe("artifact");
  });
});
