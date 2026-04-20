import { Link } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import type { ReactNode } from "react";
import { AppNavPill, AppSectionHeader, AppSurfaceCard } from "@/components/common/AppPrimitives";

type TimeTab = "my_logs" | "team_logs";

interface TimeRouteFrameProps {
  projectId: string;
  activeTab: TimeTab;
  loadingPermissions: boolean;
  showMyLogsTabSkeleton: boolean;
  canShowMyLogsTab: boolean;
  canViewTeamLogs: boolean;
  errorMessage?: string | null;
  children: ReactNode;
}

export function TimeRouteFrame({
  projectId,
  activeTab,
  loadingPermissions,
  showMyLogsTabSkeleton,
  canShowMyLogsTab,
  canViewTeamLogs,
  errorMessage,
  children,
}: TimeRouteFrameProps) {
  return (
    <div className="app-shell-bg h-full w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1240px] px-5 py-6 md:px-8 md:py-8">
        <AppSurfaceCard strong className="mb-5 p-5 md:p-6">
          <AppSectionHeader
            kicker="Operations"
            title="Time"
            subtitle="Track task time logs and manage project member hourly rates."
            rightSlot={
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700">
                <Clock className="h-5 w-5" />
              </span>
            }
          />
        </AppSurfaceCard>

        {loadingPermissions ? (
          <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-slate-100 p-1 animate-pulse">
            <div className="h-8 w-24 rounded-full bg-slate-200" />
            <div className="h-8 w-24 rounded-full bg-slate-200" />
          </div>
        ) : (
          <AppSurfaceCard className="mb-5 inline-flex items-center gap-2 rounded-full p-1.5">
            {showMyLogsTabSkeleton && (
              <div className="h-8 w-24 rounded-full bg-slate-200 animate-pulse" />
            )}
            {canShowMyLogsTab && (
              <Link to="/project/$projectId/time/my-logs" params={{ projectId }}>
                <AppNavPill active={activeTab === "my_logs"}>My Logs</AppNavPill>
              </Link>
            )}
            {canViewTeamLogs && (
              <Link to="/project/$projectId/time/team-logs" params={{ projectId }}>
                <AppNavPill active={activeTab === "team_logs"}>Team Logs</AppNavPill>
              </Link>
            )}
          </AppSurfaceCard>
        )}

        {errorMessage && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        <div className="app-slide-up">{children}</div>
      </div>
    </div>
  );
}
