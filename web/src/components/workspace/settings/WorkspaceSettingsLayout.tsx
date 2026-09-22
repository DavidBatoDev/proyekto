import { Link, useParams, useRouterState } from "@tanstack/react-router";
import {
	ArrowLeft,
	Building2,
	CreditCard,
	Gauge,
	type LucideIcon,
	Users,
} from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { useCurrentWorkspace } from "@/hooks/useWorkspaceQueries";
import { cn } from "@/lib/utils";
import { stripWorkspacePrefix } from "@/lib/workspacePaths";

interface WorkspaceSettingsLayoutProps {
	children: ReactNode;
}

interface NavItem {
	label: string;
	to: string;
	icon: LucideIcon;
	active: boolean;
	/** Only General needs it: the other pages live under its path. */
	exact?: boolean;
}

const FOCUS_RING =
	"outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

/**
 * Nav for every workspace settings page — the same rail/content split as
 * AccountSettingsLayout, with the current workspace named at the top of the
 * rail so the page always says whose settings these are. Lives under
 * /w/$workspaceSlug/, so the workspace is the one in the URL: links carry the
 * slug, and the active check runs on the path with that prefix stripped.
 *
 * Nothing here draws a card: the rail is set off by a single hairline and the
 * content column is a plain reading measure, so each page reads as one
 * document.
 */
