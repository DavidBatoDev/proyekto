import {
	Link,
	useChildMatches,
	useLocation,
	useNavigate,
	useParams,
} from "@tanstack/react-router";
import {
	Briefcase,
	ChevronDown,
	ChevronRight,
	MessageCircle,
	Search,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { useProjectDetailQuery } from "@/hooks/useProjectQueries";
import { useUser } from "@/stores/authStore";
import { BrandMark } from "@/components/brand/BrandMark";
import { TeamAvatar } from "@/components/team/TeamAvatar";
import {
	listProjectTeams,
	getTeam,
	listCuratedMembers,
	type Team,
	type ProjectTeam,
} from "@/services/teams.service";
import ProjectUserMenu from "./ProjectUserMenu";

const resolveCurrentPageLabel = (pathname: string, projectId: string) => {
	if (pathname.includes("/roadmap")) return "Roadmap";
	if (pathname.includes("/work-items")) return "Work Items";
	if (pathname.includes("/chat")) return "Chat";
	if (pathname.includes("/settings")) return "Settings";
	if (pathname.includes("/team")) return "Team";
	if (pathname.includes("/resources")) return "Resources";
	if (pathname.includes("/payments")) return "Payments";
	if (pathname.includes("/logs")) return "Logs";
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

	// Fetch teams attached to this project
	const projectTeamsQuery = useQuery({
		queryKey: ["project-teams", projectId],
		queryFn: () => listProjectTeams(projectId),
		enabled: Boolean(projectId && !isRoadmapOnly),
		staleTime: 60_000,
	});
	const projectTeamLinks: ProjectTeam[] = projectTeamsQuery.data ?? [];

	const teamDetailResults = useQueries({
		queries: projectTeamLinks.map((pt) => ({
			queryKey: ["team", pt.team_id],
			queryFn: () => getTeam(pt.team_id),
			staleTime: 60_000,
		})),
	});

	// Curated members = the project-team subset (members invited to this project from each team)
	const curatedMemberResults = useQueries({
		queries: projectTeamLinks.map((pt) => ({
			queryKey: ["project-team-members", projectId, pt.team_id],
			queryFn: () => listCuratedMembers(projectId, pt.team_id),
			staleTime: 60_000,
		})),
	});

	type EnrichedTeam = Team & { projectMemberCount: number | null; currentUserIsMember: boolean };
	const teams: EnrichedTeam[] = projectTeamLinks
		.map((_, i) => {
			const team = teamDetailResults[i]?.data ?? null;
			if (!team) return null;
			const members = curatedMemberResults[i]?.data ?? null;
			const memberCount = members?.length ?? null;
			const currentUserIsMember = user?.id
				? (members?.some((m) => m.user_id === user.id) ?? false)
				: false;
			return { ...team, projectMemberCount: memberCount, currentUserIsMember };
		})
		.filter((t): t is EnrichedTeam => t !== null);

	// Only show teams where the current user is an assigned member
	const visibleTeams = teams.filter((t) => t.currentUserIsMember);

	// Dropdown state for multi-team breadcrumb
	const [teamsDropdownOpen, setTeamsDropdownOpen] = useState(false);
	const teamsDropdownRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!teamsDropdownOpen) return;
		const onMouseDown = (e: MouseEvent) => {
			if (!teamsDropdownRef.current?.contains(e.target as Node)) {
				setTeamsDropdownOpen(false);
			}
		};
		document.addEventListener("mousedown", onMouseDown);
		return () => document.removeEventListener("mousedown", onMouseDown);
	}, [teamsDropdownOpen]);

	// Deduplicate members across teams by user_id so cross-team members count once
	const allMemberIds = curatedMemberResults.every((r) => r.data != null)
		? new Set(curatedMemberResults.flatMap((r) => (r.data ?? []).map((m) => m.user_id)))
		: null;
	const totalProjectMembers = allMemberIds?.size ?? null;

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

	return (
		<div className="z-10 flex h-full w-full items-center justify-between px-4 sm:px-6">
			<div className="flex min-w-0 items-center gap-3 sm:gap-4">
				<Link
					to="/"
					className="flex shrink-0 items-center border-r border-slate-200 pr-3 sm:pr-4"
				>
					<BrandMark variant="mark" className="h-6 text-white" />
				</Link>

				<nav
					aria-label="Breadcrumb"
					className="flex min-w-0 items-center gap-1 text-sm font-medium text-slate-900"
				>
					{/* Dashboard */}
					<Link
						to="/dashboard"
						className="hidden rounded-md px-2 py-1.5 text-[15px] text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 sm:block"
					>
						Dashboard
					</Link>
					<ChevronRight className="hidden h-4 w-4 shrink-0 text-slate-400 sm:block" />

					{/* Single team crumb */}
					{visibleTeams.length === 1 && (
						<>
							<Link
								to="/teams/$teamId"
								params={{ teamId: visibleTeams[0].id }}
								className="hidden items-center gap-1.5 rounded-md px-2 py-1.5 text-[14px] text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 sm:flex"
							>
								<TeamAvatar team={visibleTeams[0]} size="sm" />
								<span className="truncate">{visibleTeams[0].name}</span>
							</Link>
							<ChevronRight className="hidden h-4 w-4 shrink-0 text-slate-400 sm:block" />
						</>
					)}

					{/* Multi-team dropdown crumb */}
					{visibleTeams.length >= 2 && (
						<>
							<div
								ref={teamsDropdownRef}
								className="relative hidden sm:block"
							>
								<button
									type="button"
									onClick={() => setTeamsDropdownOpen((v) => !v)}
									className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[14px] text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
								>
									<div className="flex -space-x-1.5">
										{visibleTeams.slice(0, 2).map((t) => (
											<TeamAvatar
												key={t.id}
												team={t}
												size="sm"
												className="ring-2 ring-white"
											/>
										))}
									</div>
									<span>{visibleTeams.length} Teams</span>
									<motion.span
										animate={{ rotate: teamsDropdownOpen ? 180 : 0 }}
										transition={{ duration: 0.18, ease: "easeOut" }}
										className="flex"
									>
										<ChevronDown className="h-3.5 w-3.5 text-slate-400" />
									</motion.span>
								</button>

								<AnimatePresence>
									{teamsDropdownOpen && (
										<motion.div
											initial={{ opacity: 0, y: -6, scale: 0.97 }}
											animate={{ opacity: 1, y: 0, scale: 1 }}
											exit={{ opacity: 0, y: -6, scale: 0.97 }}
											transition={{ duration: 0.15, ease: "easeOut" }}
											className="absolute left-0 top-full z-50 mt-1 min-w-[200px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"
										>
											{visibleTeams.map((team) => (
												<Link
													key={team.id}
													to="/teams/$teamId"
													params={{ teamId: team.id }}
													onClick={() => setTeamsDropdownOpen(false)}
													className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
												>
													<TeamAvatar team={team} size="sm" />
													<span className="truncate font-medium">{team.name}</span>
												</Link>
											))}
										</motion.div>
									)}
								</AnimatePresence>
							</div>
							<ChevronRight className="hidden h-4 w-4 shrink-0 text-slate-400 sm:block" />
						</>
					)}

					{/* Project name */}
					{isRoadmapOnly || !projectId ? (
						<span className="max-w-[100px] truncate px-2 text-[14px] text-slate-900 sm:max-w-[260px] sm:text-[15px]">
							{title || "Untitled Project"}
						</span>
					) : (
						<Link
							to="/project/$projectId/overview"
							params={{ projectId }}
							className="max-w-[100px] truncate rounded-md px-2 py-1.5 text-[14px] text-slate-900 transition-colors hover:bg-slate-100 sm:max-w-[260px] sm:text-[15px]"
						>
							{title || "Untitled Project"}
						</Link>
					)}
					<ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
					<span className="shrink-0 px-2 text-[14px] capitalize text-slate-600 sm:text-[15px]">
						{isRoadmapOnly
							? "Roadmap"
							: resolveCurrentPageLabel(location.pathname, projectId)}
					</span>
				</nav>
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

				{totalProjectMembers != null && totalProjectMembers > 0 && (
					<span className="hidden rounded border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-bold tracking-wider text-slate-700 sm:inline">
						{totalProjectMembers} members
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
					className="hidden items-center justify-center rounded-full p-2 text-slate-700 transition-colors hover:bg-slate-100 sm:flex"
					aria-label="Messages"
				>
					<MessageCircle size={20} />
				</button>

				<NotificationBell />

				<div className="ml-1">
					<ProjectUserMenu role={viewingAs} />
				</div>
			</div>
		</div>
	);
}
