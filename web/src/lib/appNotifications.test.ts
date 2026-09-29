import { describe, expect, it } from "vitest";
import { isNotificationShownInApp } from "./appNotifications";

const row = (typeName: string | null, link: string | null) => ({
	type: typeName ? { name: typeName } : null,
	link_url: link,
});

describe("isNotificationShownInApp", () => {
	it("lists everything in a browser", () => {
		expect(
			isNotificationShownInApp(
				row("marketplace_profile_live", "/freelancer/profile"),
				false,
			),
		).toBe(true);
		expect(
			isNotificationShownInApp(row("anything", "/marketplace/finance"), false),
		).toBe(true);
	});

	it("drops marketplace-only types in the app, even when they link to an app page", () => {
		expect(
			isNotificationShownInApp(
				row("marketplace_profile_live", "/profile/abc"),
				true,
			),
		).toBe(false);
	});

	it("drops rows that link to marketplace or commerce pages in the app", () => {
		expect(
			isNotificationShownInApp(
				row("invoice_issued", "/marketplace/finance/invoices/1"),
				true,
			),
		).toBe(false);
		expect(
			isNotificationShownInApp(row("plan_changed", "/pricing"), true),
		).toBe(false);
	});

	it("keeps delivery notifications in the app", () => {
		expect(
			isNotificationShownInApp(
				row("task_assigned", "/project/p1/roadmap?task=t1"),
				true,
			),
		).toBe(true);
		expect(isNotificationShownInApp(row("chat_mention", "/inbox"), true)).toBe(
			true,
		);
	});

	it("keeps rows with no link or a non-path link", () => {
		expect(isNotificationShownInApp(row("task_assigned", null), true)).toBe(
			true,
		);
		expect(
			isNotificationShownInApp(
				row("task_assigned", "https://example.com/x"),
				true,
			),
		).toBe(true);
	});
});
