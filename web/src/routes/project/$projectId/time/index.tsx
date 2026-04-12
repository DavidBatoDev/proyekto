import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useTimeRouteData } from "@/components/project/time/useTimeRouteData";

export const Route = createFileRoute("/project/$projectId/time/")({
  component: TimeIndexPage,
});

function TimeIndexPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const {
    loadingPermissions,
    isResolvingMyLogsAccess,
    canShowMyLogsTab,
    canViewTeamLogs,
  } = useTimeRouteData(projectId, {
    includeOwnRate: true,
  });

  useEffect(() => {
    if (loadingPermissions || isResolvingMyLogsAccess) return;

    if (canShowMyLogsTab) {
      void navigate({
        to: "/project/$projectId/time/my-logs",
        params: { projectId },
        replace: true,
      });
      return;
    }

    if (canViewTeamLogs) {
      void navigate({
        to: "/project/$projectId/time/team-logs",
        params: { projectId },
        replace: true,
      });
      return;
    }

    void navigate({
      to: "/project/$projectId/time/my-logs",
      params: { projectId },
      replace: true,
    });
  }, [
    canShowMyLogsTab,
    canViewTeamLogs,
    isResolvingMyLogsAccess,
    loadingPermissions,
    navigate,
    projectId,
  ]);

  return (
    <div className="app-shell-bg flex h-full w-full items-center justify-center p-8">
      <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm">
        <Loader2 className="h-4 w-4 animate-spin text-slate-700" />
        Loading time page...
      </div>
    </div>
  );
}
