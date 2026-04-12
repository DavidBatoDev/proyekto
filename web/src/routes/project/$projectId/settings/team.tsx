import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ProjectSettingsLayout } from "@/components/project/ProjectSettingsLayout";
import { useToast } from "@/hooks/useToast";
import { projectService, type ProjectMember } from "@/services/project.service";

export const Route = createFileRoute("/project/$projectId/settings/team")({
  component: TeamSettingsPage,
});

function TeamSettingsPage() {
  const { projectId } = Route.useParams();
  const toast = useToast();
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const data = await projectService.getMembers(projectId);
        setMembers(data);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to load team members.",
        );
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [projectId]);

  return (
    <ProjectSettingsLayout projectId={projectId}>
      <section className="app-surface-card-strong overflow-hidden rounded-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">
              Team Settings
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Members and positions for this project.
            </p>
          </div>
          <Link
            to="/project/$projectId/team"
            params={{ projectId }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Open full team management
          </Link>
        </header>

        <div className="divide-y divide-slate-100">
          {isLoading ? (
            <div className="px-5 py-6 text-sm text-slate-500">
              Loading members...
            </div>
          ) : members.length === 0 ? (
            <div className="px-5 py-6 text-sm text-slate-500">
              No members found.
            </div>
          ) : (
            members.map((member) => {
              const displayName =
                member.user?.display_name ||
                [member.user?.first_name, member.user?.last_name]
                  .filter(Boolean)
                  .join(" ") ||
                member.user?.email ||
                "Unknown";

              return (
                <div
                  key={member.id}
                  className="flex items-center justify-between gap-3 px-5 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {displayName}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {member.user?.email || "No email"}
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                    {member.position?.trim() || "Member"}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </section>
    </ProjectSettingsLayout>
  );
}
