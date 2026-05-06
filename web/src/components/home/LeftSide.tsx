import { useAuthStore } from "@/stores/authStore";
import { DashboardWidgets } from "./DashboardWidgets";
import { MyWorkSection } from "./MyWorkSection";
import { ProjectsGrid } from "./ProjectsGrid";
import { RoadmapsGrid } from "./RoadmapsGrid";
import { TeamsGrid } from "./TeamsGrid";

export function PrimaryFlow() {
	const { profile } = useAuthStore();
	const persona = profile?.active_persona || "client";
	const isFreelancer = persona === "freelancer";

	return (
		<DashboardWidgets>
			<TeamsGrid />

			<ProjectsGrid />

			<RoadmapsGrid />

			{!isFreelancer ? <MyWorkSection /> : null}
		</DashboardWidgets>
	);
}

export function LeftSide() {
	return (
		<div className="space-y-8">
			<TeamsGrid />
			<ProjectsGrid />
			<RoadmapsGrid />
			<MyWorkSection />
		</div>
	);
}
