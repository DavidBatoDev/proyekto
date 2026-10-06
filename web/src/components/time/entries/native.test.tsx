/* @vitest-environment jsdom */

// Native copy rules (ux.md › Mobile; web blueprint §4): in the installed app
// the entries kit never says contract, rate, payout or invoice, never shows
// an amount on agreement time, and never links to /engagements. The Billed
// badge is web only; Paid stays.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
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
vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		success: vi.fn(),
		error: vi.fn(),
		warning: vi.fn(),
		info: vi.fn(),
	}),
}));

import { timeService } from "@/services/time.service";
import type { TimeEntryView } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import { AmountLines } from "./AmountLines";
import { EntryBadges } from "./EntryBadges";
import { entryLockCopy } from "./entryRules";
import { TimeEntriesTable } from "./TimeEntriesTable";
import { TimeEntryDetailModal } from "./TimeEntryDetailModal";

const BANNED = /\b(contracts?|rates?|payouts?|invoices?)\b/i;
const AMOUNT = /\b[A-Z]{3}\s?-?[\d,]+(\.\d+)?\b|[$€£₱¥]\s?\d/;
const TZ = "Asia/Manila";
const ID = "8f0e2c1a-1111-4222-8333-944455556666";
const SHEET = "5a0e2c1a-1111-4222-8333-944455556666";

function assertNativeSafe(root: HTMLElement) {
	const text = root.textContent ?? "";
	expect(text).not.toMatch(BANNED);
	expect(text).not.toMatch(AMOUNT);
	for (const el of Array.from(root.querySelectorAll("[title],[aria-label]"))) {
		expect(el.getAttribute("title") ?? "").not.toMatch(BANNED);
		expect(el.getAttribute("aria-label") ?? "").not.toMatch(BANNED);
	}
	expect(root.querySelector('a[href*="/engagements"]')).toBeNull();
}

/** Agreement time with cost visible: every money and agreement surface at once. */
function agreementEntry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return {
		id: ID,
		context_kind: "assignment",
		context_ref: "as1",
		context_label_snapshot: "Acme Corp",
		timesheet_id: SHEET,
		work_item: "task",
		started_at: "2026-10-01T01:00:00.000Z",
		ended_at: "2026-10-01T04:30:00.000Z",
		paused_at: null,
		duration_seconds: 3.5 * 3600,
		break_seconds: 0,
		break_minutes: 0,
		payable_seconds: null,
		source: "manual",
		work_type_snapshot: "real_work",
		legacy_status: null,
		payout_id: null,
		flagged_reason: null,
		project_id: "p1",
		team_id: null,
		workspace_id: null,
		engagement_assignment_id: "as1",
		created_at: "2026-10-01T04:30:00.000Z",
		updated_at: "2026-10-01T04:30:00.000Z",
		timesheet: {
			id: SHEET,
			status: "submitted",
			period_start: "2026-09-28",
			period_end: "2026-10-04",
			decision_kind: null,
			decided_by: null,
			decided_at: null,
			decision_note: null,
			scope_label_snapshot: "Acme Corp",
		},
		locked_reason: "billed",
		identity: "visible",
		member_user_id: "u1",
		member_display_name_snapshot: "Leo Cruz",
		member: null,
		member_label: null,
		content: "visible",
		task_id: "task-1",
		note: null,
		task: {
			id: "task-1",
			title: "Fix login bug",
			work_type: "real_work",
			status: "todo",
		},
		project: { id: "p1", title: "Acme Website" },
		content_label: null,
		cost: "visible",
		rate_snapshot: 450,
		rate_type_snapshot: "hourly",
		currency_snapshot: "PHP",
		amount_snapshot: null,
		...over,
	};
}

function stubMatchMedia(width = 1440) {
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

function withClient(ui: ReactElement) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
	vi.setSystemTime(new Date("2026-10-06T04:00:00.000Z"));
	stubMatchMedia();
	useAuthStore.setState({ user: { id: "u1" } as never });
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
	useAuthStore.setState({ user: null });
});

