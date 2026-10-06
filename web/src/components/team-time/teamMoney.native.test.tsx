/* @vitest-environment jsdom */

// §4 native sweep for the team money package (W1-10): in the installed app
// nothing here may say contract, rate, payout or invoice, show an amount, or
// link to /engagements. Rates and payouts are web-only surfaces (L54), so
// each one renders the "use the web" card instead.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamMoneyAccess } from "@/components/team-time/useTeamMoneyAccess";
import { payoutsService } from "@/services/payouts.service";
import { timeService } from "@/services/time.service";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => true }));

const mocks = vi.hoisted(() => ({
	access: null as unknown as TeamMoneyAccess,
}));
vi.mock("@/components/team-time/useTeamMoneyAccess", () => ({
	useTeamMoneyAccess: () => mocks.access,
}));
vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { PayMemberModal } from "./PayMemberModal";
import { TeamMoneyGate } from "./TeamMoneyGate";
import { TeamPayoutsPanel } from "./TeamPayoutsPanel";
import { TeamRatesPanel } from "./TeamRatesPanel";

const FORBIDDEN = /\b(contracts?|rates?|payouts?|invoices?)\b/i;
const AMOUNT = /\b[A-Z]{3} -?\d[\d,]*(?:\.\d+)?\b|[$€£₱¥]\s?\d/;

function access(overrides: Partial<TeamMoneyAccess> = {}): TeamMoneyAccess {
	return {
		isLoading: false,
		error: null,
		team: undefined,
		isApprover: true,
		isTeamMember: true,
		timeTrackingEnabled: true,
		hasRates: true,
		canPay: true,
		planWorkspaceId: "ws-1",
		planWorkspace: null,
		isComplimentary: false,
		planStatus: "ready",
		payoutsPlanLimit: null,
		teamRulesPlanLimit: null,
		...overrides,
	};
}

function renderNative(ui: ReactElement) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

/** Every visible string, title and accessible label, plus every link target. */
function sweep() {
	const texts = [document.body.textContent ?? ""];
	for (const el of Array.from(
		document.querySelectorAll("[title],[aria-label],[placeholder],[alt]"),
	)) {
		for (const attr of ["title", "aria-label", "placeholder", "alt"]) {
			const value = el.getAttribute(attr);
			if (value) texts.push(value);
		}
	}
	const all = texts.join(" \n ");
	expect(all).not.toMatch(FORBIDDEN);
	expect(all).not.toMatch(AMOUNT);
	for (const a of Array.from(document.querySelectorAll("a[href]"))) {
		expect(a.getAttribute("href") ?? "").not.toMatch(/\/engagements\b/);
	}
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("team money in the installed app", () => {
	it("Payouts: a pointer to the web, and no money read", () => {
		mocks.access = access();
		const owed = vi.spyOn(payoutsService, "getTeamOwed");
		const list = vi.spyOn(payoutsService, "listTeamPayouts");
		const entries = vi.spyOn(timeService, "getReportEntries");
		renderNative(<TeamPayoutsPanel teamId="team-1" />);

		expect(
			screen.getByText("Open Proyekto on the web to see this."),
		).toBeTruthy();
		expect(owed).not.toHaveBeenCalled();
		expect(list).not.toHaveBeenCalled();
		expect(entries).not.toHaveBeenCalled();
		sweep();
	});

	it("Rates: a pointer to the web", () => {
		mocks.access = access();
		renderNative(<TeamRatesPanel teamId="team-1" />);
		expect(
			screen.getByText("Open Proyekto on the web to see this."),
		).toBeTruthy();
		sweep();
	});

	it("the payment dialog: a pointer to the web, never the form", () => {
		renderNative(
			<PayMemberModal
				isOpen
				teamId="team-1"
				memberId="member-1"
				memberLabel="Juan"
				currency="PHP"
				entries={[
					{
						id: "e1",
						started_at: "2026-09-20T01:00:00.000Z",
						payable_seconds: 3600,
						rate_snapshot: 100,
						currency_snapshot: "PHP",
					},
				]}
				onClose={() => {}}
				onSuccess={() => {}}
			/>,
		);
		expect(
			screen.getByText("Open Proyekto on the web to do this."),
		).toBeTruthy();
		sweep();
	});

	it.each([
		["rates", access()],
		["payouts", access()],
		["rates", access({ hasRates: false })],
		["payouts", access({ canPay: false })],
	] as const)("the gate for %s stays on the web", (need, value) => {
		mocks.access = value;
		renderNative(
			<TeamMoneyGate teamId="team-1" need={need}>
				<p>panel</p>
			</TeamMoneyGate>,
		);
		expect(screen.queryByText("panel")).toBeNull();
		sweep();
	});

	it.each([
		["time off", access({ timeTrackingEnabled: false })],
		["not a manager", access({ isApprover: false })],
	])("the team report gate (%s) is worded without money", (_label, value) => {
		mocks.access = value;
		renderNative(
			<TeamMoneyGate teamId="team-1" need="approver">
				<p>report</p>
			</TeamMoneyGate>,
		);
		expect(screen.queryByText("report")).toBeNull();
		sweep();
	});
});
