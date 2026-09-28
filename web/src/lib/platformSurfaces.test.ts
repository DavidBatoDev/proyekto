import { describe, expect, it } from "vitest";
import {
	classifySurface,
	filterNavByPlatform,
	isVisibleInApp,
	nativeDestinationFor,
} from "./platformSurfaces";

/**
 * No mocks anywhere in this file — `classifySurface` takes no platform, and the
 * two platform-aware helpers take it as an argument. That is the whole reason
 * the module is shaped this way.
 */

describe("classifySurface", () => {
	it("hides the commerce surfaces, under either URL shape", () => {
		expect(classifySurface("/pricing")).toBe("commerce");
		expect(classifySurface("/w/acme/settings/billing")).toBe("commerce");
		expect(classifySurface("/w/acme/settings/usage")).toBe("commerce");
		// The bare legacy shells that persisted links still point at.
		expect(classifySurface("/workspace/settings/billing")).toBe("commerce");
	});

	it("hides the marketplace half of the product", () => {
		expect(classifySurface("/marketplace")).toBe("marketplace");
		expect(classifySurface("/marketplace/finance/contracts")).toBe(
			"marketplace",
		);
		expect(classifySurface("/start-selling")).toBe("marketplace");
		expect(classifySurface("/engagements/abc")).toBe("marketplace");
		expect(classifySurface("/brief/new")).toBe("marketplace");
		expect(classifySurface("/freelancer/invites")).toBe("marketplace");
		expect(classifySurface("/contract/sign/tok")).toBe("marketplace");
	});

	it("hides the whole staff console, not page by page", () => {
		// Plans and Workspaces price the product, Applications/Consultants/Match
		// are marketplace, and /admin redirects into one of those — so the
		// console goes as a unit rather than leaving links that bounce.
		for (const path of [
			"/admin",
			"/admin/plans",
			"/admin/workspaces",
			"/admin/applications",
			"/admin/consultants",
			"/admin/match",
			"/admin/approve-admin",
			"/admin/settings",
		]) {
			expect(classifySurface(path), path).toBe("staff");
		}
	});

	it("classifies the public marketing pages", () => {
		// Docs and Contact are help and support, so they ship in the app. The
		// product page is marketing, like the landing it sits beside.
		expect(classifySurface("/docs")).toBe("app");
		expect(classifySurface("/docs/start-here/quickstart")).toBe("app");
		expect(classifySurface("/contact")).toBe("app");
		expect(classifySurface("/product")).toBe("silent");
	});

	it("hides the marketplace docs section by prefix alone", () => {
		// The rule sits above ["/docs", "app"], so these articles inherit the
		// marketplace treatment without the docs code knowing about it.
		expect(classifySurface("/docs/clients-and-marketplace/selling")).toBe(
			"marketplace",
		);
	});

	it("does not confuse /contact with /contract/sign", () => {
		expect(classifySurface("/contact")).toBe("app");
		expect(classifySurface("/contract/sign/tok")).toBe("marketplace");
	});

	it("sends the marketing landing home without an explanation", () => {
		expect(classifySurface("/")).toBe("silent");
		expect(classifySurface("/home")).toBe("silent");
	});

	it("keeps the SaaS surfaces", () => {
		for (const path of [
			"/dashboard",
			"/inbox",
			"/notifications",
			"/command-center",
			"/meetings",
			"/invites",
			"/work-items",
			"/project/p1/roadmap",
			"/project/new",
			"/teams/t1/time/payouts",
			"/settings/appearance",
			"/settings/mcp-tokens",
			"/w/acme/dashboard",
			"/w/acme/settings",
			"/w/acme/settings/members",
			"/w/acme/teams/t1/settings/time",
			"/profile/u1",
			"/roadmap-templates",
			"/roadmap/shared/tok",
			"/get-started",
			"/auth/login",
		]) {
			expect(classifySurface(path), path).toBe("app");
		}
	});

	it("resolves a bare /w/<slug> to its own route rather than flattening it", () => {
		// stripWorkspacePrefix turns this into "/", which must not be read as
		// the marketing landing.
		expect(classifySurface("/w/acme")).toBe("app");
	});

	it("only matches whole segments", () => {
		// The /finance vs /financial lesson that mapLegacyPath already encodes.
		expect(classifySurface("/marketplacey")).toBe(null);
		expect(classifySurface("/briefly")).toBe(null);
		expect(classifySurface("/pricingx")).toBe(null);
		// This one still matches, but on the broader "/settings" rule below it —
		// so it stays visible rather than being mistaken for the billing page.
		expect(classifySurface("/w/acme/settings/billingx")).toBe("app");
	});

	it("ignores a query string or hash", () => {
		// Push payloads carry these, and a missed match would show a
		// marketplace page.
		expect(classifySurface("/marketplace/finance/c1?section=signatures")).toBe(
			"marketplace",
		);
		expect(classifySurface("/pricing#faq")).toBe("commerce");
		expect(classifySurface("/w/acme/settings/usage?tab=x")).toBe("commerce");
	});

	it("hides anything nobody has classified", () => {
		expect(classifySurface("/some-route-from-the-future")).toBe(null);
	});
});

describe("nativeDestinationFor", () => {
	it("explains a commerce or marketplace refusal", () => {
		expect(nativeDestinationFor("/pricing")).toBe(
			"/not-available?surface=commerce",
		);
		expect(nativeDestinationFor("/marketplace")).toBe(
			"/not-available?surface=marketplace",
		);
	});

	it("sends the landing home silently", () => {
		expect(nativeDestinationFor("/home")).toBe("/dashboard");
	});

	it("gives the staff console the generic wording", () => {
		expect(nativeDestinationFor("/admin/plans")).toBe(
			"/not-available?surface=unavailable",
		);
	});

	it("sends an unclassified path somewhere real", () => {
		expect(nativeDestinationFor("/some-route-from-the-future")).toBe(
			"/not-available?surface=unavailable",
		);
	});

	it("returns null for a path the app shows", () => {
		expect(nativeDestinationFor("/dashboard")).toBeNull();
		expect(nativeDestinationFor("/w/acme/settings/members")).toBeNull();
	});

	it("cannot loop", () => {
		for (const path of ["/pricing", "/marketplace", "/home", "/nope"]) {
			const to = nativeDestinationFor(path);
			expect(to, path).not.toBeNull();
			expect(nativeDestinationFor(to as string)).toBeNull();
		}
	});
});

describe("the browser is untouched", () => {
	it("shows every path, including the hidden ones", () => {
		for (const path of ["/pricing", "/marketplace", "/home", "/nope"]) {
			expect(isVisibleInApp(path, false), path).toBe(true);
		}
	});

	it("returns nav entries unchanged", () => {
		const items = [
			{ to: "/dashboard" },
			{ to: "/engagements" },
			{ to: "/marketplace" },
		];
		expect(filterNavByPlatform(items, false)).toEqual(items);
	});
});

describe("filterNavByPlatform", () => {
	it("drops the hidden entries in the app", () => {
		const items = [
			{ to: "/dashboard" },
			{ to: "/engagements" },
			{ to: "/marketplace" },
			{ to: "/w/acme/settings/billing" },
		];
		expect(filterNavByPlatform(items, true)).toEqual([{ to: "/dashboard" }]);
	});
});
