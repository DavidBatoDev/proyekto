/* @vitest-environment jsdom */

// Native copy rules (ux.md › Mobile; web blueprint §4) for the review screen:
// on the installed app it never says contract, rate, payout or invoice, never
// shows an amount on an agreement sheet (no Estimated cost, no Amount at
// approval), and never links to /engagements (no "View terms →", no invoice
// link on a settled refusal). Agreement sheets still render: a talent's own
// hours are execution work.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
			className,
		}: {
			children?: ReactNode;
			to: string;
			params?: Record<string, string>;
			className?: string;
		}) => {
			let href = to;
			for (const [key, value] of Object.entries(params ?? {})) {
				href = href.replace(`$${key}`, value);
			}
			return (
				<a href={href} className={className}>
					{children}
				</a>
			);
		},
	};
});
const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));

import { TimeApiError, timeService } from "@/services/time.service";
import type { TimesheetDetail } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import {
	DECIDER,
	deciderDetail,
	ENGAGEMENT_ID,
	entries,
	MEMBER,
	NOW,
	rules,
	SHEET_ID,
	sheet,
	TZ,
} from "./__fixtures__/reviewFixtures";
import { TimesheetReview } from "./TimesheetReview";

const BANNED = /\b(contracts?|rates?|payouts?|invoices?)\b/i;
const AMOUNT = /\b[A-Z]{3}\s?-?[\d,]+(\.\d+)?\b|[$€£₱¥]\s?\d/;

function assertNativeSafe() {
	const text = document.body.textContent ?? "";
	expect(text).not.toMatch(BANNED);
	expect(text).not.toMatch(AMOUNT);
	for (const attr of ["title", "aria-label", "placeholder"]) {
		for (const el of Array.from(document.body.querySelectorAll(`[${attr}]`))) {
			expect(el.getAttribute(attr) ?? "").not.toMatch(BANNED);
			expect(el.getAttribute(attr) ?? "").not.toMatch(AMOUNT);
		}
	}
	expect(
		document.body.querySelectorAll('a[href*="/engagements"]'),
	).toHaveLength(0);
}

function stubViewport(width: number) {
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		writable: true,
		value: (query: string) => {
			const max = /max-width:\s*(\d+)px/.exec(query);
			return {
				matches: max ? width <= Number(max[1]) : false,
				media: query,
				onchange: null,
				addListener: () => {},
				removeListener: () => {},
				addEventListener: () => {},
				removeEventListener: () => {},
				dispatchEvent: () => false,
			};
		},
	});
}

