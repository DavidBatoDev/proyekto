import { describe, expect, it } from "vitest";
import { DOC_ARTICLES } from "@/content/docs.manifest";
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

	it("keeps every web-only docs article out of the app", () => {
		// `surface: "web"` hides an article from the sidebar, home and search;
		// the gate must agree, or a body link, a Related card or a deep link
		// still opens it in the app.
		const webOnly = DOC_ARTICLES.filter((a) => a.surface === "web");
		expect(webOnly.length).toBeGreaterThan(0);
		for (const article of webOnly) {
			const path = `/docs/${article.section}/${article.slug}`;
			expect(isVisibleInApp(path, true), path).toBe(false);
		}
		expect(classifySurface("/docs/teams-time-and-rates/payouts")).toBe(
			"silent",
		);
		expect(
			classifySurface("/docs/teams-time-and-rates/rates-and-currency"),
		).toBe("silent");
		// Its siblings stay.
		expect(classifySurface("/docs/teams-time-and-rates/timesheets")).toBe(
			"app",
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
			"/teams/t1/time",
			"/teams/t1/time/my-logs",
			"/time",
			"/time/timesheets/s1",
			"/time?for=team:t1&entry=e1",
			"/time#waiting",
			"/w/acme/settings/time",
			"/w/acme/settings/time?tab=report",
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

	it("hides a team's money pages silently, under either URL shape", () => {
		// Rates and Payouts are money surfaces (L54). The team report under
		// …/time stays; only these two sub-pages go.
		for (const path of [
			"/teams/t1/time/payouts",
			"/teams/t1/time/manage-rates",
			"/teams/t1/time/manage-rates/u1",
			"/w/acme/teams/t1/time/payouts",
			"/w/acme/teams/t1/time/manage-rates/u1?x=1",
			// Route templates, as the generated route table and nav items spell them.
			"/teams/$teamId/time/payouts",
			"/w/$workspaceSlug/teams/$teamId/time/manage-rates/$userId",
		]) {
			expect(classifySurface(path), path).toBe("silent");
		}
	});

	it("lets a * stand for exactly one segment", () => {
		// No team segment: the wildcard needs one, so the broader /teams rule wins.
		expect(classifySurface("/teams/time/payouts")).toBe("app");
		// Two segments where the wildcard allows one.
		expect(classifySurface("/teams/a/b/time/payouts")).toBe("app");
		// An empty segment is not a team id.
		expect(classifySurface("/teams//time/payouts")).toBe("app");
		// Whole segments after the wildcard, too.
		expect(classifySurface("/teams/t1/time/payoutsx")).toBe("app");
	});

	it("does not confuse /time with /timeline or /timesheets", () => {
		expect(classifySurface("/timeline")).toBe(null);
		expect(classifySurface("/timesheets")).toBe(null);
		expect(classifySurface("/project/p1/timeline")).toBe("app");
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

	it("sends a team money page home silently", () => {
		// Old push payloads and notification links still carry these paths.
		expect(nativeDestinationFor("/w/acme/teams/t1/time/payouts")).toBe(
			"/dashboard",
		);
		expect(nativeDestinationFor("/teams/t1/time/manage-rates/u1")).toBe(
			"/dashboard",
		);
		expect(nativeDestinationFor("/time/timesheets/s1")).toBeNull();
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

	it("leaves a team's time sub-nav with the Report only", () => {
		// ux.md › Mobile: the team sub-nav shows Report on native; Rates and
		// Payouts drop out, whether written as paths or as route templates.
		const items = [
			{ to: "/w/$workspaceSlug/teams/$teamId/time" },
			{ to: "/w/$workspaceSlug/teams/$teamId/time/manage-rates" },
			{ to: "/w/acme/teams/t1/time/payouts" },
		];
		expect(filterNavByPlatform(items, true)).toEqual([
			{ to: "/w/$workspaceSlug/teams/$teamId/time" },
		]);
		expect(filterNavByPlatform(items, false)).toEqual(items);
	});
});
