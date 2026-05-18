import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, LogOut, ShieldCheck, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { adminService } from "@/services/admin.service";
import { useAuthStore } from "@/stores/authStore";

export default function UserMenu() {
	const [isOpen, setIsOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
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

	const getDropdownStyle = () => ({
		zIndex: 10003,
		position: "absolute" as const,
		top: "100%",
		right: 0,
	});

	return (
		<div className="relative overflow-visible" ref={dropdownRef}>
			<button
				type="button"
				ref={buttonRef}
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

				<div className="flex flex-col items-start leading-tight">
					<span className="max-w-[120px] truncate text-sm font-semibold text-slate-900">
						{getDisplayName()}
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
					className="w-64 rounded-xl border border-(--app-border) bg-(--app-surface-strong) py-2 shadow-(--app-shadow-md) backdrop-blur-md"
					style={getDropdownStyle()}
				>
					<div className="border-b border-slate-100 px-4 py-3">
						<p className="text-sm font-semibold text-slate-900">
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
