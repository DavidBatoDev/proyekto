import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { roadmapService } from "@/services/roadmap.service";
import type { Roadmap } from "@/types/roadmap";

export const Route = createFileRoute("/consultant/templates")({
  beforeLoad: () => {
    const { isAuthenticated, profile } = useAuthStore.getState();
    if (!isAuthenticated) throw redirect({ to: "/auth/login" });
    if (profile && !profile.is_consultant_verified) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: ConsultantTemplatesPage,
});

function ConsultantTemplatesPage() {
  const [roadmaps, setRoadmaps] = useState<Roadmap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadRoadmaps = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await roadmapService.getConsultantTemplateRoadmaps();
      setRoadmaps(data.filter((roadmap) => roadmap.project_id === null));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load consultant template roadmaps",
      );
      setRoadmaps([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoadmaps();
  }, []);

  const toggleTemplateSetting = async (
    roadmap: Roadmap,
    key: "is_public" | "is_templatable",
  ) => {
    const nextValue = !(roadmap[key] ?? false);

    try {
      setUpdatingId(roadmap.id);
      const updated = await roadmapService.updateTemplateSettings(roadmap.id, {
        [key]: nextValue,
      });

      setRoadmaps((current) =>
        current.map((item) =>
          item.id === roadmap.id ? { ...item, ...updated } : item,
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to update template settings",
      );
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background pt-24 text-foreground">
      <div className="max-w-6xl mx-auto px-6 pb-16">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Template Roadmaps
          </h1>
          <p className="text-gray-600 mt-2">
            Manage your projectless roadmaps and make them public/templatable
            for guests and users.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
            {error}
          </div>
        ) : roadmaps.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-gray-300 bg-white p-12 text-center">
            <p className="text-gray-700 font-medium">
              No projectless roadmaps found.
            </p>
            <p className="text-gray-500 mt-2">
              Create a roadmap without linking it to a project first.
            </p>
            <Link
              to="/project/roadmap"
              className="inline-block mt-4 rounded-md bg-primary text-white px-4 py-2 text-sm font-semibold"
            >
              Create Roadmap
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {roadmaps.map((roadmap) => (
              <div
                key={roadmap.id}
                className="rounded-xl border border-gray-200 bg-white p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
              >
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-gray-900 truncate">
                    {roadmap.name}
                  </h2>
                  <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                    {roadmap.description || "No description"}
                  </p>
                </div>

                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <input
                      type="checkbox"
                      checked={Boolean(roadmap.is_public)}
                      disabled={updatingId === roadmap.id}
                      onChange={() =>
                        toggleTemplateSetting(roadmap, "is_public")
                      }
                      className="h-4 w-4"
                    />
                    Public
                  </label>

                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <input
                      type="checkbox"
                      checked={Boolean(roadmap.is_templatable)}
                      disabled={updatingId === roadmap.id}
                      onChange={() =>
                        toggleTemplateSetting(roadmap, "is_templatable")
                      }
                      className="h-4 w-4"
                    />
                    Templatable
                  </label>

                  <Link
                    to="/project/$projectId/roadmap/$roadmapId"
                    params={{
                      projectId: roadmap.project_id || "n",
                      roadmapId: roadmap.id,
                    }}
                    className="text-sm font-semibold text-primary"
                  >
                    Open
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
