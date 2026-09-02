import { describe, expect, it } from "vitest";
import { computeDetachOutcomes, type DetachCandidate } from "./detachOutcomes";

const TEAM = "team-1";
const OTHER_TEAM = "team-2";

function person(over: Partial<DetachCandidate> & { userId: string }) {
	return {
		role: "editor",
		hasDirectGrant: false,
		curatedTeamIds: [TEAM],
		...over,
	};
}

describe("computeDetachOutcomes", () => {
	it("removes only members sustained solely by the detached team", () => {
		const teamOnly = person({ userId: "u-lose" });
		const { losesAccess, keepsAccess } = computeDetachOutcomes(
			[teamOnly],
			TEAM,
		);
		expect(losesAccess).toEqual([teamOnly]);
		expect(keepsAccess).toEqual([]);
	});

	it("keeps direct members, owners, and people on another attached team", () => {
		const direct = person({ userId: "u-direct", hasDirectGrant: true });
		const roleOwner = person({ userId: "u-owner", role: "owner" });
		const multiTeam = person({
			userId: "u-multi",
			curatedTeamIds: [TEAM, OTHER_TEAM],
		});
		const { losesAccess, keepsAccess } = computeDetachOutcomes(
			[direct, roleOwner, multiTeam],
			TEAM,
		);
		expect(losesAccess).toEqual([]);
		expect(keepsAccess).toEqual([
			{ person: direct, reason: "direct" },
			{ person: roleOwner, reason: "owner" },
			{ person: multiTeam, reason: "other-team" },
		]);
	});

	it("protects the projects.owner_id holder even when their role is not owner", () => {
		// A client-mode creator holds role "admin" but is projects.owner_id;
		// the trigger's owner guard checks both.
		const creator = person({ userId: "u-creator", role: "admin" });
		const { losesAccess, keepsAccess } = computeDetachOutcomes(
			[creator],
			TEAM,
			"u-creator",
		);
		expect(losesAccess).toEqual([]);
		expect(keepsAccess).toEqual([{ person: creator, reason: "owner" }]);
	});

	it("leaves people with no curation row for this team untouched", () => {
		// e.g. an origin-label straggler: origin says team:<id> but the
		// curation row is long gone — the detach deletes nothing of theirs.
		const stranger = person({
			userId: "u-other",
			curatedTeamIds: [OTHER_TEAM],
		});
		const uncurated = person({ userId: "u-none", curatedTeamIds: [] });
		const { losesAccess, keepsAccess } = computeDetachOutcomes(
			[stranger, uncurated],
			TEAM,
		);
		expect(losesAccess).toEqual([]);
		expect(keepsAccess).toEqual([
			{ person: stranger, reason: "not-curated" },
			{ person: uncurated, reason: "not-curated" },
		]);
	});

	it("owner protection outranks the direct-grant reason", () => {
		const owner = person({
			userId: "u-owner",
			role: "owner",
			hasDirectGrant: true,
		});
		const { keepsAccess } = computeDetachOutcomes([owner], TEAM);
		expect(keepsAccess).toEqual([{ person: owner, reason: "owner" }]);
	});
});
