import { Link, useRouterState } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Map,
  ListChecks,
  Clock,
  ClipboardList,
  Users,
  MessageSquare,
  BookOpen,
  Settings,
} from "lucide-react";
import { useState } from "react";
import type { Project } from "@/services/project.service";
import { chatKeys, fetchProjectChatRooms } from "@/queries/chat";
import { useUser } from "@/stores/authStore";
import type { ChatRoom } from "@/services/chat.service";

interface ProjectSidebarProps {
  project: Project | null;
  projectId: string;
  hasProject?: boolean;
  /** The id of the roadmap linked to this project, if any */
  roadmapId?: string;
  compactMode?: boolean;
}

export function ProjectSidebar({
  project,
  projectId,
  hasProject,
  roadmapId,
  compactMode = false,
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
          label: "Overview",
          icon: LayoutDashboard,
          to: `/project/${projectId}/overview`,
          requiresProject: true,
        },
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
          label: "Time",
          icon: Clock,
          to: `/project/${projectId}/time`,
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
    <div className="relative w-14 shrink-0 z-50 h-full">
      <aside
        onMouseEnter={() => {
          if (!compactMode) setIsExpanded(true);
        }}
        onMouseLeave={() => {
          if (!compactMode) setIsExpanded(false);
        }}
        className={`absolute top-0 left-0 h-full flex bg-gray-50 border-r border-gray-200 transition-all duration-300 ease-in-out overflow-hidden shadow-sm ${
          compactMode ? "w-14" : isExpanded ? "w-56 shadow-xl" : "w-14"
        }`}
      >
        <div className="w-full flex flex-col py-3 overflow-y-auto">
          {visibleSections.map((section, sectionIndex) => (
            <div key={section.title} className="mb-2">
              {sectionIndex > 0 && (
                <div className="px-3 py-2">
                  <div className="h-px bg-gray-200" />
                </div>
              )}

              <div className="flex flex-col gap-1">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isChatItem = item.label === "Chat";
                  const showChatUnreadDot =
                    isChatItem && hasUnreadChat && !isChatRoute;
                  const isActive =
                    currentPath.startsWith(item.to) ||
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
                      title={!isExpanded || compactMode ? item.label : undefined}
                      className={`flex items-center p-2 mx-2 rounded-lg transition-all overflow-hidden ${
                        isActive
                          ? "bg-[#ff9933] text-white shadow-sm"
                          : "text-gray-500 hover:bg-gray-200 hover:text-gray-900"
                      }`}
                    >
                      <div className="relative flex items-center justify-center w-6 h-6 shrink-0">
                        <Icon className="w-5 h-5" />
                        {showChatUnreadDot ? (
                          <span
                            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#ff9933] ring-2 ring-gray-50"
                            aria-label="Unread chat messages"
                          />
                        ) : null}
                      </div>
                      <span
                        className={`text-sm font-medium transition-all duration-300 ml-3 whitespace-nowrap ${
                          isExpanded && !compactMode
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
