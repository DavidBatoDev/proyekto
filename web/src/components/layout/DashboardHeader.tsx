import { Link } from "@tanstack/react-router";
import { Menu, MessageCircle, Search } from "lucide-react";
import { useState } from "react";
import { useAuthStore, useIsLoading } from "@/stores/authStore";
import { Button } from "@/ui/button";
import { BrandMark } from "@/components/brand/BrandMark";
import { MobileNavDrawer } from "./MobileNavDrawer";
import { NotificationBell } from "./NotificationBell";
import UserMenu from "./UserMenu";

const DashboardHeader = () => {
	const { isAuthenticated, profile } = useAuthStore();
	const isAuthLoading = useIsLoading();
	const isLoading = isAuthLoading || (isAuthenticated && !profile);
	const [mobileNavOpen, setMobileNavOpen] = useState(false);

	const navItems = [
		{ label: "Home", to: "/dashboard" },
		{ label: "Projects", to: "/dashboard", hash: "my-projects" },
	];

	return (
		<div className="z-10 flex h-full w-full items-center justify-between px-4 sm:px-6">
			<div className="flex min-w-0 items-center gap-3 sm:gap-4">
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
					to="/"
					className="flex shrink-0 items-center border-r border-border pr-3 sm:pr-4"
				>
					<BrandMark variant="mark" className="h-6 text-white" />
				</Link>

				<nav className="hidden items-center gap-2 lg:flex">
					{navItems.map((item) => (
						<Link
							key={item.label}
							to={item.to}
							hash={item.hash}
							className="rounded-md px-2 py-1 text-[14px] font-semibold text-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							{item.label}
						</Link>
					))}
				</nav>
			</div>

			<div className="flex shrink-0 items-center gap-2 sm:gap-3">
				{isLoading ? (
					<div className="flex items-center gap-2 sm:gap-3">
						<div className="hidden h-9 w-52 animate-pulse rounded-2xl bg-muted md:block" />
						<div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
						<div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
						<div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
					</div>
				) : isAuthenticated ? (
					<>
						<div className="hidden min-w-[220px] items-center rounded-2xl border border-border bg-muted/80 px-3 py-1.5 transition-all duration-200 hover:bg-muted focus-within:bg-card focus-within:ring-2 focus-within:ring-border md:flex lg:min-w-[300px]">
							<Search size={17} className="mr-2 shrink-0 text-muted-foreground" />
							<input
								type="text"
								placeholder="Search..."
								className="min-w-0 flex-1 border-none bg-transparent text-[0.85rem] text-foreground placeholder:text-muted-foreground focus:outline-none"
							/>
						</div>

						<button
							type="button"
							className="flex items-center justify-center rounded-full p-2 text-foreground transition-colors hover:bg-muted"
							aria-label="Messages"
						>
							<MessageCircle size={20} />
						</button>

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
