import { Badge, Divider, Menu, MenuItem } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell, ChevronDown, MessageCircle, Search } from "lucide-react";
import { type MouseEvent, useState } from "react";
import { openProjectInviteModal } from "@/components/invites/projectInviteModalEvents";
import { useNotificationsRealtime } from "@/hooks/useNotificationsRealtime";
import { notificationsService } from "@/services/notifications.service";
import { useAuthStore, useIsLoading } from "@/stores/authStore";
import { Button } from "@/ui/button";
import { BrandMark } from "@/components/brand/BrandMark";
import UserMenu from "./UserMenu";

type HeaderMenuItem = {
	label: string;
	href: string;
	divider?: boolean;
};

type HeaderMenuConfig = {
	label: string;
	items: HeaderMenuItem[];
};

const DashboardHeader = () => {
	const { isAuthenticated, profile } = useAuthStore();
	const isAuthLoading = useIsLoading();
	const isLoading = isAuthLoading || (isAuthenticated && !profile);
	const [consultantsMenuOpen, setConsultantsMenuOpen] = useState(false);
	const [notificationAnchor, setNotificationAnchor] =
		useState<HTMLElement | null>(null);
	const queryClient = useQueryClient();

	useNotificationsRealtime(profile?.id);

	const unreadCountQuery = useQuery({
		queryKey: ["notifications", "unread-count"],
		queryFn: () => notificationsService.unreadCount(),
		enabled: isAuthenticated,
	});

	const recentNotificationsQuery = useQuery({
		queryKey: ["notifications", "recent"],
		queryFn: () => notificationsService.list({ limit: 5 }),
		enabled: isAuthenticated,
	});

	const markReadMutation = useMutation({
		mutationFn: (id: string) => notificationsService.markRead(id, true),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["notifications"] });
		},
	});

	const markAllReadMutation = useMutation({
		mutationFn: () => notificationsService.markAllRead(),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["notifications"] });
		},
	});

	const unreadCount = unreadCountQuery.data ?? 0;
	const recentNotifications = recentNotificationsQuery.data || [];

	const openNotifications = (event: MouseEvent<HTMLElement>) => {
		setNotificationAnchor(event.currentTarget);
	};

	const closeNotifications = () => {
		setNotificationAnchor(null);
	};

	const handleNotificationClick = (
		id: string,
		linkUrl?: string | null,
		typeName?: string,
		inviteId?: string | null,
	) => {
		if (!id) return;
		closeNotifications();

		if (typeName === "project_invite_received" && inviteId) {
			openProjectInviteModal(inviteId);
			markReadMutation.mutate(id);
			return;
		}

		markReadMutation.mutate(id);

		if (linkUrl) {
			window.location.href = linkUrl;
		}
	};

	const navItems = [
		{ label: "Home", to: "/dashboard" },
		{ label: "Projects", to: "/dashboard", hash: "my-projects" },
		{
			label: "Market place",
			to: profile?.is_consultant_verified
				? "/consultant/marketplace"
				: "/consultant/browse",
		},
		...(profile?.is_consultant_verified
			? [{ label: "Templates", to: "/consultant/templates" }]
			: []),
	];

	const getPersonaMenu = (): HeaderMenuConfig => {
		const persona = profile?.active_persona || "client";
		const isConsultantVerified = profile?.is_consultant_verified;

		// Shared CTA - only shown when not yet a verified consultant
		const applyItem: HeaderMenuItem[] = !isConsultantVerified
			? [
					{
						label: "Apply as Consultant",
						href: "/consultant/apply",
						divider: true,
					},
				]
			: [];

		switch (persona) {
			case "freelancer":
				return {
					label: "Mentorship",
					items: [
						profile?.is_public
							? { label: "You're Live", href: "/consultant/marketplace" }
							: {
									label: "Get Hired (I Want to Work)",
									href: "/freelancer/go-live",
								},
						{ label: "My Invites", href: "/freelancer/invites" },
						{ label: "Find a Mentor", href: "/mentors" },
						{ label: "My Applications", href: "/applications" },
						{ label: "Saved Mentors", href: "/saved-mentors" },
						...applyItem,
					],
				};
			case "consultant":
				return {
					label: "My Clients",
					items: [
						{
							label: "Private Freelancer Marketplace",
							href: "/consultant/marketplace",
						},
						{
							label: "Template Roadmaps",
							href: "/consultant/templates",
						},
						{ label: "Browse Opportunities", href: "/projects" },
						{ label: "My Clients", href: "/clients" },
						{ label: "Active Contracts", href: "/contracts" },
					],
				};
			default:
				return {
					label: "My Consultants",
					items: [
						{ label: "Post a Project", href: "/project-posting" },
						{
							label: "Browse Professional Consultants",
							href: "/consultant/browse",
						},
						{ label: "My Consultant Pool", href: "/consultant-pool" },
						{ label: "Direct Contacts", href: "/direct-contacts" },
						...applyItem,
					],
				};
		}
	};

	const menuConfig = getPersonaMenu();

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

					<div className="relative">
						<button
							type="button"
							onMouseEnter={() => setConsultantsMenuOpen(true)}
							onMouseLeave={() => setConsultantsMenuOpen(false)}
							className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[14px] font-semibold text-slate-800 transition-colors hover:bg-slate-100 hover:text-slate-900"
						>
							{menuConfig.label}
							<ChevronDown
								size={16}
								className={`text-slate-700 transition-transform ${
									consultantsMenuOpen ? "rotate-180" : "rotate-0"
								}`}
							/>
						</button>

						{consultantsMenuOpen && (
							<div
								className="absolute left-0 top-full z-[10004] pt-2"
								role="menu"
								aria-label={`${menuConfig.label} menu`}
								onMouseEnter={() => setConsultantsMenuOpen(true)}
								onMouseLeave={() => setConsultantsMenuOpen(false)}
							>
								<div className="min-w-[250px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_14px_32px_rgba(15,23,42,0.14)]">
									{menuConfig.items.map((item) => (
										<div key={item.label}>
											{item.divider && (
												<div className="mx-2 my-1 border-t border-slate-200" />
											)}
											<Link
												to={item.href}
												className="block rounded-lg px-3 py-2 text-[14px] font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
											>
												{item.label}
											</Link>
										</div>
									))}
								</div>
							</div>
						)}
					</div>
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

						<button
							type="button"
							className="flex items-center justify-center rounded-full p-2 text-slate-700 transition-colors hover:bg-slate-100"
							aria-label="Notifications"
							onClick={openNotifications}
						>
							<Badge
								badgeContent={unreadCount > 99 ? "99+" : unreadCount}
								color="error"
							>
								<Bell size={20} />
							</Badge>
						</button>

						<Menu
							anchorEl={notificationAnchor}
							open={Boolean(notificationAnchor)}
							onClose={closeNotifications}
							disableScrollLock
							PaperProps={{
								sx: {
									width: 360,
									maxWidth: "90vw",
									borderRadius: "12px",
									mt: 1,
									border: "1px solid #e2e8f0",
									boxShadow: "0 18px 40px rgba(15, 23, 42, 0.12)",
								},
							}}
						>
							<div className="flex items-center justify-between px-4 py-3">
								<p className="text-[0.95rem] font-bold text-slate-900">
									Notifications
								</p>
								<button
									type="button"
									onClick={() => markAllReadMutation.mutate()}
									className="text-xs font-semibold text-[#ff9933] transition-opacity hover:underline disabled:cursor-not-allowed disabled:opacity-60"
									disabled={markAllReadMutation.isPending || unreadCount === 0}
								>
									Mark all read
								</button>
							</div>
							<Divider />

							{recentNotifications.length === 0 ? (
								<div className="px-4 py-8 text-center text-sm text-slate-500">
									No notifications yet.
								</div>
							) : (
								recentNotifications.map((notification) => {
									const typeName = notification.type?.name;
									const title =
										typeName === "project_invite_received"
											? "New project invite"
											: typeName === "project_invite_responded"
												? "Invite response"
												: typeName === "marketplace_profile_live"
													? "Profile is live"
													: "Notification";

									const messageValue = notification.content?.message;
									const statusValue = notification.content?.status;
									const inviteIdValue = notification.content?.invite_id;
									const message =
										typeof messageValue === "string" && messageValue.trim()
											? messageValue
											: typeof statusValue === "string"
												? `Invite was ${statusValue}.`
												: "You have a new update.";

									return (
										<MenuItem
											key={notification.id}
											onClick={() =>
												handleNotificationClick(
													notification.id,
													notification.link_url,
													typeName,
													typeof inviteIdValue === "string"
														? inviteIdValue
														: null,
												)
											}
											sx={{
												display: "flex",
												alignItems: "flex-start",
												whiteSpace: "normal",
												backgroundColor: notification.is_read
													? "transparent"
													: "#fff8f3",
												borderBottom: "1px solid #f8fafc",
												py: 1.5,
												px: 2,
											}}
										>
											<div className="flex-1 pr-2">
												<p
													className={`text-[0.85rem] ${
														notification.is_read
															? "font-medium text-slate-600"
															: "font-bold text-slate-900"
													}`}
												>
													{title}
												</p>
												<p
													className={`mt-0.5 text-[0.8rem] ${
														notification.is_read
															? "font-normal text-slate-500"
															: "font-medium text-slate-700"
													}`}
												>
													{message}
												</p>
												<p className="mt-1 text-[0.75rem] text-slate-400">
													{new Date(notification.created_at).toLocaleString()}
												</p>
											</div>
											{!notification.is_read && (
												<span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-[#ff9933] shadow-[0_0_10px_rgba(255,153,51,0.55)]" />
											)}
										</MenuItem>
									);
								})
							)}

							<Divider />
							<div className="px-4 py-2">
								<Link
									to="/notifications"
									className="text-sm font-medium text-[#ff9933] hover:underline"
									onClick={closeNotifications}
								>
									View all notifications
								</Link>
							</div>
						</Menu>

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
