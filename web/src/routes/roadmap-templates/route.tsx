import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Header } from "@/components/root/Header";

const parseStringParam = (value: unknown): string | undefined => {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
};

/**
 * `?projectId=` - the project a roadmap picked here should attach to.
 *
 * The gallery lives outside the project shell, so when the project's roadmap
 * tab sends an author here the project has to travel in the URL. Declared on
 * the layout so the catalog and the template detail page both inherit it and
 * can forward it from one to the other with `search={(prev) => prev}`.
 */
export const Route = createFileRoute("/roadmap-templates")({
	validateSearch: (
		search: Record<string, unknown>,
	): { projectId?: string } => ({
		projectId: parseStringParam(search.projectId),
	}),
	component: RoadmapTemplatesLayout,
});

export function RoadmapTemplatesLayout() {
	return (
		<>
			<Header />
			<div className="pt-20">
				<Outlet />
			</div>
		</>
	);
}
