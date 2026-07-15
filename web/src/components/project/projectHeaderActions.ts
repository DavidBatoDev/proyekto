export function shouldShowStandaloneRoadmapProjectActions({
	projectId,
	pathname,
	isAuthenticated,
}: {
	projectId: string;
	pathname: string;
	isAuthenticated: boolean;
}): boolean {
	if (projectId !== "n" || !isAuthenticated) return false;
	return pathname !== `/project/${projectId}/roadmap/create`;
}
