import { describe, expect, it } from "vitest";
import { computeMeter } from "./entitlements";
import type { PlanLimitInfo } from "./planLimitErrors";
import { DEFAULT_PLAN_LIMITS } from "./planLimits";
import {
	COMPLIMENTARY_BADGE,
	countNoun,
	featureAvailabilityCopy,
	inviteCapNote,
	meterCaption,
	pendingInvitesNote,
	planLimitTitle,
	planLimitToastCopy,
	planSummaryCopy,
	retentionCopy,
	upgradeCta,
} from "./usageCopy";

function info(overrides: Partial<PlanLimitInfo> = {}): PlanLimitInfo {
	return {
		limitKey: "projects",
		kind: "count",
		label: "Projects",
		limit: 2,
		used: 2,
		plan: "free",
		upgradePlan: "pro",
		workspaceId: "ws-1",
		workspaceSlug: "acme",
		context: "create",
		message: "",
		...overrides,
	};
}

const featureInfo = info({
	limitKey: "change_requests",
	kind: "feature",
	label: "Change requests",
	limit: null,
	used: null,
	context: "write",
});

/** Every string this module can produce, across the branches that matter. */
function everyString(): string[] {
	const out: string[] = [];
	const push = (value: string | null | undefined) => {
		if (value) out.push(value);
	};
	for (const key of [
		"members",
		"projects",
		"teams",
		"roadmap_nodes_per_roadmap",
	]) {
		for (const [used, limit] of [
			[1, 10],
			[8, 10],
			[10, 10],
			[12, 10],
			[3, null],
		] as const) {
			push(meterCaption(key, computeMeter(used, limit), "free"));
		}
		push(countNoun(key, 1));
		push(countNoun(key, 3));
	}
	for (const plan of ["free", "pro", "business", "enterprise"] as const) {
		push(planSummaryCopy({ plan, limits: DEFAULT_PLAN_LIMITS[plan] }));
		push(
			planSummaryCopy({
				plan,
				isComplimentary: true,
				complimentaryUntil: "March 1, 2027",
				limits: DEFAULT_PLAN_LIMITS[plan],
			}),
		);
	}
	for (const role of ["owner", "admin", "member", null] as const) {
		push(upgradeCta({ role, upgradePlanName: "pro" }).label);
		for (const item of [
			info(),
			info({ context: "accept" }),
			info({
				limitKey: "members",
				label: "Members",
				limit: 10,
				context: "invite",
			}),
			info({
				limitKey: "roadmap_nodes_per_roadmap",
				label: "Roadmap nodes per roadmap",
				limit: 250,
				used: 250,
				context: "write",
			}),
			info({ upgradePlan: null }),
			featureInfo,
		]) {
			push(planLimitToastCopy(item, role).message);
			push(planLimitToastCopy(item, role).actionLabel);
			push(planLimitTitle(item));
		}
	}
	push(featureAvailabilityCopy(true, null));
	push(featureAvailabilityCopy(false, "pro"));
	push(featureAvailabilityCopy(false, null));
	push(retentionCopy(7, "free"));
	push(retentionCopy(1, "free"));
	push(retentionCopy(null, "business"));
	push(inviteCapNote(0, "free"));
	push(inviteCapNote(1, "free"));
	push(inviteCapNote(3, "free"));
	push(pendingInvitesNote(1));
	push(pendingInvitesNote(2));
	push(COMPLIMENTARY_BADGE);
	return out;
}

