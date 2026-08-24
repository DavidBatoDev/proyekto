import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, FolderKanban } from "lucide-react";
import { useMemo, useState } from "react";
import { useDashboardProjectsQuery } from "@/hooks/useDashboardProjectsQuery";
import { useProjectMyPermissionsQuery } from "@/hooks/useProjectQueries";
import { hasNavGate } from "@/lib/projectPermissions";
import { chatKeys, fetchProjectChatRooms } from "@/queries/chat";
import type { ChatRoom } from "@/services/chat.service";
import type { Project } from "@/services/project.service";
import { useUser } from "@/stores/authStore";
import {
	buildProjectNavSections,
	createProjectNavItems,
} from "./projectNavItems";

interface ProjectSidebarProps {
	project: Project | null;
	projectId: string;
	hasProject?: boolean;
	/** The id of the roadmap linked to this project, if any */
	roadmapId?: string;
}

export function ProjectSidebar({
	project,
	projectId,
	hasProject,
	roadmapId,
}: ProjectSidebarProps) {
	const routerState = useRouterState();
	const currentPath = routerState.location.pathname;
	const user = useUser();

	// Fallback: extract roadmapId from current URL when it isn't passed as prop
	// (e.g. projectId="n" skips the getByProjectId lookup in the parent layout)
	const roadmapIdFromPath =
		currentPath.match(/\/roadmap\/([^/]+)/)?.[1] ??
		currentPath.match(/\/timeline\/([^/]+)/)?.[1] ??
		currentPath.match(/\/work-items\/([^/]+)/)?.[1];
	const effectiveRoadmapId = roadmapId ?? roadmapIdFromPath;

	const [isExpanded, setIsExpanded] = useState(false);
	const [projectsOpen, setProjectsOpen] = useState(false);

	const projectsQuery = useDashboardProjectsQuery();
	const allProjects = (projectsQuery.data as Project[] | undefined) ?? [];

	// If we're on a project route (like /project/.../overview), we should show tabs.
	// We can assume it's a project if `hasProject` is strictly true or false,
	// OR if we're not inside the roadmap view and we have a project object or are loading one.
	const isRoadmapView = currentPath.includes("/roadmap");
	const isProjectActive = hasProject ?? (!isRoadmapView || project !== null);
	const isChatRoute = currentPath.includes(`/project/${projectId}/chat`);
	// Drives which nav items are visible — without this the sidebar advertises
	// sections that only lead to a permission-denied banner.
	const permissionsQuery = useProjectMyPermissionsQuery(
		isProjectActive ? projectId : "",
	);
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
				room.participants.find(
					(participant) => participant.user_id === currentUserId,
				)?.last_read_at ??
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

	const navSections = buildProjectNavSections({
		projectId,
		roadmapId: effectiveRoadmapId,
	});
	// Settings and Time hang off the gear pinned to the bottom of the rail
	// rather than sitting inline as peers of the delivery pages.
	const gearItems = createProjectNavItems({ projectId });

	const visibleSections = navSections
		.map((section) => ({
			...section,
			items: section.items.filter((item) => {
				if (item.requiresProject && !isProjectActive) return false;
				// hasNavGate fails open until permissions land — hiding then
				// revealing items reads as a glitch, and each route gates itself.
				return hasNavGate(permissionsQuery.data, item.gate);
			}),
		}))
		.filter((section) => section.items.length > 0);

	return (
		<div className="relative z-50 h-full w-14 shrink-0">
			<aside
				onMouseEnter={() => setIsExpanded(true)}
				onMouseLeave={() => setIsExpanded(false)}
				className={`absolute left-0 top-0 flex h-full overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-sm transition-[width] duration-200 ease-out ${
					isExpanded ? "w-64 shadow-lg" : "w-14"
				}`}
			>
				<div className="flex w-full flex-col overflow-y-auto py-2">
					{/* Projects dropdown — top of sidebar */}
					<div className="mb-1">
						<button
							type="button"
							onClick={() => isExpanded && setProjectsOpen((v) => !v)}
							title={!isExpanded ? "Projects" : undefined}
							className="mx-2 flex w-[calc(100%-16px)] items-center rounded-lg px-2 py-1.5 text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
						>
							<div className="flex h-6 w-6 shrink-0 items-center justify-center">
								<FolderKanban className="h-5 w-5" />
							</div>
							<span
								className={`ml-3 flex-1 truncate text-left text-sm font-medium transition-[opacity,transform] duration-200 ${
									isExpanded
										? "translate-x-0 opacity-100"
										: "-translate-x-4 opacity-0"
								}`}
							>
								{project?.title || "Projects"}
							</span>
							{isExpanded && (
								<motion.span
									animate={{ rotate: projectsOpen ? 90 : 0 }}
									transition={{ duration: 0.18, ease: "easeOut" }}
									className="flex shrink-0"
								>
									<ChevronRight className="h-4 w-4" />
								</motion.span>
							)}
						</button>

						<AnimatePresence initial={false}>
							{isExpanded && projectsOpen && allProjects.length > 0 && (
								<motion.div
									key="projects-list"
									initial={{ height: 0, opacity: 0 }}
									animate={{ height: "auto", opacity: 1 }}
									exit={{ height: 0, opacity: 0 }}
									transition={{
										height: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
										opacity: { duration: 0.18, ease: "easeOut" },
									}}
									className="overflow-hidden"
								>
									<div className="mx-2 mt-1 space-y-0.5 pb-1">
										{allProjects.map((p) => {
											const isCurrent = p.id === projectId;
											return (
												<Link
													key={p.id}
													to="/project/$projectId/overview"
													params={{ projectId: p.id }}
													className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
														isCurrent
															? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
															: "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
													}`}
												>
													<span
														className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold uppercase ${
															isCurrent
																? "bg-white/20 text-white"
																: "bg-primary/10 text-primary"
														}`}
													>
														{(p.title || "P").charAt(0)}
													</span>
													<span className="truncate">
														{p.title || "Untitled"}
													</span>
												</Link>
											);
										})}
									</div>
								</motion.div>
							)}
						</AnimatePresence>
					</div>

					{/* Separator between projects list and nav sections */}
					<div className="px-3 pb-1.5">
						<div className="h-px bg-sidebar-border" />
					</div>

					{visibleSections.map((section, sectionIndex) => (
						<div key={section.title} className="mb-1">
							{/* One fixed-height slot per group boundary, so opening the rail
							    never shifts the rows below it. Expanded shows the group name;
							    collapsed shows a rule instead, because the name is unreadable
							    at 56px. Rendering both stacked is what used to push the lower
							    sections down as the rail opened. */}
							<div className="flex h-5 shrink-0 items-center px-3">
								{isExpanded ? (
									<span className="truncate text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
										{section.title}
									</span>
								) : sectionIndex > 0 ? (
									<div className="h-px w-full bg-sidebar-border" />
								) : null}
							</div>

							<div className="flex flex-col gap-0.5">
								{section.items.map((item) => {
									const Icon = item.icon;
									const showChatUnreadDot =
										item.key === "chat" && hasUnreadChat && !isChatRoute;
									const isActive = item.matches(currentPath);
									return (
										<Link
											key={item.label}
											to={item.to}
											title={!isExpanded ? item.label : undefined}
											className={`mx-2 flex items-center overflow-hidden rounded-lg px-2 py-1 transition-colors ${
												isActive
													? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
													: "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
											}`}
										>
											<div className="relative flex h-6 w-6 shrink-0 items-center justify-center">
												<Icon className="h-5 w-5" />
												{showChatUnreadDot ? (
													<span
														className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#ff9933] ring-2 ring-white"
														aria-label="Unread chat messages"
													/>
												) : null}
											</div>
											<span
												className={`ml-3 whitespace-nowrap text-sm font-medium transition-[opacity,transform] duration-200 ${
													isExpanded
														? "opacity-100 translate-x-0"
														: "opacity-0 -translate-x-4"
												}`}
											>
												{item.label}
											</span>
										</Link>
									);
								})}
							</div>
						</div>
					))}

					{/* Gear: project operations, pinned to the bottom so they read as
					    configuration rather than as peers of the delivery pages. */}
					{isProjectActive && (
						<div className="mt-auto pt-1">
							<div className="px-3 pb-1.5">
								<div className="h-px bg-sidebar-border" />
							</div>
							<div className="flex flex-col gap-0.5">
								{[gearItems.time, gearItems.settings]
									.filter((item) =>
										hasNavGate(permissionsQuery.data, item.gate),
									)
									.map((item) => {
										const Icon = item.icon;
										const isActive = item.matches(currentPath);
										return (
											<Link
												key={item.key}
												to={item.to}
												title={!isExpanded ? item.label : undefined}
												className={`mx-2 flex items-center overflow-hidden rounded-lg px-2 py-1 transition-colors ${
													isActive
														? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
														: "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
												}`}
											>
												<div className="flex h-6 w-6 shrink-0 items-center justify-center">
													<Icon className="h-5 w-5" />
												</div>
												<span
													className={`ml-3 whitespace-nowrap text-sm font-medium transition-[opacity,transform] duration-200 ${
														isExpanded
															? "translate-x-0 opacity-100"
															: "-translate-x-4 opacity-0"
													}`}
												>
													{item.label}
												</span>
											</Link>
										);
									})}
							</div>
						</div>
					)}
				</div>
			</aside>
		</div>
	);
}
