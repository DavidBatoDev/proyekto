import {
  Briefcase,
  Search,
  MessageCircle,
  Bell,
  ChevronRight,
  ChevronsUpDown,
  Boxes,
} from "lucide-react";
import { Link, useParams, useChildMatches, useNavigate, useLocation } from "@tanstack/react-router";
import { useUser } from "@/stores/authStore";
import Logo from "/prodigylogos/light/logovector.svg";
import ProjectUserMenu from "./ProjectUserMenu";
import { useProjectDetailQuery } from "@/hooks/useProjectQueries";

const roleBadgeColor: Record<string, string> = {
  CONSULTANT: "bg-emerald-100 text-emerald-700 border-emerald-200",
  CLIENT: "bg-blue-100 text-blue-700 border-blue-200",
  OWNER: "bg-orange-100 text-orange-700 border-orange-200",
  MEMBER: "bg-purple-100 text-purple-700 border-purple-200",
  VIEWER: "bg-gray-100 text-gray-600 border-gray-200",
};

export function ProjectHeader() {
  const params: any = useParams({ strict: false });
  const projectId = params.projectId;
  const navigate = useNavigate();
  const location = useLocation();
  const user = useUser();
  const isRoadmapOnly = projectId === "n";
  const projectQuery = useProjectDetailQuery(
    !projectId || isRoadmapOnly ? "" : projectId,
  );
  const project = projectId === "n" ? null : (projectQuery.data ?? null);

  // For the 'n' (roadmap-only) case
  const childMatches = useChildMatches();
  const childRoadmapId = (childMatches[0]?.params as any)?.roadmapId as
    | string
    | undefined;

  const handleMakeProject = () => {
    if (!childRoadmapId) return;
    navigate({
      to: "/project-posting",
      search: { roadmapId: childRoadmapId },
    });
  };

  const title = project?.title ?? (isRoadmapOnly ? "Roadmap" : "Project");
  const showMakeProject = isRoadmapOnly;
  const viewingAs = isRoadmapOnly
    ? undefined
    : user?.id && project
      ? user.id === project.consultant_id
        ? "CONSULTANT"
        : user.id === project.client_id
          ? "CLIENT"
          : "MEMBER"
      : undefined;

  const badgeClass =
    roleBadgeColor[(viewingAs ?? "").toUpperCase()] ?? roleBadgeColor["VIEWER"];

  return (
    <div className="w-full h-full flex items-center justify-between px-6 shrink-0 z-10">
      {/* Left: Logo + Breadcrumbs */}
      <div className="flex flex-row items-center gap-4 min-w-0">
        <Link
          to="/dashboard"
          className="cursor-pointer flex items-center shrink-0 border-r border-gray-200 pr-4"
        >
          <img src={Logo} alt="Prodigy Logo" className="h-[24px]" />
        </Link>
        <div className="flex items-center text-sm font-medium text-gray-900 min-w-0 gap-2">
          {/* Project Dropdown Button */}
          <button className="flex items-center gap-2 hover:bg-gray-100 px-2 py-1.5 rounded-lg transition-colors truncate max-w-[250px]">
            <Boxes className="w-5 h-5 text-gray-500 shrink-0" />
            <span className="truncate text-[15px]">
              {title || "Untitled Project"}
            </span>
            <ChevronsUpDown className="w-4 h-4 text-gray-400 shrink-0 ml-1" />
          </button>

          <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />

          {/* Current Page */}
          <span className="text-gray-600 truncate px-2 text-[15px] capitalize">
            {(() => {
              if (isRoadmapOnly) return "Roadmap";
              const path = location.pathname;
              if (path.includes("/roadmap")) return "Roadmap";
              if (path.includes("/chat")) return "Chat";
              if (path.includes("/settings")) return "Settings";
              if (path.includes("/team")) return "Team";
              if (path.includes("/files")) return "Files";
              if (path.includes("/task-items") || path.includes("/tasks"))
                return "Tasks";
              if (path.includes("/meetings")) return "Meetings";
              if (path.includes("/overview") || path.endsWith(projectId))
                return "Overview";
              // Fallback
              const segment = path.split("/").pop() || "Overview";
              return segment.length > 20
                ? "Overview"
                : segment.replace("-", " ");
            })()}
          </span>
        </div>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-3 shrink-0">
        {showMakeProject && (
          <button
            onClick={handleMakeProject}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-white bg-linear-to-r from-orange-500 to-orange-600 hover:shadow-lg rounded-lg transition-all font-medium whitespace-nowrap"
            title="Convert to Project for Consultant Bidding"
          >
            <Briefcase className="w-4 h-4" />
            Make this a Project
          </button>
        )}

        {viewingAs && (
          <div className="flex items-center gap-2 mr-2">
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${badgeClass}`}
            >
              {viewingAs}
            </span>
          </div>
        )}

        {/* Search Bar */}
        <div className="hidden md:flex items-center bg-[#F5F5F5] hover:bg-[#EBEBEB] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#ff9933] rounded-2xl px-3 py-1.5 min-w-[200px] lg:min-w-[250px] transition-all duration-300">
          <Search size={18} className="text-[#666] mr-2 shrink-0" />
          <input
            type="text"
            placeholder="Search..."
            className="flex-1 bg-transparent border-none focus:outline-none text-[0.85rem] text-[#2F302F] placeholder-[#999] min-w-0"
          />
        </div>

        {/* Message Icon */}
        <button
          className="text-[#2F302F] hover:bg-black/5 p-2 rounded-full transition-colors flex items-center justify-center"
          aria-label="Messages"
        >
          <MessageCircle size={20} />
        </button>

        {/* Notification Icon */}
        <button
          className="text-[#2F302F] hover:bg-black/5 p-2 rounded-full transition-colors flex items-center justify-center"
          aria-label="Notifications"
        >
          <Bell size={20} />
        </button>

        {/* User Menu */}
        <div className="ml-1">
          <ProjectUserMenu role={viewingAs} />
        </div>
      </div>
    </div>
  );
}
