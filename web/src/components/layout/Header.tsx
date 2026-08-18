import { useRouterState } from "@tanstack/react-router";
import { ProjectInvitePromptManager } from "../invites/ProjectInvitePromptManager";
import { ProjectHeader } from "../project/ProjectHeader";
import DashboardHeader from "./DashboardHeader";

const Header = () => {
	const routerState = useRouterState();
	const currentPath = routerState.location.pathname;

	// Prefix allowlist. An unlisted path renders NO header while the page still
	// reserves its height, so anything added under a new namespace must appear
	// here. `/oauth` is deliberately absent — that consent screen wants no
	// chrome; see docs/04-web/routing-and-access.md before adding to this list.
	const validPaths = [
		"/dashboard",
		"/inbox",
		"/command-center",
		"/meetings",
		"/marketplace",
		"/teams",
		"/project",
		"/profile",
		"/notifications",
		"/settings",
		"/unsubscribe",
		"/invites",
		// `/contract/sign/$token` is deliberately absent: the account-free
		// signing page carries no app chrome, exactly as before the move.
		"/freelancer",
	];

	if (!validPaths.some((path) => currentPath.startsWith(path))) {
		return null;
	}

	// These paths have their own marketing/focused headers — no layout header needed.
	if (
		currentPath === "/marketplace/consultant" ||
		currentPath === "/marketplace/consultant/" ||
		currentPath.startsWith("/marketplace/consultant/apply") ||
		currentPath.startsWith("/marketplace/project-posting")
	) {
		return null;
	}

	let content = <DashboardHeader />;

	// Only the project subtree. `/project-posting` used to fall in here by
	// accident; under /marketplace it no longer can.
	if (currentPath.startsWith("/project/")) {
		content = <ProjectHeader />;
	} else if (currentPath.startsWith("/dashboard")) {
		content = <DashboardHeader />;
	}
	// Any other routes can default to DashboardHeader

	return (
		<>
			<header className="fixed top-0 left-0 right-0 z-50 flex h-app-header items-center justify-center border-b border-border bg-card text-card-foreground pt-safe shadow-[0_1px_0_var(--border)]">
				{content}
			</header>
			<ProjectInvitePromptManager />
		</>
	);
};

export default Header;