export function WorkspaceSettingsLayout({
	children,
}: WorkspaceSettingsLayoutProps) {
	const currentPath = useRouterState({
		select: (state) => stripWorkspacePrefix(state.location.pathname),
	});
	const { workspace } = useCurrentWorkspace();
	const { workspaceSlug } = useParams({ from: "/w/$workspaceSlug" });

	const workspaceName = workspace?.name ?? "Workspace";
	const avatarUrl = workspace?.avatar_url ?? null;

	// On a phone the active tab may sit past the strip's edge (Billing, on
	// the narrowest screens or with enlarged text), so bring it into view
	// whenever the page changes, and again once web fonts have settled the
	// tabs' widths. "nearest" moves nothing that is already visible. The
	// strip is display:none from md up, where this does nothing.
	const tabStripRef = useRef<HTMLElement>(null);
	useEffect(() => {
		if (!currentPath) return;
		let cancelled = false;
		const reveal = () => {
			if (cancelled) return;
			const active = tabStripRef.current?.querySelector<HTMLElement>(
				'[data-active="true"]',
			);
			active?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
		};
		reveal();
		void document.fonts?.ready.then(reveal);
		return () => {
			cancelled = true;
		};
	}, [currentPath]);

	const navItems: NavItem[] = [
		{
			label: "General",
			to: `/w/${workspaceSlug}/settings`,
			icon: Building2,
			// Exact match — Members, Usage and Billing live under this prefix.
			active: currentPath === "/settings" || currentPath === "/settings/",
			exact: true,
		},
		{
			label: "Members",
			to: `/w/${workspaceSlug}/settings/members`,
			icon: Users,
			active: currentPath.startsWith("/settings/members"),
		},
		{
			label: "Usage",
			to: `/w/${workspaceSlug}/settings/usage`,
			icon: Gauge,
			active: currentPath.startsWith("/settings/usage"),
		},
		{
			label: "Billing",
			to: `/w/${workspaceSlug}/settings/billing`,
			icon: CreditCard,
			active: currentPath.startsWith("/settings/billing"),
		},
	];

	return (
		<div className="flex h-full min-h-0 overflow-hidden">
			<aside className="hidden h-full w-[248px] shrink-0 border-r border-border md:flex">
				<div className="flex w-full flex-col overflow-y-auto px-3 pb-6 pt-7">
					<WorkspaceIdentity
						name={workspaceName}
						avatarUrl={avatarUrl}
						className="px-2.5"
					/>

					<p className="mt-8 px-2.5 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
						This workspace
					</p>

					<nav aria-label="Workspace settings" className="space-y-0.5">
						{navItems.map((item) => {
							const Icon = item.icon;
							return (
								<Link
									key={item.label}
									to={item.to}
									activeOptions={{ exact: item.exact ?? false }}
									className={cn(
										"flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors",
										FOCUS_RING,
										item.active
											? "bg-primary/10 font-medium text-primary"
											: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
									)}
								>
									<Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
									<span className="truncate">{item.label}</span>
								</Link>
							);
						})}
					</nav>

					{/* Leaves workspace settings entirely, so it must not read as a tab. */}
					<div className="mt-6 border-t border-border pt-4">
						<Link
							to="/w/$workspaceSlug/dashboard"
							params={{ workspaceSlug }}
							className={cn(
								"flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
								FOCUS_RING,
							)}
						>
							<ArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
							<span>Back to dashboard</span>
						</Link>
					</div>
				</div>
			</aside>

			<main className="min-w-0 flex-1 overflow-y-auto">
				<div className="border-b border-border px-5 pt-5 md:hidden">
					<div className="flex items-center justify-between gap-3">
						<WorkspaceIdentity name={workspaceName} avatarUrl={avatarUrl} />
						{/* Leaves settings, so it sits apart from the tabs below. */}
						<Link
							to="/w/$workspaceSlug/dashboard"
							params={{ workspaceSlug }}
							className={cn(
								"-mr-2 inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
								FOCUS_RING,
							)}
						>
							<ArrowLeft aria-hidden="true" className="h-4 w-4" />
							Dashboard
						</Link>
					</div>

					{/* The strip scrolls on its own when the tabs outgrow the
					    screen; the page never does. Below 380px the icons go, so
					    all four tabs still fit on the narrowest phones. */}
					<nav
						ref={tabStripRef}
						aria-label="Workspace settings"
						className="-mx-5 -mb-px mt-4 flex scroll-px-5 gap-4 overflow-x-auto overscroll-x-contain px-5 [scrollbar-width:none] sm:gap-6 [&::-webkit-scrollbar]:hidden"
					>
						{navItems.map((item) => {
							const Icon = item.icon;
							return (
								<Link
									key={`mobile-${item.label}`}
									to={item.to}
									activeOptions={{ exact: item.exact ?? false }}
									data-active={item.active ? "true" : undefined}
									className={cn(
										// Inset ring: the scrolling strip clips anything drawn outside it.
										"relative inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30",
										item.active
											? "font-medium text-foreground"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									<Icon
										aria-hidden="true"
										className={cn(
											"h-4 w-4 shrink-0 max-[379px]:hidden",
											item.active ? "text-primary" : undefined,
										)}
									/>
									{item.label}
									{item.active ? (
										<span
											aria-hidden="true"
											className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary"
										/>
									) : null}
								</Link>
							);
						})}
					</nav>
				</div>

				{/* Left-aligned beside the rail, as Linear and GitHub settings
				    are: centred in a wide window, the page drifts away from the
				    nav that names it. */}
				<div className="w-full max-w-[912px] px-5 py-8 md:px-10 md:py-10 lg:px-14">
					<div className="app-slide-up min-w-0">{children}</div>
				</div>
			</main>
		</div>
	);
}

/**
 * The workspace these settings belong to: its avatar, or an initial monogram
 * when it has none, beside its name.
 */
function WorkspaceIdentity({
	name,
	avatarUrl,
	className,
}: {
	name: string;
	avatarUrl: string | null;
	className?: string;
}) {
	const initial = name.trim().charAt(0).toUpperCase() || "W";
	return (
		<div className={cn("flex min-w-0 items-center gap-3", className)}>
			{avatarUrl ? (
				<img
					src={avatarUrl}
					alt=""
					className="h-8 w-8 shrink-0 rounded-lg object-cover"
				/>
			) : (
				<span
					aria-hidden="true"
					className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary"
				>
					{initial}
				</span>
			)}
			<div className="min-w-0">
				<p className="truncate text-sm font-semibold leading-5 text-foreground">
					{name}
				</p>
				<p className="text-xs leading-4 text-muted-foreground">
					Workspace settings
				</p>
			</div>
		</div>
	);
}
