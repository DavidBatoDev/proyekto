import { Link, useRouterState } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Map,
  ListChecks,
  ClipboardList,
  ReceiptText,
  Users,
  MessageSquare,
  BookOpen,
  Settings,
  FolderKanban,
  ChevronRight,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { projectService, type Project } from "@/services/project.service";
import { chatKeys, fetchProjectChatRooms } from "@/queries/chat";
import { useUser } from "@/stores/authStore";
import type { ChatRoom } from "@/services/chat.service";

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
    currentPath.match(/\/work-items\/([^/]+)/)?.[1];
  const effectiveRoadmapId = roadmapId ?? roadmapIdFromPath;

  const [isExpanded, setIsExpanded] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);

  const projectsQuery = useQuery({
    queryKey: ["dashboard", "projects", user?.id ?? "anonymous"] as const,
    queryFn: () => projectService.listDashboardProjects(),
    enabled: Boolean(user?.id),
    staleTime: 30 * 1000,
  });
  const allProjects = (projectsQuery.data as Project[] | undefined) ?? [];

  // If we're on a project route (like /project/.../overview), we should show tabs.
  // We can assume it's a project if `hasProject` is strictly true or false,
  // OR if we're not inside the roadmap view and we have a project object or are loading one.
  const isRoadmapView = currentPath.includes("/roadmap");
  const isProjectActive = hasProject ?? (!isRoadmapView || project !== null);
  const isChatRoute = currentPath.includes(`/project/${projectId}/chat`);
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
        room.participants.find((participant) => participant.user_id === currentUserId)
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

  const navSections = [
    {
      title: "Plan",
      items: [
        {
          label: "Roadmap",
          icon: Map,
          to: effectiveRoadmapId
            ? `/project/${projectId}/roadmap/${effectiveRoadmapId}`
            : `/project/${projectId}/roadmap`,
          requiresProject: false,
        },
        {
          label: "Work Items",
          icon: ListChecks,
          to: effectiveRoadmapId
            ? `/project/${projectId}/work-items/${effectiveRoadmapId}`
            : `/project/${projectId}/work-items`,
          requiresProject: false,
        },
        {
          label: "Overview",
          icon: LayoutDashboard,
          to: `/project/${projectId}/overview`,
          requiresProject: true,
        },
      ],
    },
    {
      title: "Collaborate",
      items: [
        {
          label: "Team",
          icon: Users,
          to: `/project/${projectId}/team`,
          requiresProject: true,
        },
        {
          label: "Chat",
          icon: MessageSquare,
          to: `/project/${projectId}/chat/channel-general`,
          requiresProject: true,
        },
        {
          label: "Resources",
          icon: BookOpen,
          to: `/project/${projectId}/resources`,
          requiresProject: true,
        },
      ],
    },
    {
      title: "Manage",
      items: [
        {
          label: "Logs",
          icon: ClipboardList,
          to: `/project/${projectId}/logs`,
          requiresProject: true,
        },
        {
          label: "Invoices",
          icon: ReceiptText,
          to: `/project/${projectId}/payments`,
          requiresProject: true,
        },
        {
          label: "Settings",
          icon: Settings,
          to: `/project/${projectId}/settings/general`,
          requiresProject: true,
        },
      ],
    },
  ];

  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.requiresProject || isProjectActive,
      ),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <div className="relative z-50 h-full w-14 shrink-0">
      <aside
        onMouseEnter={() => setIsExpanded(true)}
        onMouseLeave={() => setIsExpanded(false)}
        className={`absolute left-0 top-0 flex h-full overflow-hidden border-r border-slate-200 bg-white/90 shadow-sm backdrop-blur transition-all duration-300 ease-in-out ${
          isExpanded ? "w-56 shadow-lg" : "w-14"
        }`}
      >
        <div className="flex w-full flex-col overflow-y-auto py-3">
          {/* Projects dropdown — top of sidebar */}
          <div className="mb-1">
            <button
              type="button"
              onClick={() => isExpanded && setProjectsOpen((v) => !v)}
              title={!isExpanded ? "Projects" : undefined}
              className="mx-2 flex w-[calc(100%-16px)] items-center rounded-lg p-2 text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-900"
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center">
                <FolderKanban className="h-5 w-5" />
              </div>
              <span
                className={`ml-3 flex-1 truncate text-left text-sm font-medium transition-all duration-300 ${
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
                              ? "bg-primary text-white shadow-sm"
                              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
                          <span className="truncate">{p.title || "Untitled"}</span>
                        </Link>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Separator between projects list and nav sections */}
          <div className="px-3 pb-2">
            <div className="h-px bg-slate-200" />
          </div>

          {visibleSections.map((section, sectionIndex) => (
            <div key={section.title} className="mb-2">
              {sectionIndex > 0 && (
                <div className="px-3 py-2">
                  <div className="h-px bg-slate-200" />
                </div>
              )}

              <div className="flex flex-col gap-1">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isChatItem = item.label === "Chat";
                  const showChatUnreadDot =
                    isChatItem && hasUnreadChat && !isChatRoute;
                  const chatBasePath = `/project/${projectId}/chat`;
                  const isActive =
                    (isChatItem
                      ? currentPath.startsWith(chatBasePath)
                      : currentPath.startsWith(item.to)) ||
                    (item.label === "Settings" &&
                      currentPath.includes("/settings")) ||
                    (item.label === "Roadmap" &&
                      currentPath.includes("/roadmap")) ||
                    (item.label === "Work Items" &&
                      currentPath.includes("/work-items"));
                  return (
                    <Link
                      key={item.label}
                      to={item.to}
                      title={!isExpanded ? item.label : undefined}
                      className={`mx-2 flex items-center overflow-hidden rounded-lg p-2 transition-all ${
                        isActive
                          ? "bg-primary text-white shadow-sm"
                          : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
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
                        className={`ml-3 whitespace-nowrap text-sm font-medium transition-all duration-300 ${
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
        </div>
      </aside>
    </div>
  );
}
