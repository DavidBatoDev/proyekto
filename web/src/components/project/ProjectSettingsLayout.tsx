import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Settings, Users, UsersRound } from "lucide-react";
import { AppNavPill, AppSurfaceCard } from "@/components/common/AppPrimitives";

interface ProjectSettingsLayoutProps {
  projectId: string;
  children: ReactNode;
}

export function ProjectSettingsLayout({
  projectId,
  children,
}: ProjectSettingsLayoutProps) {
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  });

  const navItems = [
    {
      label: "General",
      to: `/project/${projectId}/settings/general`,
      icon: Settings,
      active: currentPath === `/project/${projectId}/settings/general`,
    },
    {
      label: "Permissions",
      to: `/project/${projectId}/settings/permissions`,
      icon: Users,
      active:
        currentPath.startsWith(`/project/${projectId}/settings/permissions`) ||
        currentPath === `/project/${projectId}/settings/team`,
    },
    {
      label: "Teams",
      to: `/project/${projectId}/settings/teams`,
      icon: UsersRound,
      active: currentPath.startsWith(`/project/${projectId}/settings/teams`),
    },
  ];

  return (
    <div className="app-shell-bg h-full min-h-0 overflow-hidden">
      <div className="flex h-full min-h-0 overflow-hidden">
        <aside className="hidden h-full w-[272px] shrink-0 border-r border-slate-200/80 bg-white/70 backdrop-blur md:flex">
          <div className="w-full overflow-y-auto">
            <div className="border-b border-slate-200/80 px-7 pb-5 pt-7">
              <p className="app-section-kicker">Project</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
                Settings
              </h1>
            </div>

            <div className="px-5 py-5">
              <p className="px-2 pb-3 text-[11px] font-semibold tracking-[0.14em] uppercase text-slate-500">
                Configuration
              </p>

              <nav className="space-y-1.5">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.label}
                      to={item.to}
                      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${
                        item.active
                          ? "bg-slate-900 text-white shadow-[0_8px_16px_rgba(15,23,42,0.22)]"
                          : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1040px] px-5 py-6 md:px-8 md:py-8">
            <AppSurfaceCard className="mb-6 p-4 md:hidden">
              <p className="app-section-kicker">Project</p>
              <h1 className="mt-1 text-xl font-semibold text-slate-900">Settings</h1>
              <nav className="mt-4 flex flex-wrap gap-2">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link key={`mobile-${item.label}`} to={item.to}>
                      <AppNavPill active={item.active} className="gap-1.5">
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </AppNavPill>
                    </Link>
                  );
                })}
              </nav>
            </AppSurfaceCard>

            <div className="app-slide-up min-w-0">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
