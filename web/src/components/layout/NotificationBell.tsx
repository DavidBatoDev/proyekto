import { Badge, Menu, MenuItem } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { type MouseEvent, useState } from "react";
import { useNotificationsRealtime } from "@/hooks/useNotificationsRealtime";
import { isNotificationShownInApp } from "@/lib/appNotifications";
import { notificationBody, notificationLabel } from "@/lib/notificationLabels";
import { openNotificationTarget } from "@/lib/notificationNavigation";
import { isNativeApp } from "@/lib/platform";
import {
	type NotificationItem,
	notificationsService,
} from "@/services/notifications.service";
import { useAuthStore } from "@/stores/authStore";

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
		// Realtime is the primary path, but it is the transport that fails
		// SILENTLY — a laptop that slept through a disconnect would otherwise
		// show a stale zero forever. staleTime keeps tab-switching from
		// hammering the API.
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
	});

	const recentNotificationsQuery = useQuery({
		queryKey: ["notifications", "recent"],
		queryFn: () => notificationsService.list({ limit: 20 }),
		enabled: isAuthenticated,
		staleTime: 30 * 1000,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
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
	const recentNotifications = (recentNotificationsQuery.data || []).filter(
		(notification) => isNotificationShownInApp(notification, isNativeApp()),
	);

	const openNotifications = (event: MouseEvent<HTMLElement>) => {
		setNotificationAnchor(event.currentTarget);
	};

	const closeNotifications = () => {
		setNotificationAnchor(null);
	};

	const handleNotificationClick = (notification: NotificationItem) => {
		closeNotifications();
		markReadMutation.mutate(notification.id);
		openNotificationTarget(notification, profile?.id);
	};

	if (!isAuthenticated) return null;

	return (
		<>
			<button
				type="button"
				className="flex items-center justify-center rounded-full p-2 text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
				aria-label="Notifications"
				onClick={openNotifications}
			>
				<Badge
					badgeContent={unreadCount > 99 ? "99+" : unreadCount}
					color="primary"
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
						// MUI caps the paper at the viewport; scroll inside it so the
						// footer link is never clipped on short screens.
						maxHeight: "min(560px, calc(100vh - 96px))",
						overflowY: "auto",
					},
				}}
			>
				<div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-popover px-4 py-3">
					<p className="text-[0.95rem] font-bold text-popover-foreground">
						Notifications
					</p>
					<button
						type="button"
						onClick={() => markAllReadMutation.mutate()}
						className="rounded-sm text-xs font-semibold text-primary transition-opacity hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
						disabled={markAllReadMutation.isPending || unreadCount === 0}
					>
						Mark all read
					</button>
				</div>

				{recentNotifications.length === 0 ? (
					<div className="px-4 py-8 text-center text-sm text-muted-foreground">
						No notifications yet.
					</div>
				) : (
					recentNotifications.map((notification) => {
						const title = notificationLabel(notification.type?.name);
						const message = notificationBody(notification.content ?? null);

						return (
							<MenuItem
								key={notification.id}
								onClick={() => handleNotificationClick(notification)}
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
									<span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-primary shadow-sm shadow-primary/50" />
								)}
							</MenuItem>
						);
					})
				)}

				<div className="sticky bottom-0 z-10 border-t border-border bg-popover px-4 py-2">
					<Link
						to="/notifications"
						className="rounded-sm text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
						onClick={closeNotifications}
					>
						View all notifications
					</Link>
				</div>
			</Menu>
		</>
	);
}
