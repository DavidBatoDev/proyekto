import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowLeftRight,
	ChevronDown,
	KeyRound,
	Loader2,
	LogOut,
	Settings,
	ShieldCheck,
	User,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { featureFlags } from "@/config/featureFlags";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { switchPersona } from "@/lib/auth-api";
import { extractApiErrorMessage } from "@/lib/permissionErrors";
import { adminService } from "@/services/admin.service";
import { useAuthStore } from "@/stores/authStore";

export default function UserMenu() {
	const [isOpen, setIsOpen] = useState(false);
	const [switching, setSwitching] = useState(false);
	const [switchError, setSwitchError] = useState<string | null>(null);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const { data: profile } = useProfileQuery();
	const { user, signOut, setProfile } = useAuthStore();
	const navigate = useNavigate();
	const qc = useQueryClient();

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
		} else {
			setSwitchError(null);
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
		setSwitchError(null);
		navigate({ to: "/" });
	};

	const handleSwitchPersona = async () => {
		if (!profile || switching) return;
		const target =
			profile.active_persona === "consultant" ? "freelancer" : "consultant";
		setSwitching(true);
		setSwitchError(null);
		try {
			const { data } = await switchPersona(target);
			setProfile(data);
			// Patch both caches immediately so useProfileQuery never
			// overwrites Zustand with a stale active_persona.
			qc.setQueryData(["profile", user?.id ?? ""], (old: any) =>
				old ? { ...old, active_persona: data.active_persona } : old,
			);
			setIsOpen(false);
			navigate({ to: "/dashboard" });
		} catch (err: any) {
			const msg = extractApiErrorMessage(
				err?.response?.data,
				err?.message ?? "Switch failed. Try again.",
			);
			setSwitchError(msg);
		} finally {
			setSwitching(false);
		}
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

				<div className="hidden flex-col items-start leading-tight sm:flex">
					<span className="max-w-30 truncate text-sm font-semibold text-slate-900">
						{getDisplayName()}
					</span>
					{profile?.active_persona && profile.active_persona !== "admin" && (
						<span className="text-xs font-medium capitalize text-slate-500">
							{profile.active_persona}
						</span>
					)}
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
						<div className="flex items-center justify-between gap-2">
							<p className="text-sm font-semibold text-slate-900 truncate">
								{getDisplayName()}
							</p>
							{profile?.active_persona &&
								profile.active_persona !== "admin" && (
									<span
										className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
											profile.active_persona === "consultant"
												? "bg-teal-50 text-teal-700 border border-teal-200"
												: profile.active_persona === "freelancer"
													? "bg-orange-50 text-orange-600 border border-orange-200"
													: "bg-gray-100 text-gray-600 border border-gray-200"
										}`}
									>
										{profile.active_persona}
									</span>
								)}
						</div>
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

						{profile &&
							(profile.active_persona === "consultant" ||
								(profile.active_persona === "freelancer" &&
									profile.is_consultant_verified)) && (
								<>
									<button
										type="button"
										onClick={handleSwitchPersona}
										disabled={switching}
										className="flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
									>
										{switching ? (
											<Loader2 size={16} className="animate-spin" />
										) : (
											<ArrowLeftRight size={16} />
										)}
										Switch to{" "}
										{profile.active_persona === "consultant"
											? "Freelancer"
											: "Consultant"}
									</button>
									{switchError && (
										<div className="mx-4 mb-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
											<p className="text-xs text-red-600">{switchError}</p>
											{profile?.active_persona === "consultant" && (
												<Link
													to="/freelancer/go-live"
													onClick={() => setIsOpen(false)}
													className="mt-1 inline-block text-xs font-semibold text-[#ff9933] hover:underline"
												>
													Complete freelancer profile →
												</Link>
											)}
										</div>
									)}
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

						{featureFlags.themeSystem && (
							<Link
								to="/settings/appearance"
								onClick={() => setIsOpen(false)}
								className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted"
							>
								<Settings size={16} />
								Appearance
							</Link>
						)}

						<Link
							to="/settings/mcp-tokens"
							onClick={() => setIsOpen(false)}
							className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted"
						>
							<KeyRound size={16} />
							MCP Tokens
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
