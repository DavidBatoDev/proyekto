/* @vitest-environment jsdom */

// Native copy rules (ux.md › Mobile; web blueprint §4): the month view and
// its day dialog never say contract, rate, payout or invoice, never show an
// amount on agreement time (even when the entry carries cost) and never link
// to /engagements. The Billed badge is web-only.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => true }));
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
import { DayEntriesModal } from "./DayEntriesModal";
import { TimeMonthView } from "./TimeMonthView";
import { TimeViewToggle } from "./TimeViewToggle";

const BANNED = /\b(contracts?|rates?|payouts?|invoices?)\b/i;
const AMOUNT = /\b[A-Z]{3}\s?[\d,]+(\.\d+)?\b|[$€£₱]\s?\d/;
const TZ = "Asia/Manila";
const NOW = Date.parse("2026-10-06T02:00:00.000Z");

function assertDomSafe() {
	const text = document.body.textContent ?? "";
	expect(text).not.toMatch(BANNED);
	expect(text).not.toMatch(AMOUNT);
	for (const el of Array.from(document.body.querySelectorAll("[title]"))) {
		expect(el.getAttribute("title") ?? "").not.toMatch(BANNED);
	}
	for (const el of Array.from(document.body.querySelectorAll("[aria-label]"))) {
		expect(el.getAttribute("aria-label") ?? "").not.toMatch(BANNED);
	}
	expect(document.body.querySelector('a[href*="/engagements"]')).toBeNull();
}

function agreementEntry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return {
		id: "e1",
		context_kind: "assignment",
		context_ref: "a1",
		context_label_snapshot: "Acme Corp contract",
		timesheet_id: "s1",
		work_item: "task",
		started_at: "2026-10-05T01:00:00.000Z",
		ended_at: "2026-10-05T04:30:00.000Z",
		paused_at: null,
		duration_seconds: 12_600,
		break_seconds: 0,
		break_minutes: 0,
		payable_seconds: null,
		source: "manual",
		work_type_snapshot: "real_work",
		legacy_status: null,
		payout_id: null,
		flagged_reason: "stopped_by_assignment_end",
		project_id: "p1",
		team_id: null,
		workspace_id: null,
		engagement_assignment_id: "a1",
		created_at: "2026-10-05T04:30:00.000Z",
		updated_at: "2026-10-05T04:30:00.000Z",
		timesheet: null,
		locked_reason: "billed",
		identity: "visible",
		member_user_id: "u1",
		member_display_name_snapshot: "Rico",
		member: null,
		member_label: null,
		content: "visible",
		task_id: "task-1",
		note: null,
		task: {
			id: "task-1",
			title: "Design review",
			work_type: null,
			status: null,
		},
		project: { id: "p1", title: "Acme Website" },
		content_label: null,
		cost: "visible",
		rate_snapshot: 950,
		rate_type_snapshot: "hourly",
		currency_snapshot: "PHP",
		amount_snapshot: 3325,
		...over,
	};
}

function wrapper({ children }: { children: ReactNode }) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
	useAuthStore.setState({ user: { id: "u1" } as never });
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	useAuthStore.setState({ user: null });
});

describe("native: month view", () => {
	it("the grid and the day dialog stay native-safe", async () => {
		vi.spyOn(timeService, "listMyEntries").mockResolvedValue({
			items: [
				agreementEntry(),
				agreementEntry({
					id: "e2",
					locked_reason: "paid",
					payout_id: "po1",
					started_at: "2026-10-05T05:00:00.000Z",
					ended_at: "2026-10-05T06:00:00.000Z",
					duration_seconds: 3600,
				}),
			],
			total: 2,
			page: 1,
			limit: 200,
		});
		render(
			<TimeMonthView
				timeZone={TZ}
				month="2026-10-05"
				nowMs={NOW}
				onAddTimeForDay={() => {}}
				onOpenEntry={() => {}}
			/>,
			{ wrapper },
		);
		const cell = await waitFor(() => {
			const el = document.querySelector('[data-date="2026-10-05"]');
			if (!el?.textContent?.includes("Design review")) throw new Error("wait");
			return el;
		});
		assertDomSafe();
		fireEvent.click(cell.querySelector("button[data-day-button]") as Element);
		await screen.findByRole("dialog");
		// Paid shows on native; Billed is web-only.
		expect(screen.getByText("Paid")).toBeTruthy();
		expect(screen.queryByText("Billed")).toBeNull();
		assertDomSafe();
	});

	it("the day dialog alone and the toggle stay native-safe", () => {
		render(
			<>
				<TimeViewToggle value="month" onChange={() => {}} />
				<DayEntriesModal
					open
					date="2026-10-05"
					entries={[agreementEntry({ locked_reason: null })]}
					timeZone={TZ}
					nowMs={NOW}
					onClose={() => {}}
					onAddTime={() => {}}
					onStartTimer={() => {}}
				/>
			</>,
		);
		assertDomSafe();
	});
});
