import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Loader2, Share2, ExternalLink, Calendar } from "lucide-react";
import { roadmapSharesServiceAPI, type SharedRoadmapInfo } from "@/services/roadmap-shares.service";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/roadmap/shared-with-me")({
  component: SharedWithMePage,
});

function SharedWithMePage() {
  const [sharedRoadmaps, setSharedRoadmaps] = useState<SharedRoadmapInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadSharedRoadmaps = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const data = await roadmapSharesServiceAPI.sharing.getSharedWithMe();
        setSharedRoadmaps(data);
      } catch (error) {
        console.error("Failed to load shared roadmaps:", error);
        setError("Failed to load shared roadmaps. Please try again later.");
      } finally {
        setIsLoading(false);
      }
    };

    loadSharedRoadmaps();
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-gray-600">Loading shared roadmaps...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Shared with Me
          </h1>
          <p className="text-gray-600">
            Roadmaps that others have shared with you
          </p>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Empty State */}
        {!error && sharedRoadmaps.length === 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <Share2 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              No Shared Roadmaps
            </h2>
            <p className="text-gray-600 mb-6">
              When someone shares a roadmap with you, it will appear here.
            </p>
            <Link
              to="/"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
            >
              Go to Home
            </Link>
          </div>
        )}

        {/* Roadmaps Grid */}
        {!error && sharedRoadmaps.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sharedRoadmaps.map((item) => {
              const displayName =
                item.owner.display_name ||
                [item.owner.first_name, item.owner.last_name]
                  .filter(Boolean)
                  .join(" ") ||
                "Unknown";

              const sharedAgo = formatDistanceToNow(
                new Date(item.sharedAt),
                { addSuffix: true }
              );

              return (
                <Link
                  key={item.roadmap.id}
                  to="/project/$projectId/roadmap/$roadmapId"
                  params={{ projectId: item.roadmap.project_id || "n", roadmapId: item.roadmap.id }}
                  className="block bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow overflow-hidden"
                >
                  <div className="p-6">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-900 line-clamp-2">
                        {item.roadmap.name}
                      </h3>
                      <ExternalLink className="w-5 h-5 text-gray-400 shrink-0 ml-2" />
                    </div>

                    {/* Description */}
                    {item.roadmap.description && (
                      <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                        {item.roadmap.description}
                      </p>
                    )}

                    {/* Owner Info */}
                    <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100">
                      {item.owner.avatar_url ? (
                        <img
                          src={item.owner.avatar_url}
                          alt={displayName}
                          className="w-8 h-8 rounded-full"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <span className="text-sm font-medium text-primary">
                            {displayName[0].toUpperCase()}
                          </span>
                        </div>
                      )}
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {displayName}
                        </p>
                        <p className="text-xs text-gray-500">Owner</p>
                      </div>
                    </div>

                    {/* Access Level & Shared Date */}
                    <div className="flex items-center justify-between text-xs">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full font-medium ${
                          item.accessLevel === "viewer"
                            ? "bg-blue-100 text-blue-700"
                            : item.accessLevel === "commenter"
                              ? "bg-green-100 text-green-700"
                              : "bg-purple-100 text-purple-700"
                        }`}
                      >
                        {item.accessLevel === "viewer"
                          ? "View Only"
                          : item.accessLevel === "commenter"
                            ? "Can Comment"
                            : "Can Edit"}
                      </span>
                      <span className="text-gray-500 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        Shared {sharedAgo}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
