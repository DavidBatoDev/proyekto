import { Badge, Divider, Menu, MenuItem } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell, MessageCircle, Search } from "lucide-react";
import { type MouseEvent, useState } from "react";
import { openProjectInviteModal } from "@/components/invites/projectInviteModalEvents";
import { useNotificationsRealtime } from "@/hooks/useNotificationsRealtime";
import { notificationsService } from "@/services/notifications.service";
import { useAuthStore, useIsLoading } from "@/stores/authStore";
import { Button } from "@/ui/button";
import { BrandMark } from "@/components/brand/BrandMark";
import UserMenu from "./UserMenu";

function notificationTitle(typeName?: string) {
	if (typeName === "project_invite_received") return "New project invite";
	if (typeName === "project_invite_responded") return "Invite response";
	if (typeName === "marketplace_profile_live") return "Profile is live";
	if (typeName === "task_assigned") return "Task assigned";
	if (typeName === "time_log_approval_requested") return "Time approval requested";
	if (typeName === "time_log_approved") return "Time log approved";
	if (typeName === "time_log_rejected") return "Time log rejected";
	if (typeName === "time_log_pending") return "Time log reset to pending";
	if (typeName === "time_log_day_rejected") return "Daily logs rejected";
	if (typeName === "time_log_comment_added") return "Time log comment";
	return "Notification";
}

function notificationBody(content: Record<string, unknown> | null | undefined) {
	const messageValue = content?.message;
	if (typeof messageValue === "string" && messageValue.trim()) {
		return messageValue;
	}
	const reasonValue = content?.reason;
	if (typeof reasonValue === "string" && reasonValue.trim()) {
		return `Reason: ${reasonValue}`;
	}
	const dayValue = content?.day;
	if (typeof dayValue === "string" && dayValue.trim()) {
		return `Day: ${dayValue}`;
	}
	const statusValue = content?.status;
	if (typeof statusValue === "string") {
		if (statusValue === "approved") return "Your logged time was approved.";
		if (statusValue === "rejected") return "Your logged time was rejected.";
		if (statusValue === "pending")
			return "A time log was moved back to pending.";
		return `Invite was ${statusValue}.`;
	}
	return "You have a new update.";
}

const DashboardHeader = () => {
	const { isAuthenticated, profile } = useAuthStore();
	const isAuthLoading = useIsLoading();
	const isLoading = isAuthLoading || (isAuthenticated && !profile);
	const [notificationAnchor, setNotificationAnchor] =
		useState<HTMLElement | null>(null);
	const queryClient = useQueryClient();

	useNotificationsRealtime(profile?.id);

	const unreadCountQuery = useQuery({
		queryKey: ["notifications", "unread-count"],
		queryFn: () => notificationsService.unreadCount(),
		enabled: isAuthenticated,
		staleTime: 30 * 1000,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const recentNotificationsQuery = useQuery({
		queryKey: ["notifications", "recent"],
		queryFn: () => notificationsService.list({ limit: 5 }),
		enabled: isAuthenticated,
		staleTime: 30 * 1000,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
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
									const title = notificationTitle(typeName);

									const inviteIdValue = notification.content?.invite_id;
									const message = notificationBody(notification.content ?? null);

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
