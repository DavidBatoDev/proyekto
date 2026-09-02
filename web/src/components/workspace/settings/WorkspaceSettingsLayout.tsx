import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, Building2, CreditCard, Users } from "lucide-react";
import type { ReactNode } from "react";
import { AppNavPill, AppSurfaceCard } from "@/components/common/AppPrimitives";
import { useCurrentWorkspace } from "@/hooks/useWorkspaceQueries";

interface WorkspaceSettingsLayoutProps {
	children: ReactNode;
}

/**
 * Nav for every workspace settings page — the same rail/content split as
 * AccountSettingsLayout, with the current workspace named in the kicker so the
 * page always says whose settings these are. The URL stays clean (no tenant
 * segment); the workspace comes from the selection store.
 */
export function WorkspaceSettingsLayout({
	children,
}: WorkspaceSettingsLayoutProps) {
	const currentPath = useRouterState({
		select: (state) => state.location.pathname,
	});
	const { workspace } = useCurrentWorkspace();

	const navItems = [
		{
			label: "General",
			to: "/workspace/settings",
			icon: Building2,
			// Exact match — Members and Billing live under this prefix.
			active:
				currentPath === "/workspace/settings" ||
				currentPath === "/workspace/settings/",
		},
		{
			label: "Members",
			to: "/workspace/settings/members",
			icon: Users,
			active: currentPath.startsWith("/workspace/settings/members"),
		},
		{
			label: "Billing",
			to: "/workspace/settings/billing",
			icon: CreditCard,
			active: currentPath.startsWith("/workspace/settings/billing"),
		},
	];

	return (
		<div className="flex h-full min-h-0 overflow-hidden">
			<aside className="hidden h-full w-[264px] shrink-0 border-r border-border bg-card/70 backdrop-blur md:flex">
				<div className="w-full overflow-y-auto">
					<div className="border-b border-border px-6 pb-5 pt-7">
						<p className="app-section-kicker">
							{workspace?.name ?? "Workspace"}
						</p>
						<h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
							Workspace
						</h1>
					</div>

					<div className="px-4 py-5">
						<p className="px-2 pb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
							This workspace
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
												? "bg-primary text-primary-foreground shadow-(--app-shadow-sm)"
												: "text-foreground hover:bg-muted"
										}`}
									>
										<Icon className="h-4 w-4" />
										<span>{item.label}</span>
									</Link>
								);
							})}
						</nav>

						{/* Leaves workspace settings entirely, so it must not read as a tab. */}
						<div className="mt-5 border-t border-border pt-5">
							<Link
								to="/dashboard"
								className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							>
								<ArrowLeft className="h-4 w-4" />
								<span>Back to dashboard</span>
							</Link>
						</div>
					</div>
				</div>
			</aside>

			<main className="min-w-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-[960px] px-5 py-6 md:px-8 md:py-8">
					<AppSurfaceCard className="mb-6 p-4 md:hidden">
						<p className="app-section-kicker">
							{workspace?.name ?? "Workspace"}
						</p>
						<h1 className="mt-1 text-xl font-semibold text-foreground">
							Workspace
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
							<Link to="/dashboard">
								<AppNavPill className="gap-1.5">
									<ArrowLeft className="h-4 w-4" />
									Dashboard
								</AppNavPill>
							</Link>
						</nav>
					</AppSurfaceCard>

					<div className="app-slide-up min-w-0">{children}</div>
				</div>
			</main>
		</div>
	);
}
