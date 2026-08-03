import { describe, expect, it } from "vitest";
import {
	buildMentionCandidates,
	isLikelyEmail,
	matchMentionQuery,
} from "./mentionCandidates";

const users = [
	{ id: "u-1", display_name: "Ada Lovelace" },
	{ id: "u-2", display_name: "Grace Hopper" },
];

describe("matchMentionQuery", () => {
	it("opens on @ at the start of the text", () => {
		expect(matchMentionQuery("@")).toEqual({ query: "", atOffset: 0 });
	});

	it("captures a partial name", () => {
		expect(matchMentionQuery("hi @ad")).toEqual({ query: "ad", atOffset: 3 });
	});

	it("captures a whole email address", () => {
		// The old /@(\w*)$/ could not do this at all: \w excludes @ and .
		expect(matchMentionQuery("hi @alice@example.com")).toEqual({
			query: "alice@example.com",
			atOffset: 3,
		});
	});

	it("captures a half-typed address", () => {
		expect(matchMentionQuery("@alice@exa")).toEqual({
			query: "alice@exa",
			atOffset: 0,
		});
	});

	it("does NOT open on an address typed in prose", () => {
		// The bug the leading (^|\s) fixes. Previously this matched "@x.co" and
		// opened the picker mid-word; it only looked harmless because the dropdown
		// renders nothing when no member matches.
		expect(matchMentionQuery("mail me at bob@x.co")).toBeNull();
	});

	it("does not open on an @ glued to the end of a word", () => {
		expect(matchMentionQuery("foo@")).toBeNull();
	});

	it("stops at whitespace", () => {
		expect(matchMentionQuery("@ada then more")).toBeNull();
	});
});

describe("isLikelyEmail", () => {
	it.each(["alice@example.com", "a.b+c@sub.example.co.uk"])(
		"accepts %s",
		(value) => {
			expect(isLikelyEmail(value)).toBe(true);
		},
	);

	it.each(["ada", "alice@", "@example.com", "alice@example", ""])(
		"rejects %s",
		(value) => {
			expect(isLikelyEmail(value)).toBe(false);
		},
	);
});

describe("buildMentionCandidates", () => {
	it("filters members by display name", () => {
		expect(buildMentionCandidates(users, "ada", true)).toEqual([
			{ kind: "user", user: users[0] },
		]);
	});

	it("offers an invite row for a typed address", () => {
		const out = buildMentionCandidates(users, "new@example.com", true);

		expect(out).toEqual([{ kind: "email", email: "new@example.com" }]);
	});

	it("offers nothing extra when the author cannot invite", () => {
		// The server gate is authoritative; this only hides the affordance.
		expect(buildMentionCandidates(users, "new@example.com", false)).toEqual([]);
	});

	it("does not offer an invite for a partial address", () => {
		expect(buildMentionCandidates(users, "new@exa", true)).toEqual([]);
	});

	it("puts the invite row last so member matches keep their indices", () => {
		const withMatch = [
			...users,
			{ id: "u-3", display_name: "new@example.com" },
		];
		const out = buildMentionCandidates(withMatch, "new@example.com", true);

		// The address belongs to an existing member: mention them, do not
		// re-invite them.
		expect(out).toEqual([{ kind: "user", user: withMatch[2] }]);
	});

	it("lowercases the offered address", () => {
		expect(buildMentionCandidates([], "New@Example.COM", true)).toEqual([
			{ kind: "email", email: "new@example.com" },
		]);
	});
});
