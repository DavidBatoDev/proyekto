import { describe, expect, it } from "vitest";
import type { ProjectMember } from "@/services/project.service";
import {
	accessSources,
	classifyPerson,
	likelyCanEdit,
	summarize,
	teamIdFromOrigin,
} from "./projectPeople";

const TEAM = "11111111-2222-3333-4444-555555555555";

function member(overrides: Partial<ProjectMember> = {}): ProjectMember {
	return {
		id: "row-1",
		project_id: "p1",
		user_id: "u1",
		role: "viewer",
		...overrides,
	};
}

describe("teamIdFromOrigin", () => {
	it("extracts the id from a team origin", () => {
		expect(teamIdFromOrigin(`team:${TEAM}`)).toBe(TEAM);
	});

	it("returns null for direct origins and junk", () => {
		for (const origin of [
			"client",
			"consultant",
			"invited",
			"",
			null,
			"team:",
		]) {
			expect(teamIdFromOrigin(origin)).toBeNull();
		}
	});
});

describe("classifyPerson", () => {
	it("treats team-derived access as internal", () => {
		expect(classifyPerson([member({ origin: `team:${TEAM}` })])).toBe(
			"internal",
		);
	});

	it("treats a personal project as internal, under either origin spelling", () => {
		// The DB still writes 'personal_workspace'; new rows may say
		// 'personal_project'. Both mean the personal project.
		expect(classifyPerson([member({ origin: "personal_project" })])).toBe(
			"internal",
		);
		expect(classifyPerson([member({ origin: "personal_workspace" })])).toBe(
			"internal",
		);
	});

	it("treats every non-team grant as external, including a direct one", () => {
		// 'direct' covers the rows that used to say 'client' or 'consultant'. The
		// classification only ever meant "reachable through one of your teams",
		// and a direct grant is not — whoever holds it.
		expect(classifyPerson([member({ origin: "direct" })])).toBe("external");
		expect(classifyPerson([member({ origin: "invited" })])).toBe("external");
		expect(classifyPerson([member({ origin: "legacy" })])).toBe("external");
		expect(classifyPerson([member({ origin: null })])).toBe("external");
	});

	it("counts someone as internal if ANY grant is internal", () => {
		// Mislabelling a teammate as external is the worse of the two errors.
		expect(
			classifyPerson([
				member({ origin: "invited" }),
				member({ id: "row-2", origin: `team:${TEAM}` }),
			]),
		).toBe("internal");
	});
});

describe("accessSources", () => {
	it("names the team when it can resolve it", () => {
		const sources = accessSources([member({ origin: `team:${TEAM}` })], {
			[TEAM]: "Engineering",
		});
		expect(sources).toHaveLength(1);
		expect(sources[0].kind).toBe("team");
		expect(sources[0].teamId).toBe(TEAM);
		expect(sources[0].label).toContain("Engineering");
	});

	it("degrades gracefully when the team name has not loaded", () => {
		const sources = accessSources([member({ origin: `team:${TEAM}` })], {});
		expect(sources[0].label).toBe("Member of a team attached to this project");
	});

	it("de-duplicates repeated origins", () => {
		const sources = accessSources(
			[
				member({ origin: `team:${TEAM}` }),
				member({ id: "row-2", origin: `team:${TEAM}` }),
			],
			{ [TEAM]: "Engineering" },
		);
		expect(sources).toHaveLength(1);
	});

	it("lists a direct grant and a team grant separately", () => {
		const sources = accessSources(
			[
				member({ origin: "invited" }),
				member({ id: "row-2", origin: `team:${TEAM}` }),
			],
			{ [TEAM]: "Design" },
		);
		expect(sources.map((s) => s.kind)).toEqual(["direct", "team"]);
	});

	it("labels the personal project under either origin spelling", () => {
		for (const origin of ["personal_project", "personal_workspace"]) {
			const sources = accessSources([member({ origin })], {});
			expect(sources[0].label).toBe("Owner of this personal project");
		}
	});

	it("falls back to a generic label for an unrecognised origin", () => {
		const sources = accessSources([member({ origin: "something_new" })], {});
		expect(sources[0].label).toBe("Added directly to this project");
	});
});

describe("likelyCanEdit", () => {
	it("is true from editor up the share_role ladder", () => {
		for (const role of ["owner", "admin", "editor"] as const) {
			expect(likelyCanEdit([member({ role })])).toBe(true);
		}
	});

	// "consultant" and "member" used to be listed as editor-ish roles. Neither is
	// a share_role (the ladder is viewer|commenter|editor|admin|owner), so
	// neither could ever appear in `role` — the entries matched nothing.
	it("is false for anything outside the ladder", () => {
		for (const role of [
			"viewer",
			"commenter",
			"consultant",
			"member",
		] as const) {
			expect(likelyCanEdit([member({ role })])).toBe(false);
		}
	});

	it("lets an explicit capability override the role baseline both ways", () => {
		expect(
			likelyCanEdit([
				member({
					role: "viewer",
					capabilities: { "project.edit_content": true },
				}),
			]),
		).toBe(true);
		expect(
			likelyCanEdit([
				member({
					role: "admin",
					capabilities: { "project.edit_content": false },
				}),
			]),
		).toBe(false);
	});
});

describe("summarize", () => {
	it("counts editors, view-only and external people", () => {
		expect(
			summarize([
				[member({ role: "owner", origin: "direct" })],
				[member({ role: "editor", origin: `team:${TEAM}` })],
				[member({ role: "viewer", origin: "direct" })],
			]),
			// The owner holds a direct grant, so they are "external" too: two of
			// the three are not reachable through a team.
		).toEqual({ total: 3, canEdit: 2, viewOnly: 1, external: 2 });
	});

	it("handles an empty project", () => {
		expect(summarize([])).toEqual({
			total: 0,
			canEdit: 0,
			viewOnly: 0,
			external: 0,
		});
	});
});