describe("entries kit on native", () => {
	const paid = agreementEntry({
		id: "p",
		payout_id: "po1",
		locked_reason: "paid",
		payable_seconds: 12600,
		amount_snapshot: 1575,
		timesheet: { ...agreementEntry().timesheet!, status: "approved" },
		started_at: "2026-10-02T01:00:00.000Z",
		ended_at: "2026-10-02T02:00:00.000Z",
	});
	const open = agreementEntry({
		id: "o",
		locked_reason: null,
		timesheet: { ...agreementEntry().timesheet!, status: "open" },
		started_at: "2026-09-30T01:00:00.000Z",
		ended_at: "2026-09-30T02:00:00.000Z",
	});

	it("the table: agreement amounts, Billed and the lock sentences stay off", () => {
		const { container } = withClient(
			<TimeEntriesTable
				entries={[agreementEntry(), paid, open]}
				timeZone={TZ}
				showAmounts
				onOpenEntry={vi.fn()}
				onEdit={vi.fn()}
				onDelete={vi.fn()}
				onChangeFor={vi.fn()}
				selection={{ selectedIds: new Set(["o"]), onChange: vi.fn() }}
			/>,
		);
		// No Amount column at all: every row is agreement time.
		expect(container.querySelector("thead")?.textContent).not.toContain(
			"Amount",
		);
		expect(screen.queryByText("Billed")).toBeNull();
		expect(screen.getByText("Paid")).toBeTruthy();
		const billedBox = within(
			container.querySelector(`[data-entry-id="${ID}"]`) as HTMLElement,
		).getByRole("checkbox");
		expect(billedBox.getAttribute("title")).toBe(
			"This time is already being billed, so it can't change.",
		);
		fireEvent.click(
			within(
				container.querySelector('[data-entry-id="o"]') as HTMLElement,
			).getByRole("button", { name: "Log actions" }),
		);
		assertNativeSafe(document.body);
	});

	it("the table in review mode with a phone layout", () => {
		stubMatchMedia(390);
		const { container } = withClient(
			<TimeEntriesTable
				entries={[agreementEntry(), paid]}
				mode="review"
				timeZone={TZ}
				showAmounts
			/>,
		);
		assertNativeSafe(container);
	});

	it("the detail modal: no rate, no agreement amount, no invoice", async () => {
		vi.spyOn(timeService, "getEntry").mockResolvedValue(agreementEntry());
		vi.spyOn(timeService, "listEntryComments").mockResolvedValue([]);
		withClient(
			<TimeEntryDetailModal entryId={ID} onClose={vi.fn()} timeZone={TZ} />,
		);
		await screen.findByText("Source");
		const dialog = screen.getByRole("dialog");
		expect(
			within(dialog).getByText("Submitted · Acme Corp · Sep 28–Oct 4"),
		).toBeTruthy();
		expect(
			within(dialog).getAllByText(
				"This time is already being billed, so it can't change.",
			).length,
		).toBeGreaterThan(0);
		assertNativeSafe(document.body);
	});

	it("the detail modal for paid agreement time", async () => {
		vi.spyOn(timeService, "getEntry").mockResolvedValue(paid);
		vi.spyOn(timeService, "listEntryComments").mockResolvedValue([]);
		withClient(
			<TimeEntryDetailModal entryId={"p"} onClose={vi.fn()} timeZone={TZ} />,
		);
		// "p" is not a uuid: the 404 card, itself native-safe.
		assertNativeSafe(document.body);
		cleanup();
		withClient(
			<TimeEntryDetailModal
				entryId={ID}
				onClose={vi.fn()}
				timeZone={TZ}
				entry={{ ...paid, id: ID }}
			/>,
		);
		expect(await screen.findByText("Paid")).toBeTruthy();
		assertNativeSafe(document.body);
	});

	it("badges, amounts and lock copy helpers", () => {
		const { container } = render(
			<div>
				<EntryBadges entry={agreementEntry()} variant="detail" />
				<AmountLines amounts={{ PHP: 1575 }} cost="visible" kind="assignment" />
				<AmountLines amounts={{ PHP: 1575 }} cost="visible" kind="engagement" />
			</div>,
		);
		expect(container.textContent).toBe("");
		expect(entryLockCopy(agreementEntry())).not.toMatch(BANNED);
	});
});
