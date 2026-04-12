import { createFileRoute } from "@tanstack/react-router";
import { ClipboardList } from "lucide-react";
import {
  AppEmptyState,
  AppSectionHeader,
  AppSurfaceCard,
} from "@/components/common/AppPrimitives";

export const Route = createFileRoute("/project/$projectId/logs")({
  component: ProjectLogsPage,
});

function ProjectLogsPage() {
  return (
    <div className="app-shell-bg h-full w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-5 py-6 md:px-8 md:py-8">
        <AppSurfaceCard strong className="mb-6 p-6">
          <AppSectionHeader
            kicker="Audit"
            title="Logs"
            subtitle="View project activity and audit logs."
          />
        </AppSurfaceCard>

        <AppEmptyState
          icon={ClipboardList}
          title="Logs panel coming up"
          description="Project logs and history will appear here."
          className="app-surface-card-strong border-dashed py-16"
        />
      </div>
    </div>
  );
}
