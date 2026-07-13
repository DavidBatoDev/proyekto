import { Badge, Divider, Menu, MenuItem } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { type MouseEvent, useState } from "react";
import { openProjectInviteModal } from "@/components/invites/projectInviteModalEvents";
import { useNotificationsRealtime } from "@/hooks/useNotificationsRealtime";
import { notificationsService } from "@/services/notifications.service";
import { useAuthStore } from "@/stores/authStore";

function notificationTitle(typeName?: string) {
	if (typeName === "project_invite_received") return "New project invite";
	if (typeName === "project_invite_responded") return "Invite response";
	if (typeName === "marketplace_profile_live") return "Profile is live";
	if (typeName === "task_assigned") return "Task assigned";
	if (typeName === "time_log_approval_requested")
		return "Time approval requested";
	if (typeName === "time_log_approved") return "Time log approved";
	if (typeName === "time_log_rejected") return "Time log rejected";
	if (typeName === "time_log_pending") return "Time log reset to pending";
	if (typeName === "time_log_day_rejected") return "Daily logs rejected";
	if (typeName === "time_log_comment_added") return "Time log comment";
	if (typeName === "chat_mention") return "Mention";
	if (typeName === "task_comment_mention") return "Mentioned in task";
	if (typeName === "feature_comment_mention") return "Mentioned in feature";
	if (typeName === "epic_comment_mention") return "Mentioned in epic";
	return "Notification";
}

function notificationBody(content: Record<string, unknown> | null | undefined) {
	const messageValue = content?.message;
	if (typeof messageValue === "string" && messageValue.trim())
		return messageValue;
	const reasonValue = content?.reason;
	if (typeof reasonValue === "string" && reasonValue.trim())
		return `Reason: ${reasonValue}`;
	const dayValue = content?.day;
	if (typeof dayValue === "string" && dayValue.trim())
		return `Day: ${dayValue}`;
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

export function NotificationBell() {
	const { isAuthenticated, profile } = useAuthStore();
	const queryClient = useQueryClient();
	const [notificationAnchor, setNotificationAnchor] =
		useState<HTMLElement | null>(null);

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
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["notifications"] });
		},
	});

	const markAllReadMutation = useMutation({
		mutationFn: () => notificationsService.markAllRead(),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["notifications"] });
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
			const resolved =
				linkUrl === "/freelancer/profile" && profile?.id
					? `/profile/${profile.id}`
					: linkUrl;
			window.location.href = resolved;
		}
	};

	if (!isAuthenticated) return null;

	return (
		<>
			<button
				type="button"
				className="flex items-center justify-center rounded-full p-2 text-foreground transition-colors hover:bg-muted"
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
						color: "var(--popover-foreground)",
						backgroundColor: "var(--popover)",
						border: "1px solid var(--border)",
						boxShadow: "var(--app-shadow-lg)",
						overflow: "hidden",
					},
				}}
			>
				<div className="flex items-center justify-between px-4 py-3">
					<p className="text-[0.95rem] font-bold text-popover-foreground">
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
				<Divider sx={{ borderColor: "var(--border)" }} />

				{recentNotifications.length === 0 ? (
					<div className="px-4 py-8 text-center text-sm text-muted-foreground">
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
										typeof inviteIdValue === "string" ? inviteIdValue : null,
									)
								}
								sx={{
									display: "flex",
									alignItems: "flex-start",
									whiteSpace: "normal",
									backgroundColor: notification.is_read
										? "transparent"
										: "color-mix(in oklch, var(--primary) 10%, var(--popover))",
									borderBottom: "1px solid var(--border)",
									color: "var(--popover-foreground)",
									py: 1.5,
									px: 2,
									"&:hover": {
										backgroundColor:
											"color-mix(in oklch, var(--primary) 14%, var(--popover))",
									},
								}}
							>
								<div className="flex-1 pr-2">
									<p
										className={`text-[0.85rem] ${
											notification.is_read
												? "font-medium text-muted-foreground"
												: "font-bold text-popover-foreground"
										}`}
									>
										{title}
									</p>
									<p
										className={`mt-0.5 text-[0.8rem] ${
											notification.is_read
												? "font-normal text-muted-foreground"
												: "font-medium text-popover-foreground"
										}`}
									>
										{message}
									</p>
									<p className="mt-1 text-[0.75rem] text-muted-foreground">
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

				<Divider sx={{ borderColor: "var(--border)" }} />
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
		</>
	);
}
