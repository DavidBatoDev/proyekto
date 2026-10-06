/* @vitest-environment jsdom */

// Native copy rules (ux.md › Mobile; web blueprint §4): in the installed app
// the For chip, picker and "Who approves this time" never say contract, rate,
// payout or invoice, never show an amount on an agreement, and never link to
// /engagements.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => true }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({
			children,
			to,
			params,
		}: {
			children?: ReactNode;
			to: string;
			params?: Record<string, string>;
		}) => {
			let href = to;
			for (const [key, value] of Object.entries(params ?? {})) {
				href = href.replace(`$${key}`, value);
			}
			return <a href={href}>{children}</a>;
		},
	};
});

import { TimeApiError } from "@/services/time.service";
import type {
	LoggingForResult,
	LoggingOption,
	ResolvedTimePolicy,
} from "@/services/time.types";
import { ForChip } from "./ForChip";
import { ForPicker, ForPickerPanel } from "./ForPicker";
import { nativeSafe, sameApproverNote, timerErrorText } from "./forCopy";
import { WhoApprovesContent } from "./WhoApprovesPopover";

const BANNED = /\b(contracts?|rates?|payouts?|invoices?)\b/i;
const AMOUNT = /\b[A-Z]{3}\s?[\d,]+(\.\d+)?\b|[$€£₱]\s?\d/;

function assertNativeSafe(container: HTMLElement) {
	const text = container.textContent ?? "";
	expect(text).not.toMatch(BANNED);
	expect(text).not.toMatch(AMOUNT);
	const titles = Array.from(container.querySelectorAll("[title]")).map(
		(el) => el.getAttribute("title") ?? "",
	);
	for (const title of titles) expect(title).not.toMatch(BANNED);
	expect(container.querySelector('a[href*="/engagements"]')).toBeNull();
}

function option(
	kind: LoggingOption["kind"],
	id: string | null,
	label: string,
	over: Partial<LoggingOption> = {},
): LoggingOption {
	return {
		kind,
		id,
		label,
		sheet_scope: kind === "personal" ? null : { kind: "engagement", ref: "e" },
		rate_source: kind === "assignment" ? "engagement_cost" : "none",
		workspace_tag: null,
		approver_hint: kind === "assignment" ? "hirer" : "workspace",
		...over,
	};
}

const agreement = option("assignment", "a1", "Acme Corp", {
	engagement_id: "eng-1",
});
const client = option("assignment", "a2", "Pixel Studio", {
	approver_hint: "auto",
	engagement_id: "eng-2",
});
const team = option("team", "t1", "Prodigitality Services Inc. Team", {
	rate_source: "team_member_rates",
	approver_hint: "team",
	workspace_tag: "Prodigitality",
});

const result: LoggingForResult = {
	options: [team, agreement, client],
	selected: null,
	prefill: agreement,
	unavailable: [
		{
			kind: "assignment",
			id: "a3",
			label: "Leo Cruz",
			reason: "contract_disabled",
		},
		{ kind: "assignment", id: "a4", label: "Ana Reyes", reason: "no_settings" },
		{
			kind: "assignment",
			id: "a5",
			label: "Old Client",
			reason: "engagement_inactive",
		},
		{ kind: "workspace", id: "w1", label: "Acme", reason: "plan" },
		{ kind: "team", id: "t2", label: "Design", reason: "team_time_off" },
	],
};

const terms: ResolvedTimePolicy = {
	tracking_enabled: true,
	period_kind: "weekly",
	week_start: 1,
	timezone: "Asia/Manila",
	period_anchor: null,
	approval_required: true,
	approver_scope: "workspace",
	allow_manual_entries: true,
	retroactive_days: 7,
	rounding_minutes: 15,
	weekly_limit_minutes: 2400,
	reminder_days: 1,
	hidden_presets: [],
	tracking_mode: "required",
	sources: {
		approval_required: "contract",
		period_kind: "contract",
		rounding_minutes: "contract",
		weekly_limit_minutes: "contract",
	},
	plan: { time_tracking: true, time_team_rules: true },
	policy_workspace_id: "w",
	team_override_applied: false,
	member: {
		weekly_limit_hours: 40,
		monthly_limit_hours: 160,
		overtime_requires_approval: true,
	},
	client_hours_detail_level: "detailed",
	engagement_id: "eng-1",
};

