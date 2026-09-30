import { describe, expect, it } from "vitest";
import { openTeamInvites, type TeamInvite } from "./teams.service";

const invite = (overrides: Partial<TeamInvite>): TeamInvite => ({
	id: "i",
	team_id: "t",
	invited_by: null,
	invitee_id: null,
	invitee_email: "ada@example.test",
	role: "member",
	position: null,
	status: "pending",
	message: null,
	responded_at: null,
	created_at: "2026-09-01T00:00:00Z",
	updated_at: "2026-09-01T00:00:00Z",
	...overrides,
});

describe("openTeamInvites", () => {
	it("shows pending and expired invites, never settled ones", () => {
		const list = openTeamInvites([
			invite({ id: "p", invitee_email: "a@x.test" }),
			invite({ id: "e", status: "expired", invitee_email: "b@x.test" }),
			invite({ id: "c", status: "cancelled", invitee_email: "c@x.test" }),
			invite({ id: "a", status: "accepted", invitee_email: "d@x.test" }),
		]);
		expect(list.map((entry) => entry.id)).toEqual(["p", "e"]);
	});

	it("hides an expired invite once the person has a newer pending one", () => {
		const list = openTeamInvites([
			invite({ id: "new", status: "pending" }),
			invite({ id: "old", status: "expired" }),
		]);
		expect(list.map((entry) => entry.id)).toEqual(["new"]);
	});

	it("shows one expired row per person", () => {
		const list = openTeamInvites([
			invite({ id: "e2", status: "expired" }),
			invite({ id: "e1", status: "expired" }),
		]);
		expect(list.map((entry) => entry.id)).toEqual(["e2"]);
	});
});
