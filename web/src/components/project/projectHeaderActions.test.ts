import { describe, expect, it } from "vitest";
import { shouldShowStandaloneRoadmapProjectActions } from "./projectHeaderActions";

describe("shouldShowStandaloneRoadmapProjectActions", () => {
	it("hides project conversion actions while creating a roadmap", () => {
		expect(
			shouldShowStandaloneRoadmapProjectActions({
				projectId: "n",
				pathname: "/project/n/roadmap/create",
				isAuthenticated: true,
			}),
		).toBe(false);
	});

	it("shows the actions on a saved standalone roadmap", () => {
		expect(
			shouldShowStandaloneRoadmapProjectActions({
				projectId: "n",
				pathname: "/project/n/roadmap/roadmap-1",
				isAuthenticated: true,
			}),
		).toBe(true);
	});

	it("keeps the actions hidden for linked projects and signed-out users", () => {
		expect(
			shouldShowStandaloneRoadmapProjectActions({
				projectId: "project-1",
				pathname: "/project/project-1/roadmap/roadmap-1",
				isAuthenticated: true,
			}),
		).toBe(false);
		expect(
			shouldShowStandaloneRoadmapProjectActions({
				projectId: "n",
				pathname: "/project/n/roadmap/roadmap-1",
				isAuthenticated: false,
			}),
		).toBe(false);
	});
});
