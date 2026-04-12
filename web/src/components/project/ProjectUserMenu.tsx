import { Link, useNavigate } from "@tanstack/react-router";
import { Briefcase, ChevronDown, LogOut, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { useAuthStore } from "@/stores/authStore";

interface ProjectUserMenuProps {
	role?: string;
}

export default function ProjectUserMenu({ role }: ProjectUserMenuProps) {
	const [isOpen, setIsOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const { data: profile } = useProfileQuery();
	const { user, signOut } = useAuthStore();
	const navigate = useNavigate();

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

	const getPersonaLabel = (persona: string) =>
		persona.charAt(0).toUpperCase() + persona.slice(1);

	const handleLogout = async () => {
		await signOut();
		setIsOpen(false);
		navigate({ to: "/" });
	};

	return (
		<div className="relative overflow-visible" ref={dropdownRef}>
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5 transition-colors hover:bg-slate-50"
				aria-label="User menu"
			>
				{profile?.avatar_url ? (
					<img
						src={profile.avatar_url}
						alt={getDisplayName()}
						className="h-8 w-8 rounded-full border border-amber-400 object-cover"
					/>
				) : (
					<div className="flex h-8 w-8 items-center justify-center rounded-full border border-amber-400 bg-linear-to-br from-amber-400 to-amber-500 text-sm font-medium text-white">
						{getDisplayName().charAt(0).toUpperCase()}
					</div>
				)}

				<div className="flex flex-col items-start leading-tight">
					<span className="max-w-[120px] truncate text-sm font-semibold text-slate-900">
						{getDisplayName()}
					</span>
					<span className="text-[10px] text-slate-500">
						{role
							? getPersonaLabel(role.toLowerCase())
							: getPersonaLabel(profile?.active_persona || "client")}
					</span>
				</div>

				<ChevronDown
					size={16}
					className={`text-slate-600 transition-transform ${isOpen ? "rotate-180" : ""}`}
				/>
			</button>

			{isOpen && (
				<div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-slate-200 bg-white py-2 shadow-[0_16px_34px_rgba(15,23,42,0.14)]">
					<div className="border-b border-slate-100 px-4 py-3">
						<p className="text-sm font-semibold text-slate-900">
							{getDisplayName()}
						</p>
						<p className="truncate text-xs text-slate-500">{profile?.email}</p>
					</div>

					<div className="py-2">
						<Link
							to="/dashboard"
							onClick={() => setIsOpen(false)}
							className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Briefcase size={16} />
							Return to Dashboard
						</Link>

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
