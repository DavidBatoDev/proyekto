import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
	ChevronRight,
	ClipboardList,
	Clock,
	FolderKanban,
	Settings,
} from "lucide-react";
import { AppNavPill, AppSurfaceCard } from "@/components/common/AppPrimitives";
import { DashboardShell } from "@/components/layout/DashboardShell";

interface TeamSettingsLayoutProps {
	teamId: string;
	teamName?: string | null;
	children: ReactNode;
}

export function TeamSettingsLayout({
	teamId,
	teamName,
	children,
}: TeamSettingsLayoutProps) {
	const currentPath = useRouterState({
		select: (state) => state.location.pathname,
	});

	const navItems = [
		{
			label: "General",
			to: `/teams/${teamId}/settings/general`,
			icon: Settings,
			active: currentPath === `/teams/${teamId}/settings/general`,
		},
		{
			label: "Projects",
			to: `/teams/${teamId}/settings/projects`,
			icon: FolderKanban,
			active: currentPath.startsWith(`/teams/${teamId}/settings/projects`),
		},
		{
			label: "Time",
			to: `/teams/${teamId}/settings/time`,
			icon: Clock,
			active: currentPath.startsWith(`/teams/${teamId}/settings/time`),
		},
		{
			label: "Logs",
			to: `/teams/${teamId}/settings/logs`,
			icon: ClipboardList,
			active: currentPath.startsWith(`/teams/${teamId}/settings/logs`),
		},
	];

	return (
		<DashboardShell>
			<div className="flex h-full min-h-0 overflow-hidden">
				<aside className="hidden h-full w-[260px] shrink-0 border-r border-slate-200/80 bg-white/70 backdrop-blur md:flex">
					<div className="w-full overflow-y-auto">
						<div className="border-b border-slate-200/80 px-6 pb-5 pt-7">
							<p className="app-section-kicker">Team</p>
							<h1 className="mt-1 truncate text-2xl font-semibold tracking-tight text-slate-900">
								{teamName || "Settings"}
							</h1>
						</div>
						<div className="px-4 py-5">
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
													? "bg-primary text-white shadow-[0_8px_16px_rgba(37,99,235,0.22)]"
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

				<main className="min-w-0 flex-1 overflow-y-auto">
					<div className="mx-auto w-full max-w-[1040px] px-5 py-6 md:px-8 md:py-8">
						<nav
							aria-label="Breadcrumb"
							className="mb-5 flex items-center gap-1.5 text-sm font-medium"
						>
							<Link
								to="/teams"
								className="text-slate-600 transition-colors hover:text-slate-900"
							>
								Teams
							</Link>
							<ChevronRight
								className="h-4 w-4 text-slate-400"
								aria-hidden="true"
							/>
							<Link
								to="/teams/$teamId"
								params={{ teamId }}
								className="truncate text-slate-600 transition-colors hover:text-slate-900"
							>
								{teamName || "Team"}
							</Link>
							<ChevronRight
								className="h-4 w-4 text-slate-400"
								aria-hidden="true"
							/>
							<span aria-current="page" className="text-slate-900">
								Settings
							</span>
						</nav>

						<AppSurfaceCard className="mb-6 p-4 md:hidden">
							<p className="app-section-kicker">Team</p>
							<h1 className="mt-1 truncate text-xl font-semibold text-slate-900">
								{teamName || "Settings"}
							</h1>
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
		</DashboardShell>
	);
}