let client: QueryClient;
function renderWith(ui: ReactElement) {
	client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

/** Leo's agreement sheet with Acme Corp, priced and over the agreement's limit. */
function agreementDetail(over: Partial<TimesheetDetail> = {}): TimesheetDetail {
	const priced = entries().map((e) => ({
		...e,
		context_kind: "assignment" as const,
		context_ref: "as1",
		context_label_snapshot: "Acme Corp",
		cost: "visible" as const,
		rate_snapshot: 20,
		rate_type_snapshot: "hourly" as const,
		currency_snapshot: "USD",
		amount_snapshot: null,
	}));
	return deciderDetail({
		sheet: sheet({
			scope_kind: "engagement",
			scope_label_snapshot: "Acme Corp",
			engagement_id: ENGAGEMENT_ID,
			team_id: null,
			approver_scope: "hirer",
			member_display_name_snapshot: "Leo Cruz",
		}),
		entries: priced,
		rules: rules({
			weekly_limit_minutes: 960,
			sources: { weekly_limit_minutes: "contract", period_kind: "contract" },
		}),
		freeze_preview: {
			timesheet_id: SHEET_ID,
			over_cap_seconds: 2 * 3600,
			entries: [
				{
					entry_id: "e1",
					rounded_seconds: 0,
					payable_seconds: 16 * 3600,
					over_cap_seconds: 2 * 3600,
				},
			],
			amounts_by_currency: { USD: 320 },
		},
		...over,
	});
}

beforeEach(() => {
	stubViewport(390);
	vi.spyOn(timeService, "listEntryComments").mockResolvedValue([]);
	vi.spyOn(timeService, "listEntrySegments").mockResolvedValue([]);
});

afterEach(() => {
	cleanup();
	client?.clear();
	useAuthStore.setState({ user: null });
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe("review screen on native", () => {
	it("an agreement sheet: no amounts, no terms link, no banned words (decider)", async () => {
		useAuthStore.setState({ user: { id: DECIDER } as never });
		vi.spyOn(timeService, "getTimesheet").mockResolvedValue(agreementDetail());
		renderWith(
			<TimesheetReview timesheetId={SHEET_ID} now={NOW} userTimezone={TZ} />,
		);
		const heading = await screen.findByRole("heading", { level: 1 });
		// The counterparty alone on native (no " · agreement").
		expect(heading.textContent).toContain("Leo Cruz · Acme Corp · Sep 21");
		expect(heading.textContent).not.toContain("· agreement");
		expect(screen.getByTestId("review-rules").textContent).toBe(
			"Rules from this agreement",
		);
		expect(screen.queryByText(/View terms/)).toBeNull();
		expect(screen.queryByTestId("review-cost")).toBeNull();
		// The over-limit panel still shows: hours only.
		expect(screen.getByTestId("review-over-limit").textContent).toContain(
			"2:00 over",
		);
		assertNativeSafe();

		// The Approve dialog too.
		fireEvent.click(
			within(screen.getByTestId("review-action-bar")).getByRole("button", {
				name: "Approve…",
			}),
		);
		await screen.findByRole("dialog");
		assertNativeSafe();
	});

	it("the talent's own agreement sheet: no money, no terms link", async () => {
		useAuthStore.setState({ user: { id: MEMBER } as never });
		const own = agreementDetail();
		vi.spyOn(timeService, "getTimesheet").mockResolvedValue({
			...own,
			viewer: { is_member: true, can_decide: false, actions: ["withdraw"] },
			freeze_preview: undefined,
			deciders: [{ id: DECIDER, display_name: "Ana Reyes" }],
		});
		renderWith(
			<TimesheetReview timesheetId={SHEET_ID} now={NOW} userTimezone={TZ} />,
		);
		expect((await screen.findByTestId("review-rules")).textContent).toBe(
			"Rules from your agreement with Acme Corp",
		);
		expect(screen.queryByTestId("review-cost")).toBeNull();
		assertNativeSafe();
	});

	it("the talent's open agreement sheet says where it goes, natively", async () => {
		useAuthStore.setState({ user: { id: MEMBER } as never });
		const own = agreementDetail({
			sheet: sheet({
				scope_kind: "engagement",
				scope_label_snapshot: "Acme Corp",
				engagement_id: ENGAGEMENT_ID,
				team_id: null,
				approver_scope: "auto",
				status: "open",
				submitted_at: null,
			}),
		});
		vi.spyOn(timeService, "getTimesheet").mockResolvedValue({
			...own,
			rules: null,
			viewer: { is_member: true, can_decide: false, actions: ["submit"] },
			freeze_preview: undefined,
			routing_preview: {
				approver_scope: "auto",
				cost_money: false,
				deciders: [],
			},
		});
		renderWith(
			<TimesheetReview timesheetId={SHEET_ID} now={NOW} userTimezone={TZ} />,
		);
		expect((await screen.findByTestId("review-rules")).textContent).toBe(
			"Rules from your agreement with Acme Corp",
		);
		expect(screen.getByTestId("review-goes-to").textContent).toBe(
			"Submitting confirms these hours for your agreement with Acme Corp.",
		);
		assertNativeSafe();
	});

	it("a settled reopen refusal names no invoice and links nowhere", async () => {
		useAuthStore.setState({ user: { id: DECIDER } as never });
		vi.spyOn(timeService, "getTimesheet").mockResolvedValue(
			agreementDetail({
				sheet: sheet({
					scope_kind: "engagement",
					scope_label_snapshot: "Acme Corp",
					engagement_id: ENGAGEMENT_ID,
					approver_scope: "hirer",
					status: "approved",
					decision_kind: "manual",
				}),
				freeze_preview: undefined,
				viewer: { is_member: false, can_decide: true, actions: ["reopen"] },
			}),
		);
		vi.spyOn(timeService, "reopenTimesheet").mockRejectedValue(
			new TimeApiError({
				status: 409,
				code: "TIMESHEET_HAS_SETTLED_ENTRIES",
				message: "settled",
				extras: {
					reason: "billed",
					invoice_id: "i1",
					invoice_number: "INV-0042",
					invoice_status: "draft",
				},
			}),
		);
		renderWith(
			<TimesheetReview timesheetId={SHEET_ID} now={NOW} userTimezone={TZ} />,
		);
		fireEvent.click(await screen.findByRole("button", { name: "Reopen" }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.change(within(dialog).getByRole("textbox"), {
			target: { value: "Thursday needs a task name" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Reopen" }));
		await waitFor(() =>
			expect(within(dialog).getByRole("alert").textContent).toContain(
				"This time is already being billed. Reopen it on the web.",
			),
		);
		assertNativeSafe();
	});

	it("a team sheet keeps its review grid as day cards and its sticky bar", async () => {
		useAuthStore.setState({ user: { id: DECIDER } as never });
		vi.spyOn(timeService, "getTimesheet").mockResolvedValue(deciderDetail());
		renderWith(
			<TimesheetReview timesheetId={SHEET_ID} now={NOW} userTimezone={TZ} />,
		);
		expect(await screen.findByTestId("review-day-cards")).toBeTruthy();
		expect(screen.getByTestId("review-action-bar")).toBeTruthy();
		assertNativeSafe();
	});
});
