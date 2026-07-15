import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Header } from "@/components/root/Header";

export const Route = createFileRoute("/roadmap-templates")({
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
