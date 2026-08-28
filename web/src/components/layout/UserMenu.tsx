import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
	ChevronDown,
	Compass,
	LogOut,
	Settings,
	ShieldCheck,
	User,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { replayProductTour } from "@/components/tour/tourEvents";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { isActiveConsultant } from "@/lib/auth-utils";
import { resolveTourForPath } from "@/lib/tours/registry";
import { adminService } from "@/services/admin.service";
import { useAuthStore } from "@/stores/authStore";

export default function UserMenu() {
	const [isOpen, setIsOpen] = useState(false);
	// The entry only appears on surfaces that actually register a tour, so it
	// lights up on new pages automatically as tours are added to the registry.
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const tourForSurface = resolveTourForPath(pathname);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const { data: profile } = useProfileQuery();
	const { user, signOut } = useAuthStore();
	const navigate = useNavigate();

	const { data: adminProfile } = useQuery({
		queryKey: ["adminMe"],
		queryFn: () => adminService.getMe(),
		enabled: !!user?.id,
		staleTime: 1000 * 60 * 5,
		retry: false,
	});
	const isAdmin = !!adminProfile;

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				dropdownRef.current &&
				!dropdownRef.current.contains(event.target as Node)
			) {
				setIsOpen(false);
			}
		};

		if (isOpen) {
			document.addEventListener("mousedown", handleClickOutside);
		}

		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, [isOpen]);

	const getDisplayName = () => {
		if (profile?.display_name) return profile.display_name;
		if (profile?.first_name) {
			return `${profile.first_name} ${profile.last_name || ""}`.trim();
		}
		return profile?.email?.split("@")[0] || "User";
	};

	const handleLogout = async () => {
		await signOut();
		setIsOpen(false);
		navigate({ to: "/" });
	};
	const accountLabel = isActiveConsultant(profile)
		? "Verified consultant"
		: "Member";

	return (
		<div className="relative overflow-visible" ref={dropdownRef}>
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				data-tutorial="user-menu"
				className="flex cursor-pointer items-center gap-2 rounded-xl border border-(--app-border) bg-(--app-surface) px-2 py-1.5 backdrop-blur-md transition-colors hover:bg-(--app-muted-surface)"
				aria-label="User menu"
			>
				{profile?.avatar_url ? (
					<img
						src={profile.avatar_url}
						alt={getDisplayName()}
						className="h-8 w-8 rounded-full border border-slate-300 object-cover"
					/>
				) : (
					<div className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 bg-linear-to-br from-slate-800 to-slate-900 text-sm font-semibold text-white">
						{getDisplayName().charAt(0).toUpperCase()}
					</div>
				)}

				<div className="hidden flex-col items-start leading-tight sm:flex">
					<span className="max-w-30 truncate text-sm font-semibold text-slate-900">
						{getDisplayName()}
					</span>
					<span className="text-xs font-medium text-slate-500">
						{accountLabel}
					</span>
				</div>

				<ChevronDown
					size={16}
					className={`text-slate-600 transition-transform ${isOpen ? "rotate-180" : ""}`}
				/>
			</button>

			{isOpen && (
				<div
					data-tutorial="user-menu-dropdown"
					className="absolute right-0 top-full w-64 rounded-xl border border-(--app-border) bg-(--app-surface-strong) py-2 shadow-(--app-shadow-md) backdrop-blur-md"
					style={{ zIndex: 10003 }}
				>
					<div className="border-b border-slate-100 px-4 py-3">
						<p className="truncate text-sm font-semibold text-slate-900">
							{getDisplayName()}
						</p>
						<p className="truncate text-xs text-slate-500">{profile?.email}</p>
					</div>

					<div className="py-1">
						{isAdmin && (
							<>
								<Link
									to="/admin/applications"
									onClick={() => setIsOpen(false)}
									className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-100"
								>
									<ShieldCheck size={16} />
									Admin Dashboard
								</Link>
								<div className="my-1 border-t border-slate-100" />
							</>
						)}

						<Link
							to="/profile/$profileId"
							params={{ profileId: user?.id || "" }}
							onClick={() => setIsOpen(false)}
							className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
						>
							<User size={16} />
							Profile
						</Link>

						{/* One door for account settings - appearance, notifications and
						    MCP access are sections of /settings, not menu rows. */}
						<Link
							to="/settings"
							onClick={() => setIsOpen(false)}
							className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted"
						>
							<Settings size={16} />
							Settings
						</Link>

						{tourForSurface && (
							<button
								type="button"
								onClick={() => {
									setIsOpen(false);
									replayProductTour(tourForSurface.key);
								}}
								className="flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted"
							>
								<Compass size={16} />
								Replay product tour
							</button>
						)}

						<button
							type="button"
							onClick={handleLogout}
							className="flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
						>
							<LogOut size={16} />
							Logout
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
