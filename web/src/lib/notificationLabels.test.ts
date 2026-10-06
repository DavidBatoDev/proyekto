import { Info } from "lucide-react";
import { describe, expect, it } from "vitest";
import {
	hasNotificationLabel,
	notificationBody,
	notificationLabel,
	notificationLabelFor,
	notificationToneClass,
} from "./notificationLabels";

/** ux.md › Notifications: bell / list labels for the time types. */
const TIME_LABELS: Record<string, string> = {
	timesheet_submitted: "Timesheet to review",
	timesheet_returned: "Timesheet returned",
	timesheet_approved: "Timesheet approved",
	timesheet_reopened: "Timesheet reopened",
	timesheet_reopen_requested: "Reopen requested",
	timesheet_reminder: "Time to submit",
	timer_running_long: "Timer still running",
	timer_auto_stopped: "Timer stopped",
	time_payout_recorded: "Payment recorded",
	timesheets_imported: "Timesheets moved",
	time_log_comment_added: "New comment on your time",
};

const OLDER_TYPES = [
	"time_log_approval_requested",
	"time_log_approved",
	"time_log_rejected",
	"time_log_pending",
	"time_log_day_rejected",
];

describe("notificationLabel", () => {
	it("labels every time type the way ux.md writes it", () => {
		for (const [type, label] of Object.entries(TIME_LABELS)) {
			expect(notificationLabel(type), type).toBe(label);
			expect(notificationLabelFor(type).older, type).toBe(false);
		}
	});

	it("keeps today's labels for the retired review types, marked (older)", () => {
		expect(notificationLabel("time_log_approval_requested")).toBe(
			"(older) Time approval requested",
		);
		expect(notificationLabel("time_log_approved")).toBe(
			"(older) Time log approved",
		);
		expect(notificationLabel("time_log_rejected")).toBe(
			"(older) Time log rejected",
		);
		expect(notificationLabel("time_log_pending")).toBe(
			"(older) Time log reset to pending",
		);
		expect(notificationLabel("time_log_day_rejected")).toBe(
			"(older) Daily logs rejected",
		);
		for (const type of OLDER_TYPES) {
			const entry = notificationLabelFor(type);
			expect(entry.older, type).toBe(true);
			expect(entry.tone, type).toBe("muted");
		}
	});

	it("knows the types each surface used to know on its own", () => {
		// The bell had the team-invite types; the page did not, and showed a
		// bare "Notification" for them.
		expect(notificationLabel("project_team_invite_received")).toBe(
			"Your team is invited",
		);
		expect(notificationLabel("project_team_invite_responded")).toBe(
			"Invite response",
		);
		expect(notificationLabel("chat_mention")).toBe("Mention");
		expect(notificationLabel("task_assigned")).toBe("Task assigned");
		expect(notificationLabel("epic_comment_mention")).toBe("Mentioned in epic");
	});

	it("falls back for an unknown or missing type", () => {
		expect(notificationLabel("rocket_launched")).toBe("Notification");
		expect(notificationLabel(undefined)).toBe("Notification");
		expect(notificationLabel(null)).toBe("Notification");
		expect(notificationLabelFor("rocket_launched")).toMatchObject({
			icon: Info,
			tone: "muted",
			older: false,
		});
		expect(hasNotificationLabel("rocket_launched")).toBe(false);
		expect(hasNotificationLabel("timesheet_submitted")).toBe(true);
		// Not fooled by Object.prototype keys.
		expect(notificationLabel("toString")).toBe("Notification");
	});

	it("gives every type an icon and a tone token", () => {
		for (const type of [...Object.keys(TIME_LABELS), ...OLDER_TYPES]) {
			const entry = notificationLabelFor(type);
			expect(entry.icon, type).toBeTruthy();
			expect(notificationToneClass(entry.tone), type).toMatch(
				/^text-(primary|info|success|warning|destructive|muted-foreground)$/,
			);
		}
	});

	it("never uses the words the installed app strips", () => {
		// One label serves web and native, so none may say contract, rate,
		// payout or invoice (ux.md › Mobile).
		for (const type of [...Object.keys(TIME_LABELS), ...OLDER_TYPES]) {
			expect(notificationLabel(type), type).not.toMatch(
				/contract|rate|payout|invoice/i,
			);
		}
	});
});

describe("notificationBody", () => {
	it("prefers the server's message", () => {
		expect(
			notificationBody({
				message: "Maria sent 38h 15m for Acme · Sep 22–28",
				status: "approved",
			}),
		).toBe("Maria sent 38h 15m for Acme · Sep 22–28");
	});

	it("reads the fields older rows carried", () => {
		expect(notificationBody({ reason: "Split Thursday" })).toBe(
			"Reason: Split Thursday",
		);
		expect(notificationBody({ day: "2026-09-29" })).toBe("Day: 2026-09-29");
		expect(notificationBody({ status: "approved" })).toBe(
			"Your logged time was approved.",
		);
		expect(notificationBody({ status: "accepted" })).toBe(
			"Invite was accepted.",
		);
	});

	it("falls back when there is nothing to show", () => {
		expect(notificationBody(null)).toBe("You have a new update.");
		expect(notificationBody({ message: "   " })).toBe("You have a new update.");
	});
});
