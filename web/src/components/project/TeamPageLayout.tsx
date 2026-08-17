import { Link, useRouterState } from "@tanstack/react-router";
import { BookOpen, Mail, ShieldCheck, Users, UsersRound } from "lucide-react";
import type { ReactNode } from "react";
import { AppNavPill, AppSurfaceCard } from "@/components/common/AppPrimitives";
import { useProjectTeamAccess } from "@/components/project/people/useProjectTeamAccess";

interface TeamPageLayoutProps {
	projectId: string;
	children: ReactNode;
}

export function TeamPageLayout({ projectId, children }: TeamPageLayoutProps) {
	const currentPath = useRouterState({
		select: (state) => state.location.pathname,
	});
	const teamAccess = useProjectTeamAccess(projectId);

	const navItems = [
		{
			label: "People",
			to: `/project/${projectId}/team`,
			icon: Users,
			// Exact match only — every sub-page's path also starts with this
			// prefix, so `startsWith` here would keep People lit everywhere.
			active: currentPath === `/project/${projectId}/team`,
		},
		{
			label: "Teams",
			to: `/project/${projectId}/team/teams`,
			icon: UsersRound,
			active: currentPath.startsWith(`/project/${projectId}/team/teams`),
		},
		{
			label: "Permissions",
			to: `/project/${projectId}/team/permissions`,
			icon: ShieldCheck,
			active: currentPath.startsWith(`/project/${projectId}/team/permissions`),
		},
		{
			label: "Permissions Catalog",
			to: `/project/${projectId}/team/catalog`,
			icon: BookOpen,
			active: currentPath.startsWith(`/project/${projectId}/team/catalog`),
		},
		{
			label: "Invites",
			to: `/project/${projectId}/team/invites`,
			icon: Mail,
			active: currentPath.startsWith(`/project/${projectId}/team/invites`),
		},
	].filter(
		(item) =>
			item.label === "People" ||
			item.label === "Teams" ||
			teamAccess.canViewAdmin,
	);

	return (
		<div className="app-shell-bg h-full min-h-0 overflow-hidden">
			<div className="flex h-full min-h-0 overflow-hidden">
				<aside className="hidden h-full w-[272px] shrink-0 border-r border-slate-200/80 bg-white/70 backdrop-blur md:flex">
					<div className="w-full overflow-y-auto">
						<div className="border-b border-slate-200/80 px-7 pb-5 pt-7">
							<p className="app-section-kicker">Project</p>
							<h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
								Team
							</h1>
						</div>

						<div className="px-5 py-5">
							<nav className="space-y-1.5">
								{navItems.map((item) => {
									const Icon = item.icon;
									return (
										<Link
											key={item.label}
											to={item.to}
											className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${
												item.active
													? "bg-primary text-white shadow-[0_8px_16px_rgba(15,23,42,0.22)]"
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
							<h1 className="mt-1 text-xl font-semibold text-slate-900">
								Team
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
		</div>
	);
}
