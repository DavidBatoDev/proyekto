import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import { TimeApiError } from "@/services/time.service";
import type { ResolvedTimePolicy } from "@/services/time.types";
import {
	entryWorkLabel,
	GENERIC_ERROR,
	goesToText,
	hourCapText,
	limitsLine,
	manualLine,
	periodLine,
	periodLockedText,
	personalReasonText,
	primaryActionLabel,
	sameApproverNote,
	sentenceDuration,
	switchPromptText,
	timerErrorText,
	timerResumedToast,
	unavailableReasonText,
	weekdayName,
	whoApprovesView,
	whyNoOptionsText,
} from "./forCopy";
import type { ForChipOption } from "./forOptions";

function policy(over: Partial<ResolvedTimePolicy> = {}): ResolvedTimePolicy {
	return {
		tracking_enabled: true,
		period_kind: "weekly",
		week_start: 1,
		timezone: "Asia/Manila",
		period_anchor: null,
		approval_required: true,
		approver_scope: "workspace",
		allow_manual_entries: true,
		retroactive_days: 7,
		rounding_minutes: 0,
		weekly_limit_minutes: null,
		reminder_days: 1,
		hidden_presets: [],
		tracking_mode: null,
		sources: {},
		plan: { time_tracking: true, time_team_rules: true },
		policy_workspace_id: "ws",
		team_override_applied: false,
		member: null,
		client_hours_detail_level: null,
		...over,
	};
}

const team: ForChipOption = {
	kind: "team",
	id: "t1",
	label: "Prodigitality Services Inc. Team",
	approver_hint: "team",
};
const agreement: ForChipOption = {
	kind: "assignment",
	id: "a1",
	label: "Acme Corp",
	approver_hint: "hirer",
	engagement_id: "eng-1",
};
const workspace: ForChipOption = {
	kind: "workspace",
	id: "w1",
	label: "Acme",
	approver_hint: "workspace",
};

describe("unavailable reasons (ux.md › For Chip)", () => {
	it("words every reason", () => {
		expect(
			unavailableReasonText(
				{ kind: "team", label: "Design", reason: "team_time_off" },
				{ ownerName: "Prodigitality" },
			),
		).toBe("Prodigitality has time tracking off for this team.");
		expect(
			unavailableReasonText({
				kind: "team",
				label: "Design",
				reason: "team_time_off",
			}),
		).toBe("Time tracking is off for this team.");
		expect(
			unavailableReasonText({
				kind: "workspace",
				label: "Prodigitality",
				reason: "plan",
			}),
		).toBe("Prodigitality's plan doesn't include timesheets.");
		// A team has no plan of its own: never "<Team name>'s plan".
		expect(
			unavailableReasonText({
				kind: "team",
				label: "Design",
				reason: "plan",
			}),
		).toBe("This team's workspace plan doesn't include timesheets.");
		expect(
			unavailableReasonText(
				{ kind: "team", label: "Design", reason: "plan" },
				{ ownerName: "Prodigitality" },
			),
		).toBe("Prodigitality's plan doesn't include timesheets.");
		expect(
			unavailableReasonText({
				kind: "assignment",
				label: "Acme",
				reason: "contract_disabled",
			}),
		).toBe("Time tracking is off in your agreement with Acme.");
		expect(
			unavailableReasonText({
				kind: "assignment",
				label: "Acme",
				reason: "engagement_inactive",
			}),
		).toBe("Your agreement with Acme has ended.");
		expect(
			unavailableReasonText({
				kind: "assignment",
				label: "Acme",
				reason: "no_settings",
			}),
		).toBe("Your agreement with Acme has no time terms for this date.");
	});
});

