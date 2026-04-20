import {
	Link,
	useChildMatches,
	useLocation,
	useNavigate,
	useParams,
} from "@tanstack/react-router";
import {
	Bell,
	Boxes,
	Briefcase,
	ChevronRight,
	ChevronsUpDown,
	MessageCircle,
	Search,
} from "lucide-react";
import { useProjectDetailQuery } from "@/hooks/useProjectQueries";
import { useUser } from "@/stores/authStore";
import Logo from "/prodigylogos/light/logovector.svg";
import ProjectUserMenu from "./ProjectUserMenu";

const roleBadgeColor: Record<string, string> = {
	CONSULTANT: "border-slate-300 bg-slate-100 text-slate-700",
	CLIENT: "border-slate-300 bg-slate-100 text-slate-700",
	OWNER: "border-slate-300 bg-slate-100 text-slate-700",
	MEMBER: "border-slate-300 bg-slate-100 text-slate-700",
	VIEWER: "border-slate-300 bg-slate-100 text-slate-700",
};

const resolveCurrentPageLabel = (pathname: string, projectId: string) => {
	if (pathname.includes("/roadmap")) return "Roadmap";
	if (pathname.includes("/work-items")) return "Work Items";
	if (pathname.includes("/chat")) return "Chat";
	if (pathname.includes("/settings")) return "Settings";
	if (pathname.includes("/team")) return "Team";
	if (pathname.includes("/resources")) return "Resources";
	if (pathname.includes("/payments")) return "Payments";
	if (pathname.includes("/logs")) return "Logs";
	if (pathname.includes("/time")) return "Time";
	if (pathname.includes("/overview") || pathname.endsWith(projectId))
		return "Overview";

	const segment = pathname.split("/").filter(Boolean).at(-1) || "Overview";
	if (segment.length > 20) return "Overview";
	return segment.replace("-", " ");
};

export function ProjectHeader() {
	const params = useParams({ strict: false }) as { projectId?: string };
	const projectId = params.projectId ?? "";
	const navigate = useNavigate();
	const location = useLocation();
	const user = useUser();
	const isRoadmapOnly = projectId === "n";
	const projectQuery = useProjectDetailQuery(
		!projectId || isRoadmapOnly ? "" : projectId,
	);
	const project = projectId === "n" ? null : (projectQuery.data ?? null);

	const childMatches = useChildMatches();
	const childRoadmapId = (
		childMatches[0] as { params?: { roadmapId?: string } } | undefined
	)?.params?.roadmapId;

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
		roleBadgeColor[(viewingAs ?? "").toUpperCase()] ?? roleBadgeColor.VIEWER;

	return (
		<div className="z-10 flex h-full w-full items-center justify-between px-4 sm:px-6">
			<div className="flex min-w-0 items-center gap-3 sm:gap-4">
				<Link
					to="/dashboard"
					className="flex shrink-0 items-center border-r border-slate-200 pr-3 sm:pr-4"
				>
					<img src={Logo} alt="Prodigy Logo" className="h-6 w-auto" />
				</Link>

				<div className="flex min-w-0 items-center gap-1 text-sm font-medium text-slate-900">
					<button
						type="button"
						className="flex max-w-[250px] items-center gap-2 truncate rounded-lg px-2 py-1.5 text-[15px] transition-colors hover:bg-slate-100"
					>
						<Boxes className="h-5 w-5 shrink-0 text-slate-500" />
						<span className="truncate">{title || "Untitled Project"}</span>
						<ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 text-slate-400" />
					</button>

					<ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
					<span className="truncate px-2 text-[15px] capitalize text-slate-600">
						{isRoadmapOnly
							? "Roadmap"
							: resolveCurrentPageLabel(location.pathname, projectId)}
					</span>
				</div>
			</div>

			<div className="flex shrink-0 items-center gap-2 sm:gap-3">
				{showMakeProject && (
					<button
						type="button"
						onClick={handleMakeProject}
						className="app-cta inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium text-white"
						title="Convert to Project for Consultant Bidding"
					>
						<Briefcase className="h-4 w-4" />
						Make this a Project
					</button>
				)}

				{viewingAs && (
					<span
						className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badgeClass}`}
					>
						{viewingAs}
					</span>
				)}

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
				>
					<Bell size={20} />
				</button>

				<div className="ml-1">
					<ProjectUserMenu role={viewingAs} />
				</div>
			</div>
		</div>
	);
}
