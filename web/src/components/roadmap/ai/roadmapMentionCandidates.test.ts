import { describe, expect, it } from "vitest";
import type { Roadmap, RoadmapEpic, RoadmapMilestone } from "@/types/roadmap";
import {
	buildRoadmapContextRefs,
	buildRoadmapMentionCandidates,
	PROJECT_CONTEXT_FALLBACK_LABEL,
	ROADMAP_CONTEXT_FALLBACK_LABEL,
} from "./roadmapMentionCandidates";

describe("buildRoadmapContextRefs", () => {
	it("attaches the roadmap and the project, roadmap first", () => {
		expect(
			buildRoadmapContextRefs("rm-1", "proj-1", "Onboarding", "Client project"),
		).toEqual([
			{
				kind: "roadmap",
				id: "rm-1",
				label: "Onboarding",
				roadmapId: "rm-1",
				projectId: "proj-1",
			},
			{
				kind: "project",
				id: "proj-1",
				label: "Client project",
				projectId: "proj-1",
			},
		]);
	});

	it("attaches only the roadmap on the project-less route", () => {
		expect(
			buildRoadmapContextRefs("rm-1", "n", "Onboarding", undefined),
		).toEqual([
			{
				kind: "roadmap",
				id: "rm-1",
				label: "Onboarding",
				roadmapId: "rm-1",
				projectId: null,
			},
		]);
		expect(
			buildRoadmapContextRefs("rm-1", "", "Onboarding", "Ignored"),
		).toHaveLength(1);
	});

	it("falls back to placeholder labels until the rows load", () => {
		expect(
			buildRoadmapContextRefs("rm-1", "proj-1", undefined, null).map(
				(ref) => ref.label,
			),
		).toEqual([ROADMAP_CONTEXT_FALLBACK_LABEL, PROJECT_CONTEXT_FALLBACK_LABEL]);
		expect(
			buildRoadmapContextRefs("rm-1", "proj-1", "   ", "  ").map(
				(ref) => ref.label,
			),
		).toEqual(["This roadmap", "This project"]);
	});
});

describe("buildRoadmapMentionCandidates", () => {
	const roadmap = {
		id: "rm-1",
		name: "Onboarding",
		project_id: "proj-1",
	} as unknown as Roadmap;
	const epics = [
		{ id: "e2", title: "Second", position: 1, features: [] },
		{
			id: "e1",
			title: "First",
			position: 0,
			features: [
				{
					id: "f1",
					title: "Feature",
					position: 0,
					tasks: [{ id: "t1", title: "Task", position: 0 }],
				},
			],
		},
	] as unknown as RoadmapEpic[];
	const milestones = [
		{ id: "m1", title: "Beta", position: 0 },
	] as unknown as RoadmapMilestone[];

	it("returns nothing while the store holds another roadmap (or none)", () => {
		expect(
			buildRoadmapMentionCandidates("rm-1", "proj-1", {
				roadmap: { ...roadmap, id: "rm-2" },
				epics,
				milestones,
			}),
		).toEqual([]);
		expect(
			buildRoadmapMentionCandidates("rm-1", "proj-1", {
				roadmap: null,
				epics: [],
				milestones: [],
			}),
		).toEqual([]);
	});

	it("lists the roadmap, then the tree in position order, then milestones", () => {
		const out = buildRoadmapMentionCandidates("rm-1", "proj-1", {
			roadmap,
			epics,
			milestones,
		});
		expect(out.map((c) => `${c.kind}:${c.id}`)).toEqual([
			"roadmap:rm-1",
			"epic:e1",
			"feature:f1",
			"task:t1",
			"epic:e2",
			"milestone:m1",
		]);
		expect(out[0]).toMatchObject({
			label: "Onboarding",
			secondary: "This roadmap",
			roadmapId: "rm-1",
			projectId: "proj-1",
		});
		expect(out[2]).toMatchObject({ secondary: "First" });
		expect(out[3]).toMatchObject({ secondary: "Feature" });
	});

	it("takes the project from the route when the roadmap row has none", () => {
		const unlinked = { ...roadmap, project_id: null } as unknown as Roadmap;
		const tree = { roadmap: unlinked, epics: [], milestones: [] };
		expect(
			buildRoadmapMentionCandidates("rm-1", "proj-9", tree)[0].projectId,
		).toBe("proj-9");
		expect(buildRoadmapMentionCandidates("rm-1", "n", tree)[0].projectId).toBe(
			null,
		);
	});
});
