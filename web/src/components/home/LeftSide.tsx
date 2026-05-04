import { useAuthStore } from "@/stores/authStore";
import { DashboardWidgets } from "./DashboardWidgets";
import { MyWorkSection } from "./MyWorkSection";
import { ProjectsGrid } from "./ProjectsGrid";
import { RoadmapsGrid } from "./RoadmapsGrid";

export function PrimaryFlow() {
	const { profile } = useAuthStore();
	const persona = profile?.active_persona || "client";
	const isFreelancer = persona === "freelancer";

	return (
		<DashboardWidgets>
			{/* Projects Grid */}
			<ProjectsGrid />

			{/* Roadmaps Grid */}
			<RoadmapsGrid />

			{!isFreelancer ? (
				<>
					{/* My Work */}
					<MyWorkSection />
				</>
			) : null}
		</DashboardWidgets>
	);
}

export function LeftSide() {
	return (
		<div className="space-y-8">
			{/* Projects Grid */}
			<ProjectsGrid />

			{/* Roadmaps Grid */}
			<RoadmapsGrid />

			{/* My Work */}
			<MyWorkSection />
		</div>
	);
}