afterEach(() => {
	cleanup();
});

describe("For surfaces on native", () => {
	it("the chip names the counterparty only", () => {
		const { container } = render(
			<QueryClientProvider client={new QueryClient()}>
				<ForChip
					projectId="p1"
					option={agreement}
					note={sameApproverNote()}
					variant="locked"
					lockedText="Submitted Oct 6. Withdraw to change."
				/>
			</QueryClientProvider>,
		);
		expect(container.textContent).toContain("Acme Corp");
		assertNativeSafe(container);
	});

	it("the picker and its reasons", () => {
		const { container } = render(
			<ForPickerPanel
				mode="start"
				result={result}
				value={{ kind: "assignment", id: "a1" }}
				onChange={vi.fn()}
				remember
				onRememberChange={vi.fn()}
				onConfirm={vi.fn()}
				onCancel={vi.fn()}
				error="That choice isn't available any more. Pick again."
			/>,
		);
		expect(container.textContent).toContain(
			"Time tracking is off in your agreement with Leo Cruz.",
		);
		expect(container.textContent).toContain(
			"Submitting confirms these hours for your agreement with Pixel Studio.",
		);
		assertNativeSafe(container);
		const plain = render(
			<ForPicker result={result} value={null} onChange={vi.fn()} />,
		);
		assertNativeSafe(plain.container);
	});

	it("a team row's reason names its workspace (A-4) and stays safe", () => {
		const { container } = render(
			<ForPicker
				result={{
					...result,
					unavailable: [
						{
							kind: "team",
							id: "t2",
							label: "Design Team",
							reason: "plan",
							workspace_name: "Prodigitality",
						},
						{
							kind: "team",
							id: "t3",
							label: "Ops Team",
							reason: "team_time_off",
							workspace_name: "Prodigitality",
						},
					],
				}}
				value={null}
				onChange={vi.fn()}
			/>,
		);
		expect(container.textContent).toContain(
			"Prodigitality's plan doesn't include timesheets.",
		);
		expect(container.textContent).toContain(
			"Prodigitality has time tracking off for this team.",
		);
		assertNativeSafe(container);
	});

	it("Who approves this time: no View terms, no /engagements link, no banned words", () => {
		const { container } = render(
			<WhoApprovesContent option={agreement} policy={terms} />,
		);
		expect(container.textContent).toContain(
			"Set by your agreement with Acme Corp",
		);
		expect(container.textContent).not.toContain("View terms");
		expect(container.querySelector("a")).toBeNull();
		assertNativeSafe(container);
		const teamView = render(
			<WhoApprovesContent option={team} policy={{ ...terms, sources: {} }} />,
		);
		assertNativeSafe(teamView.container);
	});

	it("server text is made safe before it is shown", () => {
		expect(sameApproverNote()).toBe("Same approver either way");
		expect(nativeSafe("This contract has ended.")).toBe(
			"This agreement has ended.",
		);
		const error = new TimeApiError({
			status: 409,
			code: "LEGACY_CONTRACT_AMBIGUOUS",
			message:
				"More than one team could bill hours on this contract. Set the provider's team on the contract first.",
		});
		expect(timerErrorText(error)).not.toMatch(BANNED);
		const payout = new TimeApiError({
			status: 403,
			code: "PAYOUT_SELF_NOT_ALLOWED",
			message: "Someone else on the team has to record your payout.",
		});
		expect(timerErrorText(payout)).not.toMatch(BANNED);
	});
});
