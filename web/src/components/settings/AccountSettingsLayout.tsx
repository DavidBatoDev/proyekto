import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, KeyRound, Palette, User, UserCog } from "lucide-react";
import type { ReactNode } from "react";
import { AppNavPill, AppSurfaceCard } from "@/components/common/AppPrimitives";
import { featureFlags } from "@/config/featureFlags";
import { useUser } from "@/stores/authStore";

interface AccountSettingsLayoutProps {
	children: ReactNode;
}

/**
 * Nav for every account settings page.
 *
 * The user menu used to list each settings page as its own row, which meant a
 * new setting could only ship by growing a dropdown. The navigation lives here
 * instead: the menu has one "Settings" door, and this rail is what moves
 * between sections.
 *
 * DashboardShell is deliberately NOT rendered here - `routes/settings/route.tsx`
 * owns it, the same split ProjectSettingsLayout uses.
 */
export function AccountSettingsLayout({
	children,
}: AccountSettingsLayoutProps) {
	const currentPath = useRouterState({
		select: (state) => state.location.pathname,
	});
	const user = useUser();

	// Appearance mirrors the guard the page itself already has: with the theme
	// runtime rolled back, the route redirects to /dashboard, so a nav row would
	// be a link to nowhere.
	const navItems = [
		{
			label: "Overview",
			to: "/settings",
			icon: UserCog,
			// Exact match - every other section lives under this prefix.
			active: currentPath === "/settings" || currentPath === "/settings/",
		},
		...(featureFlags.themeSystem
			? [
					{
						label: "Appearance",
						to: "/settings/appearance",
						icon: Palette,
						active: currentPath.startsWith("/settings/appearance"),
					},
				]
			: []),
		{
			label: "Notifications",
			to: "/settings/notifications",
			icon: Bell,
			active: currentPath.startsWith("/settings/notifications"),
		},
		{
			label: "MCP Access",
			to: "/settings/mcp-tokens",
			icon: KeyRound,
			active: currentPath.startsWith("/settings/mcp-tokens"),
		},
	];

	return (
		<div className="flex h-full min-h-0 overflow-hidden">
			<aside className="hidden h-full w-[264px] shrink-0 border-r border-border bg-card/70 backdrop-blur md:flex">
				<div className="w-full overflow-y-auto">
					<div className="border-b border-border px-6 pb-5 pt-7">
						<p className="app-section-kicker">Account</p>
						<h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
							Settings
						</h1>
					</div>

					<div className="px-4 py-5">
						<p className="px-2 pb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
							Your account
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

						{/* Leaves settings entirely, so it must not read as a tab. */}
						<div className="mt-5 border-t border-border pt-5">
							<Link
								to="/profile/$profileId"
								params={{ profileId: user?.id || "" }}
								className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							>
								<User className="h-4 w-4" />
								<span>View public profile</span>
							</Link>
						</div>
					</div>
				</div>
			</aside>

			<main className="min-w-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-[960px] px-5 py-6 md:px-8 md:py-8">
					<AppSurfaceCard className="mb-6 p-4 md:hidden">
						<p className="app-section-kicker">Account</p>
						<h1 className="mt-1 text-xl font-semibold text-foreground">
							Settings
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
							<Link
								to="/profile/$profileId"
								params={{ profileId: user?.id || "" }}
							>
								<AppNavPill className="gap-1.5">
									<User className="h-4 w-4" />
									Profile
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
