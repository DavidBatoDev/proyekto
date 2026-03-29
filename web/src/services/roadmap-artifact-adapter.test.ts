import { describe, expect, it } from "vitest";
import {
  ArtifactSnapshotNormalizationError,
  normalizeArtifactCandidateSnapshot,
} from "./roadmap-artifact-adapter";

describe("roadmap artifact adapter", () => {
  it("normalizes canonical backend roadmap_epics shape", () => {
    const normalized = normalizeArtifactCandidateSnapshot({
      candidateSnapshot: {
        id: "roadmap-1",
        name: "Preview Roadmap",
        status: "active",
        roadmap_epics: [
          {
            id: "epic-1",
            title: "Platform Foundation",
            roadmap_features: [
              {
                id: "feature-1",
                title: "Authentication",
                roadmap_tasks: [
                  {
                    id: "task-1",
                    title: "Implement login",
                    status: "in_review",
                  },
                ],
              },
            ],
          },
        ],
      },
      baseUpdatedAt: "2026-03-29T10:00:00.000Z",
    });

    expect(normalized.epics).toHaveLength(1);
    expect(normalized.epics?.[0]?.features).toHaveLength(1);
    expect(normalized.epics?.[0]?.features?.[0]?.tasks).toHaveLength(1);
    expect(normalized.epics?.[0]?.features?.[0]?.tasks?.[0]?.feature_id).toBe("feature-1");
  });

  it("accepts already-normalized epics input shape", () => {
    const normalized = normalizeArtifactCandidateSnapshot({
      candidateSnapshot: {
        id: "roadmap-1",
        name: "Preview Roadmap",
        status: "active",
        epics: [
          {
            id: "epic-1",
            title: "Platform Foundation",
            features: [
              {
                id: "feature-1",
                title: "Authentication",
                tasks: [{ id: "task-1", title: "Implement login" }],
              },
            ],
          },
        ],
      },
      baseUpdatedAt: "2026-03-29T10:00:00.000Z",
    });

    expect(normalized.epics?.[0]?.id).toBe("epic-1");
    expect(normalized.epics?.[0]?.features?.[0]?.id).toBe("feature-1");
    expect(normalized.epics?.[0]?.features?.[0]?.tasks?.[0]?.id).toBe("task-1");
  });

  it("throws typed normalization error when required root id is missing", () => {
    expect(() =>
      normalizeArtifactCandidateSnapshot({
        candidateSnapshot: {
          name: "Preview Roadmap",
          roadmap_epics: [],
        },
        baseUpdatedAt: "2026-03-29T10:00:00.000Z",
      }),
    ).toThrowError(ArtifactSnapshotNormalizationError);
  });
});
