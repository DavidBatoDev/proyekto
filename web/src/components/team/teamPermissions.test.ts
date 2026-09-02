import { describe, expect, it } from "vitest";
import type { Team, TeamMember } from "@/services/teams.service";
import { canEditTeam, isTeamOwner } from "./teamPermissions";

const OWNER = "user-owner";
const ADMIN = "user-admin";
const MEMBER = "user-member";
const STRANGER = "user-stranger";

const TEAM = { id: "team-1", owner_id: OWNER } as Team;

const MEMBERS = [
	{ user_id: OWNER, role: "owner" },
	{ user_id: ADMIN, role: "admin" },
	{ user_id: MEMBER, role: "member" },
] as TeamMember[];

describe("canEditTeam", () => {
	it("lets the owner edit", () => {
		expect(canEditTeam(TEAM, MEMBERS, OWNER)).toBe(true);
	});

	it("lets a team admin edit", () => {
		expect(canEditTeam(TEAM, MEMBERS, ADMIN)).toBe(true);
	});

	it("does not let a plain member edit", () => {
		expect(canEditTeam(TEAM, MEMBERS, MEMBER)).toBe(false);
	});

	it("does not let a non-member edit", () => {
		expect(canEditTeam(TEAM, MEMBERS, STRANGER)).toBe(false);
	});

	it("lets the owner edit even before the member list has loaded", () => {
		// owner_id is on the team row itself, so the owner never has to wait for
		// the roster to arrive before the page becomes editable.
		expect(canEditTeam(TEAM, undefined, OWNER)).toBe(true);
	});

	it("denies an admin while the member list is still loading, rather than flashing editable", () => {
		expect(canEditTeam(TEAM, undefined, ADMIN)).toBe(false);
		expect(canEditTeam(TEAM, [], ADMIN)).toBe(false);
	});

	it("denies when signed out", () => {
		expect(canEditTeam(TEAM, MEMBERS, null)).toBe(false);
		expect(canEditTeam(TEAM, MEMBERS, undefined)).toBe(false);
	});

	it("denies when the team has not loaded", () => {
		expect(canEditTeam(null, MEMBERS, OWNER)).toBe(false);
	});
});

describe("isTeamOwner", () => {
	it("is true only for the owner", () => {
		expect(isTeamOwner(TEAM, OWNER)).toBe(true);
		expect(isTeamOwner(TEAM, ADMIN)).toBe(false);
		expect(isTeamOwner(TEAM, null)).toBe(false);
		expect(isTeamOwner(null, OWNER)).toBe(false);
	});
});
