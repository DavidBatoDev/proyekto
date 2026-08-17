import {
	BookOpen,
	CalendarRange,
	ClipboardList,
	Clock,
	Gavel,
	GitPullRequestArrow,
	LayoutDashboard,
	ListChecks,
	Map,
	MessageSquare,
	Package,
	Settings,
	ShieldAlert,
	Users,
} from "lucide-react";
import type { ProjectNavGate } from "@/lib/projectPermissions";

/**
 * Single source of truth for the in-project navigation.
 *
 * Both the desktop rail (`ProjectSidebar`) and the mobile bar
 * (`ProjectBottomNav`) compose their layouts from these definitions, and the
 * breadcrumb in `ProjectHeader` resolves its label from them, so a page can
 * never be named one thing in one place and something else in another.
 *
 * Kept free of React and of hooks on purpose: active-state matching is the
 * part that keeps breaking, and this way it is directly unit-testable.
 */

export type ProjectNavKey =
	| "overview"
	| "roadmap"
	| "timeline"
	| "board"
	| "deliverables"
	| "team"
	| "chat"
	| "resources"
	| "changeRequests"
	| "decisions"
	| "risks"
	| "activity"
	| "time"
	| "settings";

export interface ProjectNavItem {
	key: ProjectNavKey;
	label: string;
	icon: typeof Map;
	to: string;
	/**
	 * Whether this item owns `currentPath`.
	 *
	 * Explicit per item because naive prefix matching is *not* safe here:
	 * `/time` is a prefix of `/timeline`, so a `startsWith` check lights the
	 * Time entry on every Timeline page. See `ownsSegment`.
	 */
	matches: (currentPath: string) => boolean;
	/** Hidden until the project exists (roadmap-only guest mode has no project). */
	requiresProject: boolean;
	gate?: ProjectNavGate;
}

export interface ProjectNavSection {
	title: string;
	items: ProjectNavItem[];
}

/**
 * Match a whole path segment, never a partial one.
 *
 * `/project/1/timeline` must not match the `time` segment, which is exactly
 * the bug that shipped when the Timeline page was carved out of the roadmap
 * canvas: `"/project/1/timeline".startsWith("/project/1/time")` is `true`.
 */
export function ownsSegment(projectId: string, segment: string) {
	const base = `/project/${projectId}/${segment}`;
	return (currentPath: string) =>
		currentPath === base || currentPath.startsWith(`${base}/`);
}

interface BuildArgs {
	projectId: string;
	/** Deep-links straight to the linked roadmap when we know it. */
	roadmapId?: string;
}

