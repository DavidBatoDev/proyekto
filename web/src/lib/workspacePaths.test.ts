import { describe, expect, it } from "vitest";
import {
	stripWorkspacePrefix,
	toWorkspacePath,
	workspaceSlugFromPath,
} from "./workspacePaths";

describe("workspaceSlugFromPath", () => {
	it("reads the slug from a scoped path", () => {
		expect(workspaceSlugFromPath("/w/acme/teams/t1?x=1")).toBe("acme");
		expect(workspaceSlugFromPath("/w/acme")).toBe("acme");
	});

	it("is null for anything else", () => {
		expect(workspaceSlugFromPath("/dashboard")).toBeNull();
		expect(workspaceSlugFromPath("/welcome")).toBeNull();
		expect(workspaceSlugFromPath("/w")).toBeNull();
	});
});

describe("stripWorkspacePrefix", () => {
	it("removes the prefix and keeps the rest", () => {
		expect(stripWorkspacePrefix("/w/acme/teams/t1")).toBe("/teams/t1");
		expect(stripWorkspacePrefix("/w/acme/dashboard?tab=1")).toBe(
			"/dashboard?tab=1",
		);
		expect(stripWorkspacePrefix("/w/acme")).toBe("/");
		expect(stripWorkspacePrefix("/w/acme?x")).toBe("/?x");
	});

	/** `/welcome` and `/work-items` start with "/w" but are not scoped. */
	it("leaves non-scoped paths alone", () => {
		expect(stripWorkspacePrefix("/welcome")).toBe("/welcome");
		expect(stripWorkspacePrefix("/work-items")).toBe("/work-items");
		expect(stripWorkspacePrefix("/project/p1")).toBe("/project/p1");
	});
});

describe("toWorkspacePath", () => {
	it("rewrites the three organizational roots", () => {
		expect(toWorkspacePath("/dashboard", "acme")).toBe("/w/acme/dashboard");
		expect(toWorkspacePath("/teams", "acme")).toBe("/w/acme/teams");
		expect(toWorkspacePath("/teams/t1/time/my-logs?member=u", "acme")).toBe(
			"/w/acme/teams/t1/time/my-logs?member=u",
		);
		expect(toWorkspacePath("/workspace", "acme")).toBe("/w/acme/settings");
		expect(toWorkspacePath("/workspace/settings/members", "acme")).toBe(
			"/w/acme/settings/members",
		);
	});

	/**
	 * Invites arrive from workspaces you are not yet in, so the inbox is
	 * personal and must never gain a tenant segment.
	 */
	it("leaves /teams/me alone", () => {
		expect(toWorkspacePath("/teams/me/invites?inviteId=i", "acme")).toBe(
			"/teams/me/invites?inviteId=i",
		);
	});

	it("leaves entity, personal, and already-scoped paths alone", () => {
		expect(toWorkspacePath("/project/p1/overview", "acme")).toBe(
			"/project/p1/overview",
		);
		expect(toWorkspacePath("/inbox", "acme")).toBe("/inbox");
		expect(toWorkspacePath("/w/other/dashboard", "acme")).toBe(
			"/w/other/dashboard",
		);
	});

	/**
	 * The Time page is personal — its sheets span workspaces — so it keeps the
	 * bare path (ux.md › Routes and Redirects). Only workspace settings and the
	 * team report carry a slug, and they are built slugged already.
	 */
	it("leaves /time and the timesheet review screen bare", () => {
		expect(toWorkspacePath("/time", "acme")).toBe("/time");
		expect(toWorkspacePath("/time?for=team:t1&entry=e1", "acme")).toBe(
			"/time?for=team:t1&entry=e1",
		);
		expect(toWorkspacePath("/time#waiting", "acme")).toBe("/time#waiting");
		expect(toWorkspacePath("/time/timesheets/s1", "acme")).toBe(
			"/time/timesheets/s1",
		);
		// The team report is still a /teams path, so it does move.
		expect(toWorkspacePath("/teams/t1/time?person=u1", "acme")).toBe(
			"/w/acme/teams/t1/time?person=u1",
		);
		expect(stripWorkspacePrefix("/w/acme/settings/time?tab=report")).toBe(
			"/settings/time?tab=report",
		);
	});

	it("returns the bare path when no slug is known", () => {
		expect(toWorkspacePath("/dashboard", null)).toBe("/dashboard");
	});
});
