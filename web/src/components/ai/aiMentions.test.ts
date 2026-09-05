/* @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoadmapPreview } from "@/api/endpoints/roadmap";
import type { Project } from "@/services/project.service";
import type { Team } from "@/services/teams.service";
import {
	AI_MENTION_TOTAL_CAP,
	type AiMentionCandidate,
	type AiMentionPick,
	type AiMentionSpan,
	buildAiMentionCandidates,
	buildContextChips,
	buildSendRefs,
	CONTEXT_ONLY_SPAN,
	contextRefsForMessage,
	getMentionContext,
	isInlineSpan,
	MAX_AGENT_REFS,
	mentionRefKey,
	renderEntityMentionContent,
	renderHighlightBackdrop,
	resolveAiEntityDestination,
	resolveEntityMentions,
	toAgentRefs,
	toMentionPick,
	workspaceLane,
} from "./aiMentions";
import type { AiSessionScope } from "./scope";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		params,
		search,
		className,
		...rest
	}: {
		children?: ReactNode;
		to: string;
		params?: Record<string, string>;
		search?: Record<string, string>;
		className?: string;
	}) => {
		let href = to;
		for (const [key, value] of Object.entries(params ?? {})) {
			href = href.replace(`$${key}`, value);
		}
		if (search) href += `?${new URLSearchParams(search).toString()}`;
		return createElement("a", { href, className, ...rest }, children);
	},
}));

afterEach(() => {
	cleanup();
});

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

type PreviewEpic = RoadmapPreview["epics"][number];
type PreviewFeature = PreviewEpic["features"][number];
type PreviewTask = PreviewFeature["tasks"][number];
type PreviewMilestone = RoadmapPreview["milestones"][number];

function task(id: string, title: string, position = 0): PreviewTask {
	return {
		id,
		feature_id: "f",
		title,
		assignee_id: null,
		position,
		status: "todo",
		due_date: null,
		updated_at: "2026-01-01T00:00:00Z",
		assignee: null,
	} as unknown as PreviewTask;
}

function feature(
	id: string,
	title: string,
	tasks: PreviewTask[] = [],
	position = 0,
): PreviewFeature {
	return {
		id,
		roadmap_id: "r",
		epic_id: "e",
		title,
		position,
		tasks,
	} as unknown as PreviewFeature;
}

function epic(
	id: string,
	title: string,
	features: PreviewFeature[] = [],
	position = 0,
): PreviewEpic {
	return {
		id,
		roadmap_id: "r",
		title,
		position,
		status: "planned",
		features,
	} as unknown as PreviewEpic;
}

function milestone(id: string, title: string, position = 0): PreviewMilestone {
	return {
		id,
		roadmap_id: "r",
		title,
		target_date: null,
		status: "planned",
		position,
	} as unknown as PreviewMilestone;
}

function roadmap(
	id: string,
	name: string,
	options: {
		project?: {
			id: string;
			title: string;
			workspace_id?: string | null;
		} | null;
		epics?: PreviewEpic[];
		milestones?: PreviewMilestone[];
	} = {},
): RoadmapPreview {
	return {
		id,
		name,
		project_id: options.project?.id ?? null,
		project: options.project ?? null,
		owner_id: "u1",
		status: "active",
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
		epics: options.epics ?? [],
		milestones: options.milestones ?? [],
	} as unknown as RoadmapPreview;
}

function project(
	id: string,
	title: string,
	workspace_id: string | null = null,
): Project {
	return {
		id,
		title,
		status: "active",
		owner_id: "u1",
		workspace_id,
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
	} as unknown as Project;
}

function team(
	id: string,
	name: string,
	workspace_id: string | null = null,
): Team {
	return {
		id,
		owner_id: "u1",
		workspace_id,
		name,
		description: null,
		avatar_url: null,
		is_personal: false,
		time_tracking_enabled: false,
	} as unknown as Team;
}

const FLAT = { currentWorkspaceId: null, myWorkspaceIds: [] as string[] };

// -----------------------------------------------------------------------------
// getMentionContext
// -----------------------------------------------------------------------------

describe("getMentionContext", () => {
	it("opens on @ at the start of the text", () => {
		expect(getMentionContext("@onb", 4)).toEqual({ start: 0, query: "onb" });
	});

	it("opens on @ after whitespace", () => {
		expect(getMentionContext("hello @on", 9)).toEqual({
			start: 6,
			query: "on",
		});
		expect(getMentionContext("line\n@x", 7)).toEqual({ start: 5, query: "x" });
	});

	it("does not open mid-word (an email address)", () => {
		expect(getMentionContext("bob@x", 5)).toBeNull();
	});

	it("closes once the query contains whitespace", () => {
		expect(getMentionContext("@onb oard", 9)).toBeNull();
	});

	it("returns null without an @ before the caret", () => {
		expect(getMentionContext("plain text", 5)).toBeNull();
		expect(getMentionContext("", 0)).toBeNull();
	});

	it("only looks at the token before the caret", () => {
		// Caret sits inside "@onb" after the "o".
		expect(getMentionContext("@onb", 2)).toEqual({ start: 0, query: "o" });
	});
});

// -----------------------------------------------------------------------------
// buildAiMentionCandidates
// -----------------------------------------------------------------------------

describe("buildAiMentionCandidates", () => {
	const primary: AiMentionCandidate[] = [
		{
			kind: "roadmap",
			id: "r-focus",
			label: "Focus map",
			roadmapId: "r-focus",
		},
		{
			kind: "epic",
			id: "e-focus",
			label: "Focus epic",
			roadmapId: "r-focus",
			projectId: "p-focus",
		},
	];

	const roadmaps = [
		roadmap("r-focus", "Focus map", {
			project: { id: "p-focus", title: "Focus project", workspace_id: null },
			epics: [epic("e-focus-2", "Focus-only epic")],
		}),
		roadmap("r-onb", "Onboarding", {
			project: { id: "p1", title: "Client project", workspace_id: "ws-1" },
			epics: [
				epic(
					"e1",
					"Signup flow",
					[
						feature("f1", "Magic link", [task("t1", "Send email")]),
						feature("f2", "Password reset"),
					],
					1,
				),
				epic("e0", "Analytics", [], 0),
				epic("e2", "Release train", [], 2),
			],
			milestones: [milestone("m1", "Beta launch")],
		}),
		roadmap("r-standalone", "Standalone plan", { project: null }),
	];

	const projects = [
		project("p1", "Client project", "ws-1"),
		project("p2", "Side project", null),
	];

	const teams = [team("tm1", "Platform team", "ws-1")];

	it("returns one flat array in the fixed group order", () => {
		// Every fixture label contains an "e" except a few; use "e" to pull
		// something from every group at once.
		const results = buildAiMentionCandidates({
			query: "e",
			primary,
			projects,
			roadmaps,
			teams,
			currentWorkspaceId: "ws-1",
			myWorkspaceIds: ["ws-1"],
		});
		const groups: string[] = results.map((c) =>
			c.primary ? "primary" : c.kind,
		);
		const order = [
			"primary",
			"roadmap",
			"project",
			"epic",
			"feature",
			"task",
			"milestone",
			"team",
		];
		const seenOrder = groups.filter((g, i) => groups.indexOf(g) === i);
		expect(seenOrder).toEqual(order.filter((g) => seenOrder.includes(g)));
		expect(seenOrder).toContain("primary");
		expect(seenOrder).toContain("roadmap");
		expect(seenOrder).toContain("project");
		expect(seenOrder).toContain("epic");
		expect(seenOrder).toContain("feature");
		expect(seenOrder).toContain("task");
		expect(seenOrder).toContain("milestone");
		expect(seenOrder).toContain("team");
	});

	it("matches case-insensitively by substring", () => {
		const results = buildAiMentionCandidates({
			query: "ONBOARD",
			roadmaps,
			...FLAT,
		});
		expect(results.map((c) => c.label)).toEqual(["Onboarding"]);
	});

	it("dedupes by kind:id with primary winning", () => {
		const results = buildAiMentionCandidates({
			query: "focus",
			primary,
			roadmaps,
			projects,
			...FLAT,
		});
		const focusRows = results.filter((c) => c.id === "r-focus");
		expect(focusRows).toHaveLength(1);
		expect(focusRows[0].primary).toBe(true);
		expect(focusRows[0].kind).toBe("roadmap");
	});

	it("skips the focus roadmap's nodes in the general groups", () => {
		const results = buildAiMentionCandidates({
			query: "focus",
			primary,
			roadmaps,
			...FLAT,
		});
		// "Focus-only epic" lives on the focus roadmap, which primary covers.
		expect(results.find((c) => c.id === "e-focus-2")).toBeUndefined();
		// The primary epic is still there, from the primary list.
		expect(results.find((c) => c.id === "e-focus")?.primary).toBe(true);
	});

	it("applies the per-group caps", () => {
		const many = Array.from({ length: 8 }, (_, i) =>
			roadmap(`r${i}`, `Roadmap ${i}`),
		);
		const results = buildAiMentionCandidates({
			query: "roadmap",
			roadmaps: many,
			...FLAT,
		});
		expect(results.filter((c) => c.kind === "roadmap")).toHaveLength(4);
		expect(results.map((c) => c.id)).toEqual(["r0", "r1", "r2", "r3"]);

		const manyPrimary: AiMentionCandidate[] = Array.from(
			{ length: 9 },
			(_, i) => ({ kind: "task", id: `t${i}`, label: `Task ${i}` }),
		);
		const primaryOnly = buildAiMentionCandidates({
			query: "task",
			primary: manyPrimary,
			...FLAT,
		});
		expect(primaryOnly).toHaveLength(6);
	});

	it("applies the total cap of 16", () => {
		const manyPrimary: AiMentionCandidate[] = Array.from(
			{ length: 10 },
			(_, i) => ({ kind: "task", id: `pt${i}`, label: `Item ${i}` }),
		);
		const manyRoadmaps = Array.from({ length: 10 }, (_, i) =>
			roadmap(`r${i}`, `Item map ${i}`, {
				epics: [
					epic(`e${i}`, `Item epic ${i}`, [
						feature(`f${i}`, `Item feature ${i}`, [
							task(`t${i}`, `Item task ${i}`),
						]),
					]),
				],
				milestones: [milestone(`m${i}`, `Item milestone ${i}`)],
			}),
		);
		const manyProjects = Array.from({ length: 10 }, (_, i) =>
			project(`p${i}`, `Item project ${i}`),
		);
		const manyTeams = Array.from({ length: 10 }, (_, i) =>
			team(`tm${i}`, `Item team ${i}`),
		);
		const results = buildAiMentionCandidates({
			query: "item",
			primary: manyPrimary,
			roadmaps: manyRoadmaps,
			projects: manyProjects,
			teams: manyTeams,
			...FLAT,
		});
		expect(results).toHaveLength(AI_MENTION_TOTAL_CAP);
		expect(results.filter((c) => c.primary)).toHaveLength(6);
		expect(results.filter((c) => c.kind === "roadmap")).toHaveLength(4);
		expect(results.filter((c) => c.kind === "project")).toHaveLength(4);
		expect(results.filter((c) => c.kind === "epic")).toHaveLength(2);
	});

	it("orders roadmaps current -> shared -> other_workspace", () => {
		const lanes = [
			roadmap("r-other", "Lane other", {
				project: { id: "po", title: "Other org", workspace_id: "ws-2" },
			}),
			roadmap("r-unlinked", "Lane unlinked", { project: null }),
			roadmap("r-shared", "Lane shared", {
				project: { id: "ps", title: "Client org", workspace_id: "ws-x" },
			}),
			roadmap("r-current", "Lane current", {
				project: { id: "pc", title: "My org", workspace_id: "ws-1" },
			}),
		];
		const results = buildAiMentionCandidates({
			query: "lane",
			roadmaps: lanes,
			currentWorkspaceId: "ws-1",
			myWorkspaceIds: ["ws-1", "ws-2"],
		});
		expect(results.map((c) => c.id)).toEqual([
			"r-current",
			"r-unlinked",
			"r-shared",
			"r-other",
		]);
	});

	it("keeps other-workspace items (never drops them like groupByWorkspace)", () => {
		const results = buildAiMentionCandidates({
			query: "side",
			projects: [project("p-other", "Side org project", "ws-2")],
			currentWorkspaceId: "ws-1",
			myWorkspaceIds: ["ws-1", "ws-2"],
		});
		expect(results.map((c) => c.id)).toEqual(["p-other"]);
	});

	it("is flat (input order) when there is no current workspace", () => {
		const lanes = [
			roadmap("r-b", "Lane b", {
				project: { id: "pb", title: "B", workspace_id: "ws-2" },
			}),
			roadmap("r-a", "Lane a", {
				project: { id: "pa", title: "A", workspace_id: "ws-1" },
			}),
		];
		const results = buildAiMentionCandidates({
			query: "lane",
			roadmaps: lanes,
			currentWorkspaceId: null,
			myWorkspaceIds: ["ws-1", "ws-2"],
		});
		expect(results.map((c) => c.id)).toEqual(["r-b", "r-a"]);
	});

	it("treats an unlinked roadmap as shared", () => {
		expect(workspaceLane(null, "ws-1", new Set(["ws-1"]))).toBe("shared");
		expect(workspaceLane(undefined, "ws-1", new Set(["ws-1"]))).toBe("shared");
		expect(workspaceLane("ws-1", "ws-1", new Set(["ws-1"]))).toBe("current");
		expect(workspaceLane("ws-2", "ws-1", new Set(["ws-1", "ws-2"]))).toBe(
			"other_workspace",
		);
		expect(workspaceLane("ws-9", "ws-1", new Set(["ws-1"]))).toBe("shared");
	});

	it("returns the top-N preview shape for an empty query", () => {
		const manyPrimary: AiMentionCandidate[] = Array.from(
			{ length: 6 },
			(_, i) => ({ kind: "task", id: `pt${i}`, label: `Task ${i}` }),
		);
		const manyRoadmaps = Array.from({ length: 5 }, (_, i) =>
			roadmap(`r${i}`, `Map ${i}`, {
				epics: [epic(`e${i}`, `Epic ${i}`)],
			}),
		);
		const manyProjects = Array.from({ length: 5 }, (_, i) =>
			project(`p${i}`, `Project ${i}`),
		);
		const results = buildAiMentionCandidates({
			query: "",
			primary: manyPrimary,
			roadmaps: manyRoadmaps,
			projects: manyProjects,
			teams: [team("tm1", "Team")],
			...FLAT,
		});
		expect(results.filter((c) => c.primary)).toHaveLength(4);
		expect(results.filter((c) => c.kind === "roadmap")).toHaveLength(3);
		expect(results.filter((c) => c.kind === "project")).toHaveLength(3);
		expect(results.filter((c) => c.kind === "epic")).toHaveLength(0);
		expect(results.filter((c) => c.kind === "team")).toHaveLength(0);
		expect(results).toHaveLength(10);
	});

	it("walks nodes position-sorted and fills secondary/context fields", () => {
		const results = buildAiMentionCandidates({
			query: "a",
			roadmaps,
			...FLAT,
		});
		const epics = results.filter((c) => c.kind === "epic");
		// Position order (Analytics 0, Release train 2); "Signup flow" has no "a".
		expect(epics.map((c) => c.label)).toEqual(["Analytics", "Release train"]);
		expect(epics[0]).toMatchObject({
			roadmapId: "r-onb",
			projectId: "p1",
			workspaceId: "ws-1",
			secondary: "Onboarding",
		});

		const features = results.filter((c) => c.kind === "feature");
		expect(features.map((c) => c.label)).toEqual([
			"Magic link",
			"Password reset",
		]);
		expect(features[0].secondary).toBe("Onboarding · Signup flow");

		const tasks = results.filter((c) => c.kind === "task");
		expect(tasks.map((c) => c.label)).toEqual(["Send email"]);

		const milestones = results.filter((c) => c.kind === "milestone");
		expect(milestones.map((c) => c.label)).toEqual(["Beta launch"]);
		expect(milestones[0].roadmapId).toBe("r-onb");

		const roadmapRows = results.filter((c) => c.kind === "roadmap");
		expect(roadmapRows.find((c) => c.id === "r-standalone")?.secondary).toBe(
			"Standalone roadmap",
		);
		expect(roadmapRows.find((c) => c.id === "r-onb")?.secondary).toBe(
			"Client project",
		);
		expect(roadmapRows.find((c) => c.id === "r-onb")?.projectId).toBe("p1");
	});

	it("returns nothing when nothing matches", () => {
		expect(
			buildAiMentionCandidates({
				query: "zzzz",
				primary,
				roadmaps,
				projects,
				teams,
				...FLAT,
			}),
		).toEqual([]);
	});
});

// -----------------------------------------------------------------------------
// resolveEntityMentions / toAgentRefs
// -----------------------------------------------------------------------------

describe("resolveEntityMentions", () => {
	const onboarding: AiMentionPick = {
		kind: "roadmap",
		id: "r1",
		label: "Onboarding",
		roadmapId: "r1",
		projectId: "p1",
	};

	it("claims the first unclaimed occurrence and carries the pick fields", () => {
		const spans = resolveEntityMentions("Look at @Onboarding today", [
			onboarding,
		]);
		expect(spans).toEqual([{ ...onboarding, offset: 8, length: 11 }]);
	});

	it("maps two picks with the same label to two occurrences in order", () => {
		const spans = resolveEntityMentions("@Onboarding vs @Onboarding", [
			onboarding,
			{ ...onboarding, id: "r2" },
		]);
		expect(spans.map((s) => [s.id, s.offset])).toEqual([
			["r1", 0],
			["r2", 15],
		]);
	});

	it("drops a pick whose text was edited away", () => {
		const spans = resolveEntityMentions("Look at Onboarding", [onboarding]);
		expect(spans).toEqual([]);
	});

	it("sorts by offset regardless of pick order", () => {
		const team: AiMentionPick = { kind: "team", id: "t1", label: "Platform" };
		const spans = resolveEntityMentions("@Onboarding with @Platform", [
			team,
			onboarding,
		]);
		expect(spans.map((s) => s.kind)).toEqual(["roadmap", "team"]);
	});
});

describe("toAgentRefs", () => {
	it("dedupes by kind:id and strips everything but kind/id/label", () => {
		const spans: AiMentionSpan[] = [
			{
				kind: "roadmap",
				id: "r1",
				label: "Onboarding",
				roadmapId: "r1",
				projectId: "p1",
				offset: 0,
				length: 11,
			},
			{
				kind: "roadmap",
				id: "r1",
				label: "Onboarding",
				roadmapId: "r1",
				projectId: "p1",
				offset: 20,
				length: 11,
			},
			{
				kind: "epic",
				id: "r1",
				label: "Same id, other kind",
				offset: 40,
				length: 5,
			},
		];
		expect(toAgentRefs(spans)).toEqual([
			{ kind: "roadmap", id: "r1", label: "Onboarding" },
			{ kind: "epic", id: "r1", label: "Same id, other kind" },
		]);
	});

	it("caps the wire refs at MAX_AGENT_REFS distinct items (the agent 422s past 20)", () => {
		const spans: AiMentionSpan[] = Array.from({ length: 25 }, (_, i) => ({
			kind: "task" as const,
			id: `t${i}`,
			label: `Task ${i}`,
			offset: i * 10,
			length: 6,
		}));
		const refs = toAgentRefs(spans);
		expect(MAX_AGENT_REFS).toBe(20);
		expect(refs).toHaveLength(MAX_AGENT_REFS);
		expect(refs[0]).toEqual({ kind: "task", id: "t0", label: "Task 0" });
		expect(refs[19]).toEqual({ kind: "task", id: "t19", label: "Task 19" });
	});
});

// -----------------------------------------------------------------------------
// Destinations
// -----------------------------------------------------------------------------

describe("resolveAiEntityDestination", () => {
	const workspaceScope: AiSessionScope = {
		kind: "workspace",
		workspaceId: "ws-1",
		slug: "acme",
	};
	const roadmapScope: AiSessionScope = {
		kind: "roadmap",
		roadmapId: "r1",
		projectId: "p1",
	};

	it("links a project to its roadmap page", () => {
		expect(
			resolveAiEntityDestination({ kind: "project", id: "p1", label: "P" }),
		).toEqual({
			to: "/project/$projectId/roadmap",
			params: { projectId: "p1" },
		});
	});

	it("uses the n sentinel for a project-less roadmap", () => {
		expect(
			resolveAiEntityDestination({
				kind: "roadmap",
				id: "r1",
				label: "R",
				projectId: null,
			}),
		).toEqual({
			to: "/project/$projectId/roadmap/$roadmapId",
			params: { projectId: "n", roadmapId: "r1" },
		});
	});

	it("deep-links nodes with nodeId and returns null without a roadmap id", () => {
		expect(
			resolveAiEntityDestination({
				kind: "task",
				id: "t1",
				label: "T",
				roadmapId: "r1",
				projectId: "p1",
			}),
		).toEqual({
			to: "/project/$projectId/roadmap/$roadmapId",
			params: { projectId: "p1", roadmapId: "r1" },
			search: { nodeId: "t1" },
		});
		expect(
			resolveAiEntityDestination({ kind: "epic", id: "e1", label: "E" }),
		).toBeNull();
	});

	it("links teams only in workspace scope", () => {
		const pick: AiMentionPick = { kind: "team", id: "tm1", label: "Team" };
		expect(resolveAiEntityDestination(pick, workspaceScope)).toEqual({
			to: "/w/$workspaceSlug/teams/$teamId",
			params: { workspaceSlug: "acme", teamId: "tm1" },
		});
		expect(resolveAiEntityDestination(pick, roadmapScope)).toBeNull();
		expect(resolveAiEntityDestination(pick)).toBeNull();
	});
});

// -----------------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------------

describe("renderEntityMentionContent", () => {
	const content = "Ship @Onboarding with @Platform team";
	const spans: AiMentionSpan[] = [
		{
			kind: "roadmap",
			id: "r1",
			label: "Onboarding",
			roadmapId: "r1",
			projectId: null,
			offset: 5,
			length: 11,
		},
		{ kind: "team", id: "tm1", label: "Platform", offset: 22, length: 9 },
	];

	it("returns the raw string without spans", () => {
		expect(
			renderEntityMentionContent(content, undefined, { tone: "onSurface" }),
		).toBe(content);
		expect(renderEntityMentionContent(content, [], { tone: "onSurface" })).toBe(
			content,
		);
	});

	it("renders Link chips for linkable spans and plain chips otherwise", () => {
		const { container } = render(
			createElement(
				"p",
				null,
				renderEntityMentionContent(content, spans, {
					tone: "onSurface",
					scope: { kind: "roadmap", roadmapId: "r9", projectId: "p9" },
				}),
			),
		);
		const link = container.querySelector("a");
		expect(link?.textContent).toBe("@Onboarding");
		expect(link?.getAttribute("href")).toBe("/project/n/roadmap/r1");
		expect(link?.className).toContain("bg-primary/10 text-primary");
		expect(link?.className).not.toContain("violet");

		const plain = container.querySelector("span[data-mention-kind='team']");
		expect(plain?.textContent).toBe("@Platform");
		expect(plain?.className).toContain("bg-primary/10 text-primary");
		expect(container.textContent).toBe(content);
	});

	it("links teams in workspace scope and uses the gradient tone classes", () => {
		const { container } = render(
			createElement(
				"p",
				null,
				renderEntityMentionContent(content, spans, {
					tone: "onGradient",
					scope: { kind: "workspace", workspaceId: "ws-1", slug: "acme" },
				}),
			),
		);
		const links = container.querySelectorAll("a");
		expect(links).toHaveLength(2);
		expect(links[1].getAttribute("href")).toBe("/w/acme/teams/tm1");
		expect(links[1].className).toContain(
			"bg-primary-foreground/20 text-primary-foreground",
		);
	});

	it("deep-links nodes with the nodeId search param", () => {
		const { container } = render(
			createElement(
				"p",
				null,
				renderEntityMentionContent(
					"Fix @Magic link",
					[
						{
							kind: "feature",
							id: "f1",
							label: "Magic link",
							roadmapId: "r1",
							projectId: "p1",
							offset: 4,
							length: 11,
						},
					],
					{ tone: "onSurface" },
				),
			),
		);
		expect(container.querySelector("a")?.getAttribute("href")).toBe(
			"/project/p1/roadmap/r1?nodeId=f1",
		);
	});

	it("drops out-of-bounds and overlapping spans", () => {
		const { container } = render(
			createElement(
				"p",
				null,
				renderEntityMentionContent(
					"@Alpha @Beta",
					[
						{ kind: "team", id: "a", label: "Alpha", offset: 0, length: 6 },
						// Overlaps the first span.
						{ kind: "team", id: "x", label: "lpha", offset: 2, length: 4 },
						// Runs past the end of the content.
						{ kind: "team", id: "b", label: "Beta", offset: 7, length: 40 },
						// Non-integer offset.
						{ kind: "team", id: "c", label: "C", offset: 1.5, length: 2 },
					],
					{ tone: "onSurface" },
				),
			),
		);
		const chips = container.querySelectorAll("[data-mention-kind]");
		expect(chips).toHaveLength(1);
		expect(chips[0].textContent).toBe("@Alpha");
		expect(container.textContent).toBe("@Alpha @Beta");
	});
});

describe("renderHighlightBackdrop", () => {
	it("wraps ranges in a primary pill and keeps the trailing text", () => {
		const { container } = render(
			createElement(
				"div",
				null,
				renderHighlightBackdrop("Ship @Onboarding now", [
					{ offset: 5, length: 11 },
				]),
			),
		);
		const pill = container.querySelector("span");
		expect(pill?.textContent).toBe("@Onboarding");
		expect(pill?.className).toContain("bg-primary/15");
		expect(pill?.className).not.toContain("violet");
		// Trailing zero-width space keeps a trailing newline's line height.
		expect(container.textContent).toBe("Ship @Onboarding now​");
	});

	it("skips overlapping and out-of-bounds ranges", () => {
		const { container } = render(
			createElement(
				"div",
				null,
				renderHighlightBackdrop("@A @B", [
					{ offset: 0, length: 2 },
					{ offset: 1, length: 2 },
					{ offset: 3, length: 10 },
				]),
			),
		);
		expect(container.querySelectorAll("span")).toHaveLength(1);
	});
});

// -----------------------------------------------------------------------------
// Context-only refs: isInlineSpan / buildSendRefs / chips
// -----------------------------------------------------------------------------

const CTX_ROADMAP: AiMentionPick = {
	kind: "roadmap",
	id: "r1",
	label: "Onboarding",
	roadmapId: "r1",
	projectId: "p1",
};
const CTX_PROJECT: AiMentionPick = {
	kind: "project",
	id: "p1",
	label: "Client project",
	projectId: "p1",
};
const CTX_EPIC: AiMentionPick = {
	kind: "epic",
	id: "e1",
	label: "Signup flow",
	roadmapId: "r1",
	projectId: "p1",
};

describe("isInlineSpan", () => {
	it("is true for a text-anchored span and false for the context-only sentinel", () => {
		expect(isInlineSpan({ offset: 0, length: 5 })).toBe(true);
		expect(isInlineSpan(CONTEXT_ONLY_SPAN)).toBe(false);
		expect(isInlineSpan({ offset: -1, length: 0 })).toBe(false);
		expect(isInlineSpan({ offset: 3, length: 0 })).toBe(false);
		expect(isInlineSpan({ offset: 1.5, length: 2 })).toBe(false);
	});

	it("keeps the sentinel integer-valued so persistence accepts it", () => {
		expect(Number.isInteger(CONTEXT_ONLY_SPAN.offset)).toBe(true);
		expect(Number.isInteger(CONTEXT_ONLY_SPAN.length)).toBe(true);
	});
});

describe("buildSendRefs", () => {
	it("puts inline spans first, then unmatched picks and auto refs as context-only spans", () => {
		const refs = buildSendRefs(
			"Fix @Signup flow today",
			[CTX_EPIC, { kind: "team", id: "tm1", label: "Platform" }],
			[CTX_ROADMAP, CTX_PROJECT],
		);
		expect(refs).toEqual([
			{ ...CTX_EPIC, offset: 4, length: 12 },
			{ kind: "team", id: "tm1", label: "Platform", offset: -1, length: 0 },
			{ ...CTX_ROADMAP, offset: -1, length: 0 },
			{ ...CTX_PROJECT, offset: -1, length: 0 },
		]);
	});

	it("dedupes by kind:id with the inline span winning", () => {
		expect(
			buildSendRefs(
				"Ship @Onboarding",
				[CTX_ROADMAP],
				[CTX_ROADMAP, CTX_PROJECT],
			),
		).toEqual([
			{ ...CTX_ROADMAP, offset: 5, length: 11 },
			{ ...CTX_PROJECT, offset: -1, length: 0 },
		]);
		// Repeated picks of one entity collapse to a single context chip.
		expect(
			buildSendRefs(
				"no mentions",
				[CTX_PROJECT, { ...CTX_PROJECT }],
				[CTX_PROJECT],
			),
		).toEqual([{ ...CTX_PROJECT, offset: -1, length: 0 }]);
	});

	it("sends only context-only spans for a message without @-mentions", () => {
		const refs = buildSendRefs("hello", [], [CTX_ROADMAP]);
		expect(refs).toEqual([{ ...CTX_ROADMAP, ...CONTEXT_ONLY_SPAN }]);
		expect(refs.every((span) => !isInlineSpan(span))).toBe(true);
		// The wire shape is unchanged.
		expect(toAgentRefs(refs)).toEqual([
			{ kind: "roadmap", id: "r1", label: "Onboarding" },
		]);
		// And the inline renderer ignores the sentinel.
		expect(
			renderEntityMentionContent("hello", refs, { tone: "onSurface" }),
		).toBe("hello");
	});

	it("is empty with no picks and no auto refs", () => {
		expect(buildSendRefs("hello", [])).toEqual([]);
	});

	it("caps at MAX_AGENT_REFS, trimming the context-only tail", () => {
		const auto: AiMentionPick[] = Array.from({ length: 25 }, (_, i) => ({
			kind: "task",
			id: `t${i}`,
			label: `Task ${i}`,
		}));
		const refs = buildSendRefs("Fix @Signup flow", [CTX_EPIC], auto);
		expect(refs).toHaveLength(MAX_AGENT_REFS);
		expect(refs[0]).toMatchObject({ kind: "epic", offset: 4 });
		expect(refs[19]).toMatchObject({ kind: "task", id: "t18" });
	});
});

describe("buildContextChips / mentionRefKey / toMentionPick", () => {
	it("lists auto refs first, then picks, deduped with auto winning", () => {
		const chips = buildContextChips(
			[CTX_ROADMAP, CTX_PROJECT],
			[CTX_ROADMAP, CTX_EPIC],
		);
		expect(chips.map((c) => [c.key, c.source])).toEqual([
			["roadmap:r1", "auto"],
			["project:p1", "auto"],
			["epic:e1", "picked"],
		]);
		expect(chips[2]).toMatchObject({ label: "Signup flow", roadmapId: "r1" });
		expect(buildContextChips([], [])).toEqual([]);
	});

	it("keys by kind:id", () => {
		expect(mentionRefKey({ kind: "task", id: "t1" })).toBe("task:t1");
	});

	it("copies only the pick fields from a candidate", () => {
		expect(
			toMentionPick({
				kind: "epic",
				id: "e1",
				label: "Signup flow",
				secondary: "Onboarding",
				roadmapId: "r1",
				projectId: "p1",
				workspaceId: "ws-1",
				primary: true,
			}),
		).toEqual(CTX_EPIC);
		expect(
			toMentionPick({
				kind: "team",
				id: "tm1",
				label: "Platform",
				workspaceId: "ws-1",
			}),
		).toEqual({ kind: "team", id: "tm1", label: "Platform" });
		expect(
			toMentionPick({
				kind: "roadmap",
				id: "r2",
				label: "Standalone",
				roadmapId: "r2",
				projectId: null,
			}),
		).toEqual({
			kind: "roadmap",
			id: "r2",
			label: "Standalone",
			roadmapId: "r2",
			projectId: null,
		});
	});
});

describe("contextRefsForMessage", () => {
	it("returns the refs that did not render inline, deduped", () => {
		const refs: AiMentionSpan[] = [
			{ ...CTX_EPIC, offset: 4, length: 12 },
			{ ...CTX_ROADMAP, ...CONTEXT_ONLY_SPAN },
			{ ...CTX_ROADMAP, ...CONTEXT_ONLY_SPAN },
			{ ...CTX_PROJECT, ...CONTEXT_ONLY_SPAN },
		];
		expect(
			contextRefsForMessage("Fix @Signup flow", refs).map((r) => r.id),
		).toEqual(["r1", "p1"]);
	});

	it("treats an inline span that no longer fits the content as context", () => {
		const refs: AiMentionSpan[] = [{ ...CTX_EPIC, offset: 40, length: 12 }];
		expect(contextRefsForMessage("short", refs)).toEqual(refs);
	});

	it("is empty without refs or when every ref is inline", () => {
		expect(contextRefsForMessage("x", undefined)).toEqual([]);
		expect(contextRefsForMessage("x", [])).toEqual([]);
		expect(
			contextRefsForMessage("Fix @Signup flow", [
				{ ...CTX_EPIC, offset: 4, length: 12 },
			]),
		).toEqual([]);
	});
});