export function createProjectNavItems({
	projectId,
	roadmapId,
}: BuildArgs): Record<ProjectNavKey, ProjectNavItem> {
	const base = `/project/${projectId}`;
	// The three roadmap-scoped pages deep-link to the linked roadmap when one is
	// known; their layout routes redirect there anyway, so this just skips a hop.
	const scoped = (segment: string) =>
		roadmapId ? `${base}/${segment}/${roadmapId}` : `${base}/${segment}`;

	return {
		overview: {
			key: "overview",
			label: "Overview",
			icon: LayoutDashboard,
			to: `${base}/overview`,
			matches: ownsSegment(projectId, "overview"),
			requiresProject: true,
		},
		roadmap: {
			key: "roadmap",
			label: "Roadmap",
			icon: Map,
			to: scoped("roadmap"),
			matches: ownsSegment(projectId, "roadmap"),
			requiresProject: false,
			gate: "access.roadmap",
		},
		timeline: {
			key: "timeline",
			label: "Timeline",
			icon: CalendarRange,
			to: scoped("timeline"),
			matches: ownsSegment(projectId, "timeline"),
			requiresProject: false,
			gate: "access.roadmap",
		},
		board: {
			key: "board",
			label: "Board",
			icon: ListChecks,
			to: scoped("work-items"),
			matches: ownsSegment(projectId, "work-items"),
			requiresProject: false,
			gate: "access.work_items",
		},
		deliverables: {
			key: "deliverables",
			label: "Deliverables",
			icon: Package,
			to: `${base}/deliverables`,
			matches: ownsSegment(projectId, "deliverables"),
			requiresProject: true,
			gate: "access.delivery",
		},
		changeRequests: {
			key: "changeRequests",
			label: "Change Requests",
			icon: GitPullRequestArrow,
			to: `${base}/change-requests`,
			matches: ownsSegment(projectId, "change-requests"),
			requiresProject: true,
			gate: "access.delivery",
		},
		decisions: {
			key: "decisions",
			label: "Decisions",
			// Matches the page's own header icon — a ruling, not a thought.
			icon: Gavel,
			to: `${base}/decisions`,
			matches: ownsSegment(projectId, "decisions"),
			requiresProject: true,
			gate: "access.delivery",
		},
		risks: {
			key: "risks",
			label: "Risks & Issues",
			icon: ShieldAlert,
			to: `${base}/risks`,
			matches: ownsSegment(projectId, "risks"),
			requiresProject: true,
			gate: "access.delivery",
		},
		team: {
			key: "team",
			label: "Team",
			icon: Users,
			to: `${base}/team`,
			matches: ownsSegment(projectId, "team"),
			requiresProject: true,
			gate: "access.team",
		},
		chat: {
			key: "chat",
			label: "Chat",
			icon: MessageSquare,
			to: `${base}/chat/channel-general`,
			matches: ownsSegment(projectId, "chat"),
			requiresProject: true,
			gate: "access.chat",
		},
		resources: {
			key: "resources",
			label: "Resources",
			icon: BookOpen,
			to: `${base}/resources`,
			matches: ownsSegment(projectId, "resources"),
			requiresProject: true,
			gate: "access.resources",
		},
		// Route stays `/logs`: `logs.view` / `logs.view_sensitive` are a shipped
		// backend permission contract, and renaming a permission path is a
		// migration rather than a rename. Only the label moved to "Activity".
		activity: {
			key: "activity",
			label: "Activity",
			icon: ClipboardList,
			to: `${base}/logs`,
			matches: ownsSegment(projectId, "logs"),
			requiresProject: true,
			gate: "logs.view",
		},
		// Time and Settings live behind the gear, not in the main nav.
		time: {
			key: "time",
			label: "Time logs",
			icon: Clock,
			to: `${base}/time`,
			matches: ownsSegment(projectId, "time"),
			requiresProject: true,
			gate: "access.time",
		},
		settings: {
			key: "settings",
			label: "Settings",
			icon: Settings,
			to: `${base}/settings/general`,
			matches: ownsSegment(projectId, "settings"),
			requiresProject: true,
		},
	};
}

/**
 * The desktop rail's grouping, mirroring how a project is actually delivered:
 * build it, collaborate on it, govern it.
 *
 * Settings and Time are deliberately absent — they hang off the gear pinned to
 * the bottom of the rail.
 */
export function buildProjectNavSections(args: BuildArgs): ProjectNavSection[] {
	const items = createProjectNavItems(args);

	return [
		{
			title: "Project",
			items: [
				items.overview,
				items.roadmap,
				items.board,
				items.timeline,
				items.deliverables,
			],
		},
		{
			title: "Collaborate",
			items: [items.team, items.chat, items.resources],
		},
		{
			title: "Management",
			items: [
				items.changeRequests,
				items.decisions,
				items.risks,
				items.activity,
			],
		},
	];
}

/**
 * Mobile split. The bar holds five items at most before the labels stop being
 * legible, so everything else goes to the "More" sheet.
 */
export function buildProjectBottomNav(args: BuildArgs): {
	primary: ProjectNavItem[];
	more: ProjectNavItem[];
} {
	const items = createProjectNavItems(args);
	return {
		primary: [
			items.overview,
			items.roadmap,
			items.board,
			items.chat,
			items.resources,
		],
		// Timeline is here rather than in the primary row because the chart is
		// desktop-only anyway.
		more: [
			items.timeline,
			items.deliverables,
			items.changeRequests,
			items.risks,
			items.decisions,
			items.team,
			items.activity,
			items.time,
			items.settings,
		],
	};
}

/**
 * Breadcrumb label for the current page, resolved from the same definitions the
 * nav uses so the two can't drift.
 */
export function resolveProjectPageLabel(
	currentPath: string,
	projectId: string,
): string {
	const items = createProjectNavItems({ projectId });
	const match = Object.values(items).find((item) => item.matches(currentPath));
	if (match) return match.label;
	// The layout route itself (`/project/<id>`) renders the overview.
	return "Overview";
}
