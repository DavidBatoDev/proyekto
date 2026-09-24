import { describe, expect, it } from "vitest";
import {
	ENGAGEMENTS_NAV_ITEMS,
	FINANCE_NAV_ITEMS,
	resolveEngagementsLocation,
} from "./engagementsNavigation";

const TEAM = "801465b6-be13-4dd4-949f-c6b88204645f";
const BOOK = "eff1d0d4-f854-49eb-8936-36bcb21c0b82";
const CONTRACT = "7f3c1e2a-0000-4000-8000-000000000000";

describe("engagements navigation", () => {
	it("names one tree: Overview and Contracts, then the finance places", () => {
		expect(ENGAGEMENTS_NAV_ITEMS.map((item) => item.to)).toEqual([
			"/engagements",
			"/engagements/contracts",
		]);
		expect(FINANCE_NAV_ITEMS.map((item) => item.to)).toEqual([
			"/engagements/finance",
			"/engagements/finance/teams",
		]);
	});

	it("puts every engagements page on exactly one node", () => {
		const nav = (path: string) => resolveEngagementsLocation(path).nav;
		expect(nav("/engagements")).toBe("engagements");
		expect(nav("/engagements/abc-engagement")).toBe("engagements");
		expect(nav("/engagements/contracts")).toBe("contracts");
		expect(nav(`/engagements/contracts/${CONTRACT}`)).toBe("contracts");
		// The legacy editor URL still reads as Contracts while it redirects.
		expect(nav(`/engagements/finance/${CONTRACT}`)).toBe("contracts");
		expect(nav("/engagements/finance")).toBe("my-finance");
		expect(nav("/engagements/finance/")).toBe("my-finance");
		expect(nav("/engagements/finance/teams")).toBe("my-teams");
		expect(nav("/engagements/finance/shared")).toBe("shared");
		expect(nav("/dashboard")).toBeNull();
	});

	it("places team and project pages under their team", () => {
		expect(
			resolveEngagementsLocation(`/engagements/finance/team/${TEAM}`),
		).toEqual({
			nav: "my-teams",
			teamId: TEAM,
			bookId: undefined,
			teamTab: "overview",
		});
		expect(
			resolveEngagementsLocation(`/engagements/finance/team/${TEAM}/payouts`),
		).toMatchObject({ teamId: TEAM, teamTab: "payouts" });
		expect(
			resolveEngagementsLocation(
				`/engagements/finance/team/${TEAM}/project/${BOOK}`,
			),
		).toMatchObject({ nav: "my-teams", teamId: TEAM, bookId: BOOK });
	});
});
