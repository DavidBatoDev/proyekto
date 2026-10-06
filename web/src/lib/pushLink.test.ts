import { describe, expect, it } from "vitest";
import { resolvePushLink } from "./pushLink";

describe("resolvePushLink", () => {
	it("passes in-app paths through, query and hash intact", () => {
		expect(resolvePushLink("/w/acme/teams/t1/time/my-logs?member=u")).toBe(
			"/w/acme/teams/t1/time/my-logs?member=u",
		);
		expect(resolvePushLink("/inbox?r=room-1")).toBe("/inbox?r=room-1");
	});

	/**
	 * Old pushes keep arriving with bare organizational paths. They stay as
	 * they are: the bare routes exist and redirect to the workspace-scoped page.
	 */
	it("leaves bare organizational paths for the redirect stubs", () => {
		expect(resolvePushLink("/teams/t1/time/team-logs")).toBe(
			"/teams/t1/time/team-logs",
		);
		expect(resolvePushLink("/dashboard")).toBe("/dashboard");
	});

	/**
	 * Time notifications link to the personal Time pages (D79): the review
	 * screen, an entry on /time, Waiting for you, and bare /time for a
	 * recorded payment. They are app routes, so they pass through untouched.
	 */
	it("passes the Time pages through unchanged", () => {
		expect(resolvePushLink("/time/timesheets/x")).toBe("/time/timesheets/x");
		expect(resolvePushLink("/time?entry=x")).toBe("/time?entry=x");
		expect(resolvePushLink("/time#waiting")).toBe("/time#waiting");
		expect(resolvePushLink("/time")).toBe("/time");
		expect(
			resolvePushLink(
				"https://www.proyekto.tech/time/timesheets/0b6a3f1e-2c4d-4e8f-9a1b-3c5d7e9f1a2b",
			),
		).toBe("/time/timesheets/0b6a3f1e-2c4d-4e8f-9a1b-3c5d7e9f1a2b");
	});

	it("applies the same legacy map the notification bell uses", () => {
		expect(resolvePushLink("/finance/c1?section=signatures")).toBe(
			"/marketplace/finance/c1?section=signatures",
		);
	});

	it("reduces an absolute URL to its path", () => {
		expect(resolvePushLink("https://www.proyekto.tech/inbox?r=x")).toBe(
			"/inbox?r=x",
		);
	});

	it("falls back to the notifications list for anything unusable", () => {
		expect(resolvePushLink(undefined)).toBe("/notifications");
		expect(resolvePushLink("")).toBe("/notifications");
		expect(resolvePushLink("javascript:alert(1)")).toBe("/notifications");
		expect(resolvePushLink("//evil.example/x")).toBe("/notifications");
		expect(resolvePushLink("notifications")).toBe("/notifications");
	});
});
