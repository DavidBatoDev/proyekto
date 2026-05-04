import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
	ChevronRight,
	Folder,
	Inbox,
	LayoutDashboard,
	ListChecks,
	Map,
	Users,
	UserPlus,
} from "lucide-react";
import { useCallback, useState } from "react";
import { type Project, projectService } from "@/services/project.service";
import { useUser } from "@/stores/authStore";

const EXPANDED_KEY = "dashboard_sidebar_expanded";

function loadExpanded(): Record<string, boolean> {
	if (typeof window === "undefined") return {};
	try {
		const raw = sessionStorage.getItem(EXPANDED_KEY);
		return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
	} catch {
		return {};
	}
}

function saveExpanded(state: Record<string, boolean>) {
	if (typeof window === "undefined") return;
	try {
		sessionStorage.setItem(EXPANDED_KEY, JSON.stringify(state));
	} catch {
		/* sessionStorage full / disabled — non-fatal */
	}
}

export function DashboardSidebar() {
	const user = useUser();
	const routerState = useRouterState();
	const currentPath = routerState.location.pathname;

	const projectsQuery = useQuery({
		queryKey: ["dashboard", "projects", user?.id ?? "anonymous"] as const,
		queryFn: () => projectService.listDashboardProjects(),
		enabled: Boolean(user?.id),
		staleTime: 30 * 1000,
	});
	const projects = (projectsQuery.data as Project[] | undefined) ?? [];

	const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
		loadExpanded(),
	);
	const toggleExpanded = useCallback((projectId: string) => {
		setExpanded((prev) => {
			const next = { ...prev, [projectId]: !prev[projectId] };
			saveExpanded(next);
			return next;
		});
	}, []);

	return (
		<aside className="hidden lg:flex sticky top-14 h-[calc(100vh-3.5rem)] w-[260px] shrink-0 flex-col border-r border-slate-200 bg-white/90 backdrop-blur">
			<nav className="flex-1 overflow-y-auto px-3 py-4">
				<div className="space-y-0.5">
					<SidebarLink
						to="/dashboard"
						icon={LayoutDashboard}
						label="Dashboard"
						active={currentPath === "/dashboard"}
					/>
					<SidebarLink
						to="/inbox"
						icon={Inbox}
						label="Inbox"
						active={currentPath.startsWith("/inbox")}
					/>
					<SidebarLink
						to="/work-items"
						icon={ListChecks}
						label="Work Items"
						active={currentPath === "/work-items"}
					/>
				</div>

				<div className="mt-6">
					<div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
						Projects
					</div>

					{projectsQuery.isPending ? (
						<ProjectsSkeleton />
					) : projects.length === 0 ? (
						<p className="px-3 py-2 text-xs text-slate-500">
							No projects yet
						</p>
					) : (
						<div className="space-y-0.5">
							{projects.map((p, i) => (
								<ProjectGroup
									key={p.id}
									project={p}
									isExpanded={expanded[p.id] ?? i < 3}
									onToggle={() => toggleExpanded(p.id)}
									currentPath={currentPath}
								/>
							))}
						</div>
					)}
				</div>
			</nav>

			<div className="border-t border-slate-200 p-3">
				<button
					type="button"
					disabled
					title="Invite flow coming soon"
					className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
				>
					<UserPlus className="h-5 w-5" />
					Invite people
				</button>
			</div>
		</aside>
	);
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function SidebarLink({
	to,
	icon: Icon,
	label,
	active,
}: {
	to: string;
	icon: React.ElementType;
	label: string;
	active: boolean;
}) {
	return (
		<Link
			to={to}
			className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
				active
					? "bg-slate-900 text-white shadow-sm"
					: "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
			}`}
		>
			<Icon className="h-5 w-5 shrink-0" />
			<span className="truncate">{label}</span>
		</Link>
	);
}

function ProjectGroup({
	project,
	isExpanded,
	onToggle,
	currentPath,
}: {
	project: Project;
	isExpanded: boolean;
	onToggle: () => void;
	currentPath: string;
}) {
	const projectActive = currentPath.startsWith(`/project/${project.id}`);
	const subItems = [
		{
			label: "Roadmap",
			icon: Map,
			to: `/project/${project.id}/roadmap`,
			active: currentPath.startsWith(`/project/${project.id}/roadmap`),
		},
		{
			label: "Work Items",
			icon: ListChecks,
			to: `/project/${project.id}/work-items`,
			active: currentPath.startsWith(`/project/${project.id}/work-items`),
		},
		{
			label: "Team",
			icon: Users,
			to: `/project/${project.id}/team`,
			active: currentPath.startsWith(`/project/${project.id}/team`),
		},
	];

	return (
		<div>
			<div
				className={`group flex items-center gap-1 rounded-lg pr-1 transition-colors ${
					projectActive && !isExpanded
						? "bg-slate-100"
						: "hover:bg-slate-50"
				}`}
			>
				<button
					type="button"
					onClick={onToggle}
					aria-label={isExpanded ? "Collapse project" : "Expand project"}
					className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-700"
				>
					<motion.span
						initial={false}
						animate={{ rotate: isExpanded ? 90 : 0 }}
						transition={{ duration: 0.18, ease: "easeOut" }}
						className="flex"
					>
						<ChevronRight className="h-4 w-4" />
					</motion.span>
				</button>
				<Link
					to="/project/$projectId/overview"
					params={{ projectId: project.id }}
					className="flex min-w-0 flex-1 items-center gap-3 py-2 text-sm font-medium text-slate-700 hover:text-slate-900"
				>
					<Folder className="h-5 w-5 shrink-0 text-slate-400" />
					<span className="truncate">
						{project.title || "Untitled project"}
					</span>
				</Link>
			</div>

			<AnimatePresence initial={false}>
				{isExpanded && (
					<motion.div
						key="subitems"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.2, ease: "easeOut" }}
						className="overflow-hidden"
					>
						<div className="ml-8 mt-1 space-y-0.5 border-l border-slate-200 pl-2">
							{subItems.map((item) => (
								<Link
									key={item.label}
									to={item.to}
									className={`flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors ${
										item.active
											? "bg-slate-900 text-white"
											: "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
									}`}
								>
									<item.icon className="h-4 w-4 shrink-0" />
									<span className="truncate">{item.label}</span>
								</Link>
							))}
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

function ProjectsSkeleton() {
	return (
		<div className="space-y-1 px-3 py-1">
			{[0, 1, 2].map((i) => (
				<div key={i} className="h-6 w-full animate-pulse rounded bg-slate-100" />
			))}
		</div>
	);
}
