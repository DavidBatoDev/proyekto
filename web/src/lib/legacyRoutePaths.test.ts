import { describe, expect, it } from "vitest";
import { mapLegacyPath } from "./legacyRoutePaths";

describe("mapLegacyPath", () => {
	it("rewrites a bare moved path", () => {
		expect(mapLegacyPath("/finance")).toBe("/engagements/finance");
		expect(mapLegacyPath("/project-posting")).toBe("/project/new");
		expect(mapLegacyPath("/marketplace/project-posting")).toBe("/project/new");
	});

	// notifications.link_url in production holds exactly this shape.
	it("keeps path params and the query string", () => {
		expect(mapLegacyPath("/finance/abc-123?section=signatures")).toBe(
			"/engagements/finance/abc-123?section=signatures",
		);
		expect(mapLegacyPath("/finance?tab=invoices&projectId=p1")).toBe(
			"/engagements/finance?tab=invoices&projectId=p1",
		);
	});

	// Finance moved twice; both generations of persisted URL land on the
	// current home in one hop.
	it("rewrites the marketplace-era finance paths", () => {
		expect(mapLegacyPath("/marketplace/finance")).toBe("/engagements/finance");
		expect(mapLegacyPath("/marketplace/finance/abc-123?section=signatures")).toBe(
			"/engagements/finance/abc-123?section=signatures",
		);
		expect(mapLegacyPath("/marketplace/finance?tab=invoices&projectId=p1")).toBe(
			"/engagements/finance?tab=invoices&projectId=p1",
		);
	});

	it("keeps the hash", () => {
		expect(mapLegacyPath("/consultant/browse#results")).toBe(
			"/marketplace/consultant/browse#results",
		);
	});

	it("prefers the longer prefix", () => {
		expect(mapLegacyPath("/consultant/apply")).toBe(
			"/marketplace/consultant/apply",
		);
		expect(mapLegacyPath("/consultant/some-profile-id")).toBe(
			"/marketplace/consultant/some-profile-id",
		);
	});

	it("sends the old consultant talent pool to its renamed home", () => {
		expect(mapLegacyPath("/consultant/marketplace")).toBe(
			"/marketplace/talent/browse",
		);
	});

	it("only matches on a segment boundary", () => {
		// A route that merely starts with the same letters must not be rewritten.
		expect(mapLegacyPath("/financial-report")).toBe("/financial-report");
		expect(mapLegacyPath("/consultants")).toBe("/consultants");
	});

	it("leaves /freelancer/invites alone", () => {
		// A live SQL trigger still writes this exact string, and it has its own
		// top-level shim to /invites.
		expect(mapLegacyPath("/freelancer/invites")).toBe("/freelancer/invites");
		expect(mapLegacyPath("/freelancer/invites?inviteId=x")).toBe(
			"/freelancer/invites?inviteId=x",
		);
	});

	it("leaves /freelancer/profile alone", () => {
		expect(mapLegacyPath("/freelancer/profile")).toBe("/freelancer/profile");
	});

	it("leaves the account-free contract signing path alone", () => {
		// /contract/sign did not move. It is mailed to clients who may have no
		// login, and this map only runs in signed-in contexts — rewriting it
		// would strand exactly the person the page exists for.
		expect(mapLegacyPath("/contract/sign/abc123")).toBe(
			"/contract/sign/abc123",
		);
		expect(mapLegacyPath("/contract/sign")).toBe("/contract/sign");
	});

	it("passes through unrelated and already-migrated paths", () => {
		expect(mapLegacyPath("/dashboard")).toBe("/dashboard");
		expect(mapLegacyPath("/engagements/finance")).toBe("/engagements/finance");
		expect(mapLegacyPath("/invites")).toBe("/invites");
	});

	it("ignores anything that is not an app path", () => {
		expect(mapLegacyPath("https://example.com/finance")).toBe(
			"https://example.com/finance",
		);
		expect(mapLegacyPath("")).toBe("");
	});
});
