import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
	BookOpen,
	ClipboardList,
	LayoutDashboard,
	ListChecks,
	Map,
	MessageSquare,
	MoreHorizontal,
	ReceiptText,
	Settings,
	Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { chatKeys, fetchProjectChatRooms } from "@/queries/chat";
import type { ChatRoom } from "@/services/chat.service";
import { useUser } from "@/stores/authStore";

interface ProjectBottomNavProps {
	projectId: string;
	hasProject?: boolean;
	roadmapId?: string;
}

export function ProjectBottomNav({
	projectId,
	hasProject,
	roadmapId,
}: ProjectBottomNavProps) {
	const routerState = useRouterState();
	const currentPath = routerState.location.pathname;
	const user = useUser();
	const [showMore, setShowMore] = useState(false);

	const roadmapIdFromPath =
		currentPath.match(/\/roadmap\/([^/]+)/)?.[1] ??
		currentPath.match(/\/work-items\/([^/]+)/)?.[1];
	const effectiveRoadmapId = roadmapId ?? roadmapIdFromPath;

	const isProjectActive = hasProject ?? true;

	const chatRoomsQuery = useQuery({
		queryKey: chatKeys.rooms(projectId),
		queryFn: () => fetchProjectChatRooms(projectId),
		enabled: Boolean(projectId && isProjectActive),
		staleTime: 15 * 1000,
		refetchOnWindowFocus: true,
		retry: 1,
	});

	const hasUnreadChat = useMemo(() => {
		const rooms = chatRoomsQuery.data ?? [];
		const currentUserId = user?.id;

		const roomHasUnread = (room: ChatRoom): boolean => {
			if (typeof room.has_unread === "boolean") return room.has_unread;
			if (!room.last_message) return false;
			const viewerLastReadAt =
				room.viewer_last_read_at ??
				room.participants.find((p) => p.user_id === currentUserId)
					?.last_read_at ??
				null;
			if (!viewerLastReadAt) {
				return currentUserId
					? room.last_message.sender_id !== currentUserId
					: true;
			}
			return (
				new Date(room.last_message.created_at).getTime() >
				new Date(viewerLastReadAt).getTime()
			);
		};

		return rooms.some(roomHasUnread);
	}, [chatRoomsQuery.data, user?.id]);

	const isChatRoute = currentPath.startsWith(`/project/${projectId}/chat`);

	const primaryItems = [
		{
			label: "Overview",
			icon: LayoutDashboard,
			to: `/project/${projectId}/overview`,
			isActive: currentPath.startsWith(`/project/${projectId}/overview`),
			requiresProject: true,
		},
		{
			label: "Roadmap",
			icon: Map,
			to: effectiveRoadmapId
				? `/project/${projectId}/roadmap/${effectiveRoadmapId}`
				: `/project/${projectId}/roadmap`,
			isActive: currentPath.includes("/roadmap"),
			requiresProject: false,
		},
		{
			label: "Work Items",
			icon: ListChecks,
			to: effectiveRoadmapId
				? `/project/${projectId}/work-items/${effectiveRoadmapId}`
				: `/project/${projectId}/work-items`,
			isActive: currentPath.includes("/work-items"),
			requiresProject: false,
		},
		{
			label: "Chat",
			icon: MessageSquare,
			to: `/project/${projectId}/chat/channel-general`,
			isActive: isChatRoute,
			requiresProject: true,
			hasUnread: hasUnreadChat && !isChatRoute,
		},
		{
			label: "Resources",
			icon: BookOpen,
			to: `/project/${projectId}/resources`,
			isActive: currentPath.startsWith(`/project/${projectId}/resources`),
			requiresProject: true,
		},
	];

	const moreItems = [
		{
			label: "Team",
			icon: Users,
			to: `/project/${projectId}/team`,
			isActive: currentPath.startsWith(`/project/${projectId}/team`),
		},
		{
			label: "Logs",
			icon: ClipboardList,
			to: `/project/${projectId}/logs`,
			isActive: currentPath.startsWith(`/project/${projectId}/logs`),
		},
		{
			label: "Invoices",
			icon: ReceiptText,
			to: `/project/${projectId}/payments`,
			isActive: currentPath.startsWith(`/project/${projectId}/payments`),
		},
		{
			label: "Settings",
			icon: Settings,
			to: `/project/${projectId}/settings/general`,
			isActive: currentPath.includes("/settings"),
		},
	];

	const visiblePrimary = primaryItems.filter(
		(item) => !item.requiresProject || isProjectActive,
	);

	const isMoreActive =
		isProjectActive && moreItems.some((item) => item.isActive);

	return (
		<>
			{/* ── Fixed bottom navigation bar ── */}
			<nav className="fixed bottom-0 left-0 right-0 z-50 flex h-app-nav items-stretch border-t border-sidebar-border bg-sidebar text-sidebar-foreground pb-safe backdrop-blur md:hidden">
				{visiblePrimary.map((item) => {
					const Icon = item.icon;
					return (
						<Link
							key={item.label}
							to={item.to}
							className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${
								item.isActive ? "text-primary" : "text-slate-400"
							}`}
						>
							{item.isActive && (
								<span className="absolute top-0 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-primary" />
							)}
							<div className="relative">
								<Icon className="h-5 w-5" />
								{item.hasUnread && (
									<span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#ff9933] ring-1 ring-white" />
								)}
							</div>
							<span className="text-[10px] font-medium leading-none">
								{item.label}
							</span>
						</Link>
					);
				})}

				{/* More button — only shown when project is active (more items require project) */}
				{isProjectActive && (
					<button
						type="button"
						onClick={() => setShowMore(true)}
						className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${
							isMoreActive ? "text-primary" : "text-slate-400"
						}`}
					>
						{isMoreActive && (
							<span className="absolute top-0 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-primary" />
						)}
						<MoreHorizontal className="h-5 w-5" />
						<span className="text-[10px] font-medium leading-none">More</span>
					</button>
				)}
			</nav>

			{/* ── More sheet ── */}
			<AnimatePresence>
				{showMore && (
					<>
						{/* Backdrop */}
						<motion.div
							key="more-backdrop"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0.2 }}
							className="fixed inset-0 z-50 bg-black/40 md:hidden"
							onClick={() => setShowMore(false)}
						/>

						{/* Sheet */}
						<motion.div
							key="more-sheet"
							initial={{ y: "100%" }}
							animate={{ y: 0 }}
							exit={{ y: "100%" }}
							transition={{ duration: 0.25, ease: "easeOut" }}
							className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-sidebar px-4 pb-app-sheet pt-4 text-sidebar-foreground md:hidden"
						>
							{/* Drag handle */}
							<div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-200" />

							<p className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
								More pages
							</p>

							<div className="grid grid-cols-4 gap-3">
								{moreItems.map((item) => {
									const Icon = item.icon;
									return (
										<Link
											key={item.label}
											to={item.to}
											onClick={() => setShowMore(false)}
											className="flex flex-col items-center gap-1.5"
										>
											<div
												className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
													item.isActive
														? "bg-primary text-white"
														: "bg-slate-100 text-slate-600"
												}`}
											>
												<Icon className="h-5 w-5" />
											</div>
											<span
												className={`text-[11px] font-medium ${
													item.isActive ? "text-primary" : "text-slate-600"
												}`}
											>
												{item.label}
											</span>
										</Link>
									);
								})}
							</div>
						</motion.div>
					</>
				)}
			</AnimatePresence>
		</>
	);
}
