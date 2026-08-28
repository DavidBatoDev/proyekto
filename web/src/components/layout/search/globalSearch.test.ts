import { describe, expect, it } from "vitest";
import type { Project } from "@/services/project.service";
import type { FullRoadmapWithProject } from "@/services/roadmap.service";
import {
	buildGlobalSearchCandidates,
	buildSearchablePages,
	resolveCandidateDestination,
} from "./globalSearch";

const project = (id: string, title: string) => ({ id, title }) as Project;

const roadmap = (
	overrides: Partial<FullRoadmapWithProject> & { id: string },
): FullRoadmapWithProject =>
	({
		project: null,
		milestones: [],
		epics: [],
		...overrides,
	}) as unknown as FullRoadmapWithProject;

const epic = (
	id: string,
	title: string,
	position: number,
	features: unknown[] = [],
) => ({ id, title, position, features }) as never;

const feature = (id: string, title: string, tasks: unknown[] = []) =>
	({ id, title, tasks }) as never;

const task = (id: string, title: string) => ({ id, title }) as never;

describe("buildSearchablePages", () => {
	it("hides consultant-gated destinations from non-consultants", () => {
		const pages = buildSearchablePages(false);
		const paths = pages.map((p) => p.to);

		expect(paths).not.toContain("/marketplace/finance");
		expect(paths).not.toContain("/marketplace/finance/invoices");
		expect(paths).not.toContain("/marketplace/talent/browse");
		// Ungated marketplace entries stay.
		expect(paths).toContain("/marketplace/consultant/browse");
	});

	it("surfaces gated destinations, children included, to consultants", () => {
		const pages = buildSearchablePages(true);
		const invoices = pages.find(
			(p) => p.to === "/marketplace/finance/invoices",
		);

		expect(invoices?.label).toBe("Finance · Invoices");
		expect(pages.some((p) => p.to === "/marketplace/talent/browse")).toBe(true);
	});

	it("dedupes paths that appear in several nav sources", () => {
		const pages = buildSearchablePages(true);

		// /engagements is in both the header nav and the marketplace sidebar;
		// /dashboard is in both the header nav and the execution sidebar.
		expect(pages.filter((p) => p.to === "/engagements")).toHaveLength(1);
		expect(pages.filter((p) => p.to === "/dashboard")).toHaveLength(1);
		// The icon-bearing sidebar entry wins the dedupe.
		expect(pages.find((p) => p.to === "/dashboard")?.icon).toBeDefined();
	});
});

describe("buildGlobalSearchCandidates", () => {
	const pages = buildSearchablePages(true);

	it("returns nothing for an empty or whitespace query", () => {
		expect(
			buildGlobalSearchCandidates({
				query: "   ",
				pages,
				projects: [project("p1", "Anything")],
				roadmaps: [],
			}),
		).toEqual([]);
	});

	it("matches case-insensitively by substring", () => {
		const results = buildGlobalSearchCandidates({
			query: "ENGAGE",
			pages,
			projects: [],
			roadmaps: [],
		});

		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({ kind: "page", to: "/engagements" });
	});

	it("keeps the fixed group order: pages, projects, work items", () => {
		const results = buildGlobalSearchCandidates({
			query: "boa",
			pages, // "Dashboard" contains "boa"
			projects: [project("p1", "Boat rental")],
			roadmaps: [
				roadmap({
					id: "r1",
					epics: [epic("e1", "Boarding flow", 0)],
				}),
			],
		});

		expect(results.map((r) => r.kind)).toEqual(["page", "project", "workItem"]);
	});

	it("caps projects at 5 and work items at 8", () => {
		const projects = Array.from({ length: 9 }, (_, i) =>
			project(`p${i}`, `Match ${i}`),
		);
		const tasks = Array.from({ length: 12 }, (_, i) =>
			task(`t${i}`, `Match task ${i}`),
		);
		const results = buildGlobalSearchCandidates({
			query: "match",
			pages: [],
			projects,
			roadmaps: [
				roadmap({
					id: "r1",
					epics: [epic("e1", "Epic", 0, [feature("f1", "Feature", tasks)])],
				}),
			],
		});

		expect(results.filter((r) => r.kind === "project")).toHaveLength(5);
		expect(results.filter((r) => r.kind === "workItem")).toHaveLength(8);
	});

	it("carries breadcrumb context on nested work items", () => {
		const results = buildGlobalSearchCandidates({
			query: "login",
			pages: [],
			projects: [],
			roadmaps: [
				roadmap({
					id: "r1",
					project: { id: "proj1", title: "Proyekto" },
					epics: [
						epic("e1", "Auth", 0, [
							feature("f1", "Sessions", [task("t1", "Login form")]),
						]),
					],
				}),
			],
		});

		expect(results[0]).toMatchObject({
			kind: "workItem",
			type: "task",
			id: "t1",
			epicTitle: "Auth",
			featureTitle: "Sessions",
			projectId: "proj1",
			projectTitle: "Proyekto",
			roadmapId: "r1",
		});
	});
});

describe("resolveCandidateDestination", () => {
	it("routes a page straight to its path", () => {
		expect(
			resolveCandidateDestination({
				kind: "page",
				key: "k",
				label: "Dashboard",
				to: "/dashboard",
			}),
		).toEqual({ to: "/dashboard" });
	});

	it("routes a project to its roadmap", () => {
		expect(
			resolveCandidateDestination({ kind: "project", id: "p1", title: "T" }),
		).toEqual({
			to: "/project/$projectId/roadmap",
			params: { projectId: "p1" },
		});
	});

	it("routes a work item to its roadmap with the node deep link", () => {
		expect(
			resolveCandidateDestination({
				kind: "workItem",
				type: "task",
				id: "t1",
				title: "T",
				roadmapId: "r1",
				projectId: "proj1",
			}),
		).toEqual({
			to: "/project/$projectId/roadmap/$roadmapId",
			params: { projectId: "proj1", roadmapId: "r1" },
			search: { nodeId: "t1" },
		});
	});

	it("routes standalone-roadmap work items through the n sentinel", () => {
		const destination = resolveCandidateDestination({
			kind: "workItem",
			type: "epic",
			id: "e1",
			title: "T",
			roadmapId: "r1",
			projectId: null,
		});

		expect(destination.params?.projectId).toBe("n");
	});
});
