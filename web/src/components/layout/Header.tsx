import { useRouterState } from "@tanstack/react-router";
import { ProjectInvitePromptManager } from "../invites/ProjectInvitePromptManager";
import { ProjectHeader } from "../project/ProjectHeader";
import DashboardHeader from "./DashboardHeader";

const Header = () => {
	const routerState = useRouterState();
	const currentPath = routerState.location.pathname;

	const validPaths = [
		"/dashboard",
		"/inbox",
		"/work-items",
		"/meetings",
		"/teams",
		"/project",
		"/profile",
		"/consultant",
		"/notifications",
		"/project-posting",
		"/clients",
		"/contracts",
		"/projects",
		"/applications",
		"/freelancer",
		"/mentors",
		"/saved-mentors",
		"/consultant-pool",
		"/direct-contacts",
	];

	if (!validPaths.some((path) => currentPath.startsWith(path))) {
		return null;
	}

	// These paths have their own marketing/focused headers — no layout header needed.
	if (
		currentPath === "/consultant" ||
		currentPath === "/consultant/" ||
		currentPath.startsWith("/consultant/apply") ||
		currentPath.startsWith("/project-posting")
	) {
		return null;
	}

	let content = <DashboardHeader />;

	if (currentPath.startsWith("/project")) {
		content = <ProjectHeader />;
	} else if (currentPath.startsWith("/dashboard")) {
		content = <DashboardHeader />;
	}
	// Any other routes can default to DashboardHeader

	return (
		<>
			<header className="fixed top-0 left-0 right-0 z-50 flex h-app-header items-center justify-center border-b border-slate-200 bg-white pt-safe shadow-[0_1px_0_rgba(15,23,42,0.03)]">
				{content}
			</header>
			<ProjectInvitePromptManager />
		</>
	);
};

export default Header;
