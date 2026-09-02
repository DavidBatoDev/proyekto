import { Link } from "@tanstack/react-router";
import { Menu, MessageCircle } from "lucide-react";
import { useState } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import { useCurrentWorkspace } from "@/hooks/useWorkspaceQueries";
import { toWorkspacePath } from "@/lib/workspacePaths";
import { useAuthStore, useIsLoading } from "@/stores/authStore";
import { Button } from "@/ui/button";
import { HEADER_NAV_ITEMS } from "./headerNavigation";
import { MobileNavDrawer } from "./MobileNavDrawer";
import { NotificationBell } from "./NotificationBell";
import { GlobalSearchBar } from "./search/GlobalSearchBar";
import UserMenu from "./UserMenu";

const DashboardHeader = () => {
	const workspaceSlug = useCurrentWorkspace().workspace?.slug ?? null;
	const { isAuthenticated, profile } = useAuthStore();
	const isAuthLoading = useIsLoading();
	const isLoading = isAuthLoading || (isAuthenticated && !profile);
	const [mobileNavOpen, setMobileNavOpen] = useState(false);
	// While the search is focused it stretches across the nav area, so the nav
	// links collapse out of the way (and animate back when it closes).
	const [searchExpanded, setSearchExpanded] = useState(false);

	return (
		<div className="z-10 flex h-full w-full items-center gap-3 px-4 sm:gap-4 sm:px-6">
			{isAuthenticated && (
				<button
					type="button"
					onClick={() => setMobileNavOpen(true)}
					aria-label="Open menu"
					className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted lg:hidden"
				>
					<Menu size={22} />
				</button>
			)}
			<Link
				to="/home"
				className="flex shrink-0 items-center border-r border-border pr-3 sm:pr-4"
			>
				<BrandMark variant="logomark" className="h-7" />
			</Link>

			<div className="flex min-w-0 flex-1 items-center justify-between gap-3">
				<nav
					className={`hidden items-center gap-2 overflow-hidden whitespace-nowrap transition-all duration-200 lg:flex ${
						searchExpanded
							? "pointer-events-none max-w-0 opacity-0"
							: "max-w-[480px] opacity-100"
					}`}
				>
					{HEADER_NAV_ITEMS.map((item) => (
						<Link
							key={item.label}
							to={toWorkspacePath(item.to, workspaceSlug)}
							className="rounded-md px-2 py-1 text-[14px] font-semibold text-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							{item.label}
						</Link>
					))}
				</nav>

				{isLoading ? (
					<div className="hidden h-9 w-52 animate-pulse rounded-md bg-muted md:block" />
				) : isAuthenticated ? (
					<GlobalSearchBar
						className={`hidden min-w-0 flex-1 transition-all duration-200 md:block ${
							searchExpanded ? "max-w-full" : "max-w-[220px] lg:max-w-[300px]"
						}`}
						onExpandedChange={setSearchExpanded}
					/>
				) : (
					<span />
				)}
			</div>

			<div className="flex shrink-0 items-center gap-2 sm:gap-3">
				{isLoading ? (
					<div className="flex items-center gap-2 sm:gap-3">
						<div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
						<div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
						<div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
					</div>
				) : isAuthenticated ? (
					<>
						<Link
							to="/inbox"
							search={{ r: undefined }}
							className="flex items-center justify-center rounded-full p-2 text-foreground transition-colors hover:bg-muted"
							aria-label="Messages"
						>
							<MessageCircle size={20} />
						</Link>

						<NotificationBell />

						<UserMenu />
					</>
				) : (
					<>
						<Link to="/auth/login">
							<Button variant="outlined" colorScheme="primary">
								Login
							</Button>
						</Link>
						<Link to="/auth/signup">
							<Button variant="contained" colorScheme="primary">
								Sign Up
							</Button>
						</Link>
					</>
				)}
			</div>

			{isAuthenticated && (
				<MobileNavDrawer
					isOpen={mobileNavOpen}
					onClose={() => setMobileNavOpen(false)}
				/>
			)}
		</div>
	);
};

export default DashboardHeader;
