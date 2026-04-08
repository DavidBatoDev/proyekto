import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, LogOut, ShieldCheck, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTutorial } from "@/contexts/TutorialContext";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { switchPersona } from "@/lib/auth-api";
import { profileKeys } from "@/queries/profile";
import { adminService } from "@/services/admin.service";
import { useAuthStore } from "@/stores/authStore";

type PersonaKey = "client" | "freelancer" | "consultant";

export default function UserMenu() {
	const [isOpen, setIsOpen] = useState(false);
	const [isChangingPersona, setIsChangingPersona] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const { data: profile } = useProfileQuery();
	const { user, signOut } = useAuthStore();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { isActive } = useTutorial();

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

	const getPersonaLabel = (persona: string) =>
		persona.charAt(0).toUpperCase() + persona.slice(1);

	const handlePersonaChange = async (newPersona: string) => {
		if (newPersona === profile?.active_persona) return;

		setIsChangingPersona(true);
		try {
			await switchPersona(newPersona as PersonaKey);

			if (profile?.id) {
				await queryClient.invalidateQueries({
					queryKey: profileKeys.byUser(profile.id),
				});
			}

			setIsOpen(false);
		} catch (error: unknown) {
			console.error("Failed to change persona:", error);
			const apiMessage =
				typeof error === "object" && error !== null && "response" in error
					? (
							error as {
								response?: { data?: { error?: { message?: string } } };
							}
						).response?.data?.error?.message
					: undefined;
			const fallbackMessage =
				error instanceof Error ? error.message : "Failed to change persona";
			alert(fallbackMessage || apiMessage || "Failed to change persona");
		} finally {
			setIsChangingPersona(false);
		}
	};

	const handleLogout = async () => {
		await signOut();
		setIsOpen(false);
		navigate({ to: "/" });
	};

	const getAvailablePersonas = () => {
		const personas: PersonaKey[] = ["freelancer", "client"];
		if (profile?.is_consultant_verified) {
			personas.push("consultant");
		}
		return personas;
	};

	const getDropdownStyle = () => {
		if (!isActive || !buttonRef.current) {
			return {
				zIndex: 10003,
				position: "absolute" as const,
				top: "100%",
				right: 0,
			};
		}

		const buttonRect = buttonRef.current.getBoundingClientRect();
		return {
			zIndex: 10003,
			position: "fixed" as const,
			top: buttonRect.bottom + 8,
			right: window.innerWidth - buttonRect.right,
		};
	};

	return (
		<div className="relative overflow-visible" ref={dropdownRef}>
			<button
				type="button"
				ref={buttonRef}
				onClick={() => setIsOpen(!isOpen)}
				data-tutorial="user-menu"
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
						{getPersonaLabel(profile?.active_persona || "client")}
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
					className="w-64 rounded-xl border border-slate-200 bg-white py-2 shadow-[0_16px_34px_rgba(15,23,42,0.14)]"
					style={getDropdownStyle()}
				>
					{isChangingPersona && (
						<div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/85 backdrop-blur-sm">
							<div className="flex flex-col items-center gap-3">
								<div className="relative">
									<div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-slate-600" />
									<div className="absolute inset-0 animate-ping rounded-full bg-slate-400/20" />
								</div>
								<span className="animate-pulse text-sm font-semibold text-slate-800">
									Switching persona...
								</span>
							</div>
						</div>
					)}

					<div className="border-b border-slate-100 px-4 py-3">
						<p className="text-sm font-semibold text-slate-900">
							{getDisplayName()}
						</p>
						<p className="truncate text-xs text-slate-500">{profile?.email}</p>
					</div>

					<div className="border-b border-slate-100 px-4 py-3">
						<p className="mb-2 text-xs font-semibold text-slate-700">
							Switch Persona
						</p>
						<div className="space-y-1">
							{getAvailablePersonas().map((persona) => (
								<button
									type="button"
									key={persona}
									onClick={() => handlePersonaChange(persona)}
									disabled={
										isChangingPersona || persona === profile?.active_persona
									}
									className={`w-full cursor-pointer rounded-md px-3 py-2 text-left text-sm transition-colors ${
										persona === profile?.active_persona
											? "bg-slate-100 font-medium text-slate-800"
											: "text-slate-700 hover:bg-slate-50"
									} ${isChangingPersona ? "cursor-not-allowed opacity-50" : ""}`}
								>
									{getPersonaLabel(persona)}
									{persona === profile?.active_persona && (
										<span className="ml-2 text-xs">Active</span>
									)}
								</button>
							))}
						</div>
					</div>

					<div className="py-1">
						{isAdmin && (
							<>
								<Link
									to="/admin/applications"
									onClick={() => setIsOpen(false)}
									className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm font-semibold text-amber-600 transition-colors hover:bg-amber-50"
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
