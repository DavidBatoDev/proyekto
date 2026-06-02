import { Link } from "@tanstack/react-router";
import { MessageCircle, Search } from "lucide-react";
import { useAuthStore, useIsLoading } from "@/stores/authStore";
import { Button } from "@/ui/button";
import { BrandMark } from "@/components/brand/BrandMark";
import { NotificationBell } from "./NotificationBell";
import UserMenu from "./UserMenu";

const DashboardHeader = () => {
	const { isAuthenticated, profile } = useAuthStore();
	const isAuthLoading = useIsLoading();
	const isLoading = isAuthLoading || (isAuthenticated && !profile);

	const navItems = [
		{ label: "Home", to: "/dashboard" },
		{ label: "Projects", to: "/dashboard", hash: "my-projects" },
	];

	return (
		<div className="z-10 flex h-full w-full items-center justify-between px-4 sm:px-6">
			<div className="flex min-w-0 items-center gap-3 sm:gap-4">
				<Link
					to="/"
					className="flex shrink-0 items-center border-r border-slate-200 pr-3 sm:pr-4"
				>
					<BrandMark variant="mark" className="h-6 text-white" />
				</Link>

				<nav className="hidden items-center gap-2 lg:flex">
					{navItems.map((item) => (
						<Link
							key={item.label}
							to={item.to}
							hash={item.hash}
							className="rounded-md px-2 py-1 text-[14px] font-semibold text-slate-800 transition-colors hover:bg-slate-100 hover:text-slate-900"
						>
							{item.label}
						</Link>
					))}
				</nav>
			</div>

			<div className="flex shrink-0 items-center gap-2 sm:gap-3">
				{isLoading ? (
					<div className="flex items-center gap-2 sm:gap-3">
						<div className="hidden h-9 w-52 animate-pulse rounded-2xl bg-slate-200 md:block" />
						<div className="h-9 w-9 animate-pulse rounded-full bg-slate-200" />
						<div className="h-9 w-9 animate-pulse rounded-full bg-slate-200" />
						<div className="h-9 w-9 animate-pulse rounded-full bg-slate-200" />
					</div>
				) : isAuthenticated ? (
					<>
						<div className="hidden min-w-[220px] items-center rounded-2xl border border-slate-200 bg-slate-100/80 px-3 py-1.5 transition-all duration-200 hover:bg-slate-100 focus-within:bg-white focus-within:ring-2 focus-within:ring-slate-200 md:flex lg:min-w-[300px]">
							<Search size={17} className="mr-2 shrink-0 text-slate-500" />
							<input
								type="text"
								placeholder="Search..."
								className="min-w-0 flex-1 border-none bg-transparent text-[0.85rem] text-slate-800 placeholder-slate-400 focus:outline-none"
							/>
						</div>

						<button
							type="button"
							className="flex items-center justify-center rounded-full p-2 text-slate-700 transition-colors hover:bg-slate-100"
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
		</div>
	);
};

export default DashboardHeader;