describe("usage copy — a limit never takes anything away", () => {
	it("never talks about deleting, removing or losing anything", () => {
		const strings = everyString();
		expect(strings.length).toBeGreaterThan(50);
		for (const text of strings) {
			expect(text).not.toMatch(/delet|remov|lost|lose|erase|purg/i);
		}
	});

	it("says existing work stays at the limit", () => {
		const caption = meterCaption("projects", computeMeter(2, 2), "free");
		expect(caption).toBe(
			"At Free's limit. New projects are blocked; everything you have stays.",
		);
	});

	it("says existing work stays over the limit, and by how much", () => {
		const caption = meterCaption("projects", computeMeter(4, 2), "free");
		expect(caption).toMatch(/^2 over Free's limit of 2\./);
		expect(caption).toMatch(/Everything you have stays/);
	});

	it("says existing work stays in a blocked-create prompt", () => {
		expect(planLimitToastCopy(info(), "owner").message).toMatch(
			/Everything you have stays/,
		);
	});

	it("talks about invites, not people, when members are capped", () => {
		expect(meterCaption("members", computeMeter(10, 10), "free")).toMatch(
			/New invites are blocked/,
		);
	});
});

describe("usage copy — meters", () => {
	it("counts what is left below the limit", () => {
		expect(meterCaption("projects", computeMeter(1, 10), "pro")).toBe(
			"9 projects left on Pro.",
		);
		expect(meterCaption("teams", computeMeter(8, 9), "pro")).toBe(
			"Only 1 team left on Pro.",
		);
	});

	it("names the unlimited case", () => {
		expect(meterCaption("projects", computeMeter(30, null), "business")).toBe(
			"Unlimited projects on Business.",
		);
	});

	it("uses singular and plural nouns", () => {
		expect(countNoun("projects", 1)).toBe("1 project");
		expect(countNoun("projects", 3)).toBe("3 projects");
		expect(countNoun("roadmap_nodes_per_roadmap", 2000)).toBe("2,000 nodes");
		expect(countNoun("activity_retention_days", 1)).toBe("1 day");
		expect(pendingInvitesNote(1)).toBe("Includes 1 pending invite.");
		expect(pendingInvitesNote(0)).toBeNull();
	});
});

describe("usage copy — plan summary and calls to action", () => {
	it("summarises a plan's counts from the live limits", () => {
		expect(
			planSummaryCopy({ plan: "free", limits: DEFAULT_PLAN_LIMITS.free }),
		).toBe("Free includes 10 members, 2 projects and 2 teams.");
		expect(
			planSummaryCopy({ plan: "pro", limits: DEFAULT_PLAN_LIMITS.pro }),
		).toBe("Pro includes unlimited members, 10 projects and 3 teams.");
		expect(
			planSummaryCopy({
				plan: "business",
				limits: DEFAULT_PLAN_LIMITS.business,
			}),
		).toBe("Business includes unlimited members, projects and teams.");
	});

	it("keeps complimentary copy free of money", () => {
		const text = planSummaryCopy({
			plan: "business",
			isComplimentary: true,
			complimentaryUntil: "March 1, 2027",
		});
		expect(text).toBe(
			"Proyekto covers this workspace's Business plan until March 1, 2027.",
		);
		expect(`${text} ${COMPLIMENTARY_BADGE}`).not.toMatch(/charge|\$/i);
	});

	it("sends owners to upgrade and everyone else to an owner", () => {
		expect(upgradeCta({ role: "owner", upgradePlanName: "pro" })).toEqual({
			kind: "upgrade",
			label: "Upgrade to Pro",
		});
		for (const role of ["admin", "member", null] as const) {
			expect(upgradeCta({ role, upgradePlanName: "pro" })).toEqual({
				kind: "ask_owner",
				label: "Ask a workspace owner to upgrade.",
			});
		}
	});

	it("offers nothing on a complimentary or top plan", () => {
		expect(
			upgradeCta({
				role: "owner",
				isComplimentary: true,
				upgradePlanName: "pro",
			}).kind,
		).toBe("none");
		expect(upgradeCta({ role: "owner", upgradePlanName: null }).kind).toBe(
			"none",
		);
	});

	it("describes feature availability", () => {
		expect(featureAvailabilityCopy(true, null)).toBe("Included");
		expect(featureAvailabilityCopy(false, "pro")).toBe("Available on Pro");
		expect(featureAvailabilityCopy(false, null)).toBe("Contact sales");
	});

	it("explains retention as hidden, not gone", () => {
		expect(retentionCopy(7, "free")).toBe(
			"Free shows the last 7 days of activity. Older activity is kept and comes back on a plan with longer history.",
		);
		expect(retentionCopy(null, "business")).toBe(
			"Business shows your full activity history.",
		);
	});
});

describe("usage copy — blocked writes", () => {
	it("gives owners an upgrade action", () => {
		expect(planLimitToastCopy(info(), "owner")).toEqual({
			message:
				"This workspace has reached the 2-project limit of its Free plan. Everything you have stays. Upgrade to Pro to add more.",
			action: "upgrade",
			actionLabel: "Upgrade",
		});
	});

	it("points members at the usage page and non-members nowhere", () => {
		expect(planLimitToastCopy(info(), "member")).toMatchObject({
			action: "view_usage",
			actionLabel: "View usage",
		});
		expect(planLimitToastCopy(info(), "member").message).toMatch(
			/Ask a workspace owner to upgrade\.$/,
		);
		expect(planLimitToastCopy(info(), null)).toMatchObject({
			action: null,
			actionLabel: null,
		});
	});

	it("tells an invitee to accept again after an upgrade", () => {
		const copy = planLimitToastCopy(
			info({
				limitKey: "members",
				label: "Members",
				limit: 10,
				context: "accept",
			}),
			null,
		);
		expect(copy.message).toBe(
			"This workspace has reached the 10-member limit of its Free plan. Everything you have stays. Ask a workspace owner to upgrade, then accept this invite again.",
		);
	});

	it("words a roadmap node block around the roadmap", () => {
		const item = info({
			limitKey: "roadmap_nodes_per_roadmap",
			label: "Roadmap nodes per roadmap",
			limit: 250,
		});
		expect(planLimitToastCopy(item, "owner").message).toMatch(
			/^This roadmap has reached the 250-node limit of its Free plan\./,
		);
		expect(planLimitTitle(item)).toBe("Roadmap node limit reached");
	});

	it("words a feature gate", () => {
		expect(planLimitToastCopy(featureInfo, "owner").message).toBe(
			"The Free plan doesn't include change requests. It's available on Pro and above. Upgrade to Pro to turn it on.",
		);
		expect(planLimitTitle(featureInfo)).toBe("Available on Pro");
		expect(planLimitTitle(info())).toBe("Project limit reached");
	});

	it("keeps acronyms capitalised mid-sentence", () => {
		const copy = planLimitToastCopy(
			info({ limitKey: "mcp_server", kind: "feature", label: "MCP server" }),
			"member",
		);
		expect(copy.message).toMatch(/doesn't include MCP server\./);
	});

	it("notes how many invites still fit", () => {
		expect(inviteCapNote(null, "pro")).toBeNull();
		expect(inviteCapNote(1, "free")).toBe(
			"Free has room for 1 more member. Pending invites count toward the limit.",
		);
		expect(inviteCapNote(0, "free")).toMatch(/no member spots left/);
	});
});