describe("Why? and Just me", () => {
	it("explains 0 options", () => {
		expect(whyNoOptionsText("viewer")).toBe(
			"You're a viewer on this project. Ask a project admin for editor access to log time.",
		);
		expect(whyNoOptionsText("agreement_required")).toBe(
			"Time on this project is logged under an agreement, and you aren't on one.",
		);
		expect(whyNoOptionsText("commenter")).toMatch(/^You're a commenter/);
	});

	it("explains Just me", () => {
		expect(personalReasonText("plan")).toBe(
			"Your workspace's plan doesn't include timesheets; this time is just for you.",
		);
		expect(personalReasonText(null)).toBe("This time is just for you.");
	});
});

describe("chip copy", () => {
	it("names the option on the primary button", () => {
		expect(primaryActionLabel("start", "Acme Corp")).toBe(
			"Start for Acme Corp",
		);
		expect(primaryActionLabel("add", "Acme Corp")).toBe("Add for Acme Corp");
		expect(primaryActionLabel("add", " ")).toBe("Add for Just me");
	});

	it("drops 'rate' from the same-approver note on native", () => {
		expect(sameApproverNote(false)).toBe("Same approver and rate either way");
		expect(sameApproverNote(true)).toBe("Same approver either way");
	});
});

describe("goes to", () => {
	it("follows the approver hint", () => {
		expect(goesToText(team)).toBe(
			"Goes to: Prodigitality Services Inc. Team's owners and admins",
		);
		expect(goesToText(workspace)).toBe(
			"Goes to: Acme's workspace owners and admins",
		);
		expect(goesToText(agreement)).toBe("Goes to: Acme Corp");
		expect(goesToText({ ...agreement, approver_hint: "auto" })).toBe(
			"Submitting confirms these hours for your agreement with Acme Corp.",
		);
		expect(goesToText({ ...team, approver_hint: "auto" })).toBe(
			"Approval is off here, so this approves itself.",
		);
	});

	it("names the workspace from the tag or the caller, else stays generic", () => {
		const plainTeam = { ...team, approver_hint: "workspace" as const };
		expect(goesToText(plainTeam)).toBe(
			"Goes to: the workspace owners and admins",
		);
		expect(goesToText({ ...plainTeam, workspace_tag: "Prodigitality" })).toBe(
			"Goes to: Prodigitality's workspace owners and admins",
		);
		expect(goesToText(plainTeam, null, { projectWorkspaceName: "Acme" })).toBe(
			"Goes to: Acme's workspace owners and admins",
		);
	});

	it("derives the route from the policy when no hint is sent", () => {
		const bare = { kind: "team" as const, id: "t1", label: "Design" };
		expect(
			goesToText(
				bare,
				policy({ approver_scope: "team", team_override_applied: true }),
			),
		).toBe("Goes to: Design's owners and admins");
		expect(goesToText(bare, policy({ approval_required: false }))).toMatch(
			/approves itself/,
		);
		expect(goesToText({ kind: "personal", id: null, label: "Just me" })).toBe(
			"This time is just for you.",
		);
	});
});

describe("policy lines", () => {
	it("words the period, manual time, rounding and limits", () => {
		expect(periodLine(policy())).toBe("weekly · starts Monday · Asia/Manila");
		expect(periodLine(policy({ period_kind: "monthly" }))).toBe(
			"monthly · Asia/Manila",
		);
		expect(weekdayName(7)).toBe("Sunday");
		expect(weekdayName(99)).toBe("Monday");
		expect(manualLine(policy())).toBe(
			"Manual time up to 7 days back · No rounding",
		);
		expect(
			manualLine(policy({ allow_manual_entries: false, rounding_minutes: 15 })),
		).toBe("Manual time is off · Rounding: 15 min");
		expect(manualLine(policy({ retroactive_days: 0 }))).toBe(
			"Manual time allowed (no limit) · No rounding",
		);
		expect(manualLine(policy({ retroactive_days: 1 }))).toMatch(/1 day back/);
		expect(limitsLine(policy())).toBeNull();
		expect(
			limitsLine(
				policy({
					weekly_limit_minutes: 2400,
					member: {
						weekly_limit_hours: 38,
						monthly_limit_hours: null,
						overtime_requires_approval: true,
					},
				}),
			),
		).toBe("Weekly limit 40h · Your limit 38h a week");
	});
});

describe("whoApprovesView", () => {
	it("builds the team override example from ux.md, each line with its source", () => {
		const view = whoApprovesView(
			team,
			policy({
				approver_scope: "team",
				team_override_applied: true,
				sources: {
					approver_scope: "team",
					period_kind: "workspace",
					allow_manual_entries: "team",
				},
			}),
			{ native: false },
		);
		expect(view.title).toBe("Who approves this time");
		expect(view.lines.map((l) => l.text)).toEqual([
			"Goes to: Prodigitality Services Inc. Team's owners and admins",
			"Timesheet: weekly · starts Monday · Asia/Manila",
			"Rules: set by Prodigitality Services Inc. Team (team override)",
			"Manual time up to 7 days back · No rounding",
		]);
		expect(view.lines.map((l) => l.source)).toEqual([
			"team",
			"workspace",
			"team",
			"team",
		]);
		expect(view.lines[0].sourceLabel).toBe("Team override");
		expect(view.lines[1].sourceLabel).toBe("Workspace");
		expect(view.viewTermsEngagementId).toBeNull();
	});

	it("reads 'Set by your agreement' and links the terms on the web only", () => {
		const terms = policy({
			sources: { period_kind: "contract", rounding_minutes: "contract" },
		});
		const web = whoApprovesView(agreement, terms, { native: false });
		expect(web.lines.find((l) => l.key === "rules")?.text).toBe(
			"Set by your agreement with Acme Corp",
		);
		expect(web.lines[0].sourceLabel).toBe("Agreement");
		expect(web.viewTermsEngagementId).toBe("eng-1");
		const native = whoApprovesView(agreement, terms, { native: true });
		expect(native.viewTermsEngagementId).toBeNull();
		for (const line of native.lines) {
			// Word boundaries, so "separate" or "accurate" can't trip it.
			expect(line.text).not.toMatch(
				/\b(contracts?|rates?|payouts?|invoices?)\b/i,
			);
		}
	});

	it("falls back to A8 policy.engagement_id and to the defaults line", () => {
		const view = whoApprovesView(
			{ ...agreement, engagement_id: undefined },
			policy({ engagement_id: "eng-2" }),
			{ native: false },
		);
		expect(view.viewTermsEngagementId).toBe("eng-2");
		expect(view.lines.find((l) => l.key === "rules")?.text).toBe(
			"Rules: Proyekto defaults",
		);
	});

	it("shows only who it goes to without a policy, and one line for Just me", () => {
		expect(whoApprovesView(team, null, { native: false }).lines).toHaveLength(
			1,
		);
		const me = whoApprovesView(
			{ kind: "personal", id: null, label: "Just me" },
			policy(),
			{ native: false, personalReason: "plan" },
		);
		expect(me.lines).toEqual([
			{
				key: "goes_to",
				text: "Your workspace's plan doesn't include timesheets; this time is just for you.",
				source: null,
				sourceLabel: null,
			},
		]);
	});

	it("adds the limits line with the member source", () => {
		const view = whoApprovesView(
			team,
			policy({
				member: {
					weekly_limit_hours: 40,
					monthly_limit_hours: null,
					overtime_requires_approval: false,
				},
			}),
			{ native: false },
		);
		const limits = view.lines.find((l) => l.key === "limits");
		expect(limits?.text).toBe("Your limit 40h a week");
		expect(limits?.source).toBe("member");
		expect(limits?.sourceLabel).toBe("Your limits");
	});
});

describe("timer copy", () => {
	it("asks before switching", () => {
		expect(switchPromptText("Fix login bug", "1:12")).toBe(
			"Stop Fix login bug (1:12) and start this?",
		);
		expect(switchPromptText("", "0:05")).toBe(
			"Stop your timer (0:05) and start this?",
		);
	});

	it("names the work: task, else preset", () => {
		expect(
			entryWorkLabel({
				task: {
					id: "t",
					title: "Fix login bug",
					work_type: null,
					status: null,
				},
				work_item: "task",
				content_label: null,
			}),
		).toBe("Fix login bug");
		expect(
			entryWorkLabel({ task: null, work_item: "meeting", content_label: null }),
		).toBe("Meeting");
		expect(entryWorkLabel(null)).toBe("");
	});

	it("words the locked period", () => {
		expect(
			periodLockedText({ label: "Prodigitality", periodKind: "weekly" }),
		).toBe(
			"This week's Prodigitality timesheet is submitted. Withdraw it to add time.",
		);
		expect(periodLockedText({ periodKind: "monthly" })).toBe(
			"This period's timesheet is submitted. Withdraw it to add time.",
		);
		// One sentence with Add time (lib/timeErrors): a weekly or unknown kind
		// says "This week's", and only approved reads as approved.
		expect(periodLockedText({ sheetStatus: "approved" })).toBe(
			"This week's timesheet is approved, so its time can't change.",
		);
		expect(
			periodLockedText({ periodKind: "biweekly", sheetStatus: "approved" }),
		).toBe("This period's timesheet is approved, so its time can't change.");
		expect(periodLockedText({ label: "Acme", sheetStatus: "submitted" })).toBe(
			"This week's Acme timesheet is submitted. Withdraw it to add time.",
		);
		expect(periodLockedText({ label: "Acme", sheetStatus: "returned" })).toBe(
			"This week's Acme timesheet is submitted. Withdraw it to add time.",
		);
	});

	it("words caps and resume toasts", () => {
		expect(
			hourCapText({ limit_hours: 40, limit_window: "weekly" }, "Prodigitality"),
		).toBe("This goes past the 40h weekly limit for Prodigitality.");
		expect(hourCapText({}, null)).toBe(
			"This goes past the weekly limit for this team.",
		);
		expect(timerResumedToast(300)).toBe("Back to work — 5m of break logged.");
		expect(timerResumedToast(0)).toBe("Back to work.");
		expect(sentenceDuration(45 * 60)).toBe("45m");
		// The lib format on the nearest minute (toasts round, tables floor).
		expect(sentenceDuration(38 * 3600 + 15 * 60)).toBe("38h 15m");
		expect(sentenceDuration(40 * 3600)).toBe("40h");
		expect(sentenceDuration(59)).toBe("1m");
		expect(sentenceDuration(29)).toBe("0m");
		expect(sentenceDuration(Number.NaN)).toBe("0m");
	});
});

describe("native safety", () => {
	it("maps timer errors to their copy", () => {
		const invalid = new TimeApiError({
			status: 422,
			code: "LOGGING_FOR_INVALID",
			message: "x",
		});
		expect(timerErrorText(invalid, false)).toBe(
			"That choice isn't available any more. Pick again.",
		);
		const none = new TimeApiError({
			status: 403,
			code: "NO_LOGGING_CONTEXT",
			message: "x",
		});
		expect(timerErrorText(none, false)).toBe(
			"You can't log time on this project.",
		);
		const server = new TimeApiError({
			status: 500,
			code: "TIME_INTERNAL",
			message: "Proyekto couldn't save this time. Try again.",
		});
		expect(timerErrorText(server, true)).toBe(
			"Proyekto couldn't save this time. Try again.",
		);
		expect(timerErrorText(new Error("boom"))).toBe(GENERIC_ERROR);
		// Validation and pipe output never reaches people (same filter as lib/timeErrors).
		const dto = new TimeApiError({
			status: 400,
			code: "HTTP_400" as never,
			message: "note must be shorter than or equal to 2000 characters",
		});
		expect(timerErrorText(dto, false)).toBe(
			"Proyekto couldn't finish this. Check the details and try again.",
		);
		const pipe = new TimeApiError({
			status: 404,
			code: "HTTP_404" as never,
			message: "Validation failed (uuid is expected)",
		});
		expect(timerErrorText(pipe, false)).toBe(
			"This doesn't exist or you can't open it.",
		);
		// The server's fixed sentences are kept.
		const onBreak = new TimeApiError({
			status: 409,
			code: "TIMER_NOT_RUNNING",
			message: "This timer is already on break.",
		});
		expect(timerErrorText(onBreak, false)).toBe(
			"This timer is already on break.",
		);
		// A failed read says "load", a failed write "save".
		const internal = new TimeApiError({
			status: 500,
			code: "TIME_INTERNAL",
			message: "boom",
		});
		expect(timerErrorText(internal, false, "read")).toBe(
			"Proyekto couldn't load this time. Try again.",
		);
		expect(timerErrorText(internal, false)).toBe(
			"Proyekto couldn't save this time. Try again.",
		);
	});
});
