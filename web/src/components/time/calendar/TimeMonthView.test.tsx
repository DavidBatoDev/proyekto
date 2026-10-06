/* @vitest-environment jsdom */

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

const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));
vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import { TimeApiError, timeService } from "@/services/time.service";
import type { Paged, TimeEntryView } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import {
	entriesByDay,
	entryTone,
	MONTH_VIEW_COPY,
	monthGrid,
	monthTitle,
	shiftMonth,
	TimeMonthView,
} from "./TimeMonthView";

const TZ = "Asia/Manila";
const USER = "u1";
// Tue Oct 6 2026, 10:00 in Manila.
const NOW = Date.parse("2026-10-06T02:00:00.000Z");

function entry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return {
		id: "e1",
		context_kind: "team",
		context_ref: "t1",
		context_label_snapshot: "Design",
		timesheet_id: null,
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
		flagged_reason: null,
		project_id: "p1",
		team_id: "t1",
		workspace_id: null,
		engagement_assignment_id: null,
		created_at: "2026-10-05T04:30:00.000Z",
		updated_at: "2026-10-05T04:30:00.000Z",
		timesheet: null,
		locked_reason: null,
		identity: "visible",
		member_user_id: USER,
		member_display_name_snapshot: "Maria",
		member: null,
		member_label: null,
		content: "visible",
		task_id: "task-1",
		note: null,
		task: {
			id: "task-1",
			title: "Fix login bug",
			work_type: null,
			status: null,
		},
		project: { id: "p1", title: "Acme Website" },
		content_label: null,
		cost: "hidden",
		...over,
	};
}

function paged(items: TimeEntryView[]): Paged<TimeEntryView> {
	return { items, total: items.length, page: 1, limit: 200 };
}

function renderMonth(props: Partial<Parameters<typeof TimeMonthView>[0]> = {}) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	render(<TimeMonthView timeZone={TZ} nowMs={NOW} {...props} />, { wrapper });
	return { client };
}

function cell(date: string): HTMLElement {
	const el = document.querySelector(`[data-date="${date}"]`);
	if (!el) throw new Error(`no cell ${date}`);
	return el as HTMLElement;
}

/** The day's own button, stretched over its cell. */
function dayButton(date: string): HTMLElement {
	const el = cell(date).querySelector("button[data-day-button]");
	if (!el) throw new Error(`no day button ${date}`);
	return el as HTMLElement;
}

beforeEach(() => {
	useAuthStore.setState({ user: { id: USER } as never });
	vi.spyOn(timeService, "getProjectPolicy").mockRejectedValue(
		new TimeApiError({ status: 404, code: "TIME_NOT_FOUND", message: "x" }),
	);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	useAuthStore.setState({ user: null });
});

describe("month maths", () => {
	it("titles and steps months", () => {
		expect(monthTitle("2026-10-15")).toBe("October 2026");
		expect(shiftMonth("2026-10-15", -1)).toBe("2026-09-01");
		expect(shiftMonth("2026-10-15", 1)).toBe("2026-11-01");
		expect(shiftMonth("2026-01-31", -1)).toBe("2025-12-01");
		expect(shiftMonth("2026-12-01", 1)).toBe("2027-01-01");
	});

	it("lays the month out in full weeks from the week start", () => {
		const monday = monthGrid("2026-10-15", 1);
		expect(monday.start).toBe("2026-09-28");
		expect(monday.end).toBe("2026-11-01");
		expect(monday.days).toHaveLength(35);
		expect(monday.weekdays).toEqual([1, 2, 3, 4, 5, 6, 7]);
		const sunday = monthGrid("2026-10-15", 7);
		expect(sunday.start).toBe("2026-09-27");
		expect(sunday.end).toBe("2026-10-31");
		expect(sunday.weekdays).toEqual([7, 1, 2, 3, 4, 5, 6]);
		expect(monthGrid("2026-10-15", 99).weekdays[0]).toBe(1);
	});

	it("groups entries by their day in the view's timezone", () => {
		// 17:00Z on Oct 4 is 01:00 on Oct 5 in Manila.
		const late = entry({ id: "late", started_at: "2026-10-04T17:00:00.000Z" });
		const map = entriesByDay([entry(), late], TZ);
		expect(map.get("2026-10-05")?.map((e) => e.id)).toEqual(["late", "e1"]);
		expect(entriesByDay([late], "UTC").get("2026-10-04")).toHaveLength(1);
	});

	it("colours chips by running, paid, then the sheet", () => {
		expect(entryTone(entry({ ended_at: null }))).toBe("running");
		expect(entryTone(entry({ payout_id: "po" }))).toBe("paid");
		expect(entryTone(entry({ payable_seconds: 100 }))).toBe("approved");
		const sheet = {
			id: "s",
			period_start: "2026-10-05",
			period_end: "2026-10-11",
			decision_kind: null,
			decided_by: null,
			decided_at: null,
			decision_note: null,
			scope_label_snapshot: "Design",
		};
		expect(
			entryTone(entry({ timesheet: { ...sheet, status: "returned" } })),
		).toBe("returned");
		expect(
			entryTone(entry({ timesheet: { ...sheet, status: "submitted" } })),
		).toBe("submitted");
		expect(entryTone(entry())).toBe("open");
	});
});

describe("TimeMonthView", () => {
	it("fetches the month's full weeks with the page filters", async () => {
		const list = vi
			.spyOn(timeService, "listMyEntries")
			.mockResolvedValue(paged([entry()]));
		renderMonth({
			month: "2026-10-20",
			forRef: { kind: "team", id: "t1" },
			projectId: "p1",
		});
		expect(screen.getByTestId("month-title").textContent).toBe("October 2026");
		await waitFor(() => expect(list).toHaveBeenCalled());
		expect(list).toHaveBeenCalledWith(
			expect.objectContaining({
				from: "2026-09-28",
				to: "2026-11-01",
				project_id: "p1",
				for: { kind: "team", id: "t1" },
				page: 1,
				limit: 200,
			}),
		);
		await waitFor(() =>
			expect(cell("2026-10-05").textContent).toContain("Fix login bug"),
		);
		expect(cell("2026-10-05").textContent).toContain("3:30");
	});

	it("warns on a day over 8 hours and caps the chips", async () => {
		const day = (id: string, hour: number) =>
			entry({
				id,
				started_at: `2026-10-05T0${hour}:00:00.000Z`,
				ended_at: `2026-10-05T0${hour}:59:00.000Z`,
				duration_seconds: 9000,
			});
		vi.spyOn(timeService, "listMyEntries").mockResolvedValue(
			paged([day("a", 0), day("b", 1), day("c", 2), day("d", 3)]),
		);
		renderMonth({ month: "2026-10-05" });
		await waitFor(() =>
			expect(cell("2026-10-05").textContent).toContain("+1 more"),
		);
		expect(cell("2026-10-05").textContent).toContain("10:00");
		expect(
			cell("2026-10-05").querySelector('[aria-label="Over 8 hours"]'),
		).toBeTruthy();
		expect(cell("2026-10-06").textContent).not.toContain(":");
	});

	it("the day is a real button, its chips sibling buttons (no nested interactive)", async () => {
		vi.spyOn(timeService, "listMyEntries").mockResolvedValue(paged([entry()]));
		renderMonth({ month: "2026-10-05" });
		const chip = await waitFor(() => {
			const button = cell("2026-10-05").querySelector("button[data-tone]");
			if (!button) throw new Error("no chip yet");
			return button;
		});
		expect(cell("2026-10-05").getAttribute("role")).toBeNull();
		expect(chip.closest('[role="button"]')).toBeNull();
		expect(dayButton("2026-10-05").contains(chip)).toBe(false);
		expect(dayButton("2026-10-05").getAttribute("aria-label")).toMatch(
			/^Mon Oct 5, 1 entry, /,
		);
	});

	it("Escape closes the month picker", async () => {
		vi.spyOn(timeService, "listMyEntries").mockResolvedValue(paged([]));
		renderMonth({ month: "2026-10-05" });
		fireEvent.click(screen.getByTitle(MONTH_VIEW_COPY.jump));
		expect(
			screen.getByRole("dialog", { name: MONTH_VIEW_COPY.jump }),
		).toBeTruthy();
		fireEvent.keyDown(document, { key: "Escape" });
		expect(
			screen.queryByRole("dialog", { name: MONTH_VIEW_COPY.jump }),
		).toBeNull();
	});

	it("opens a day from a chip with that entry highlighted", async () => {
		vi.spyOn(timeService, "listMyEntries").mockResolvedValue(paged([entry()]));
		renderMonth({ month: "2026-10-05" });
		const chip = await waitFor(() => {
			const button = cell("2026-10-05").querySelector("button[data-tone]");
			if (!button) throw new Error("no chip yet");
			return button;
		});
		fireEvent.click(chip);
		const dialog = await screen.findByRole("dialog");
		expect(dialog.textContent).toMatch(/Mon Oct 5/);
		expect(
			document
				.querySelector('tr[data-entry-id="e1"]')
				?.getAttribute("data-highlighted"),
		).toBe("true");
	});

	it("opens an empty day from its cell", async () => {
		vi.spyOn(timeService, "listMyEntries").mockResolvedValue(paged([]));
		const onAddTimeForDay = vi.fn();
		renderMonth({ month: "2026-10-05", onAddTimeForDay });
		fireEvent.click(dayButton("2026-10-14"));
		fireEvent.click(await screen.findByRole("button", { name: "Add time" }));
		expect(onAddTimeForDay).toHaveBeenCalledWith("2026-10-14");
	});

	it("steps months and jumps back to this one", async () => {
		const list = vi
			.spyOn(timeService, "listMyEntries")
			.mockResolvedValue(paged([]));
		renderMonth();
		expect(screen.getByTestId("month-title").textContent).toBe("October 2026");
		fireEvent.click(screen.getByRole("button", { name: MONTH_VIEW_COPY.next }));
		expect(screen.getByTestId("month-title").textContent).toBe("November 2026");
		await waitFor(() =>
			expect(list).toHaveBeenCalledWith(
				expect.objectContaining({ from: "2026-10-26", to: "2026-12-06" }),
			),
		);
		fireEvent.click(
			screen.getByRole("button", { name: MONTH_VIEW_COPY.previous }),
		);
		fireEvent.click(
			screen.getByRole("button", { name: MONTH_VIEW_COPY.previous }),
		);
		expect(screen.getByTestId("month-title").textContent).toBe(
			"September 2026",
		);
		fireEvent.click(
			screen.getByRole("button", { name: MONTH_VIEW_COPY.thisMonth }),
		);
		expect(screen.getByTestId("month-title").textContent).toBe("October 2026");
	});

	it("jumps to a month from the picker", () => {
		vi.spyOn(timeService, "listMyEntries").mockResolvedValue(paged([]));
		renderMonth();
		fireEvent.click(screen.getByTitle(MONTH_VIEW_COPY.jump));
		fireEvent.click(
			screen.getByRole("button", { name: MONTH_VIEW_COPY.nextYear }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Mar" }));
		expect(screen.getByTestId("month-title").textContent).toBe("March 2027");
	});

	it("lets the page control the month", () => {
		vi.spyOn(timeService, "listMyEntries").mockResolvedValue(paged([]));
		const onMonthChange = vi.fn();
		renderMonth({ month: "2026-10-05", onMonthChange });
		fireEvent.click(screen.getByRole("button", { name: MONTH_VIEW_COPY.next }));
		expect(onMonthChange).toHaveBeenCalledWith("2026-11-01");
		// Controlled: the title follows the prop, not the click.
		expect(screen.getByTestId("month-title").textContent).toBe("October 2026");
	});

	it("edits from the day dialog in its own dialog above it", async () => {
		vi.spyOn(timeService, "listMyEntries").mockResolvedValue(paged([entry()]));
		renderMonth({ month: "2026-10-05" });
		await waitFor(() =>
			expect(cell("2026-10-05").textContent).toContain("Fix login bug"),
		);
		fireEvent.click(dayButton("2026-10-05"));
		await screen.findByRole("dialog");
		const trigger = document.querySelector(
			'tr[data-entry-id="e1"] button[aria-label="Entry actions"]',
		);
		fireEvent.click(trigger as Element);
		fireEvent.click(screen.getByText("Edit"));
		expect(await screen.findByText("Edit time entry")).toBeTruthy();
		expect(screen.getAllByRole("dialog")).toHaveLength(2);
	});

	it("hands actions to the page when it asks for them", async () => {
		vi.spyOn(timeService, "listMyEntries").mockResolvedValue(paged([entry()]));
		const onDeleteEntry = vi.fn();
		renderMonth({ month: "2026-10-05", onDeleteEntry });
		await waitFor(() =>
			expect(cell("2026-10-05").textContent).toContain("Fix login bug"),
		);
		fireEvent.click(dayButton("2026-10-05"));
		await screen.findByRole("dialog");
		fireEvent.click(
			document.querySelector(
				'tr[data-entry-id="e1"] button[aria-label="Entry actions"]',
			) as Element,
		);
		fireEvent.click(screen.getByText("Delete"));
		expect(onDeleteEntry).toHaveBeenCalledWith(
			expect.objectContaining({ id: "e1" }),
			{ zIndex: 1210 },
		);
		expect(screen.queryByText("Delete time entry?")).toBeNull();
	});

	it("explains a failed load and tries again", async () => {
		const list = vi
			.spyOn(timeService, "listMyEntries")
			// A 4xx is an answer (no automatic retry), so the card shows at once.
			.mockRejectedValueOnce(
				new TimeApiError({
					status: 400,
					code: "HTTP_400",
					message: "The start date must be on or before the end date.",
				}),
			)
			.mockResolvedValue(paged([]));
		renderMonth({ month: "2026-10-05" });
		const alert = await screen.findByRole("alert");
		// Never the server's validator wording; the plain client copy.
		expect(alert.textContent).toContain(
			"Proyekto couldn't finish this. Check the details and try again.",
		);
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
		expect(list).toHaveBeenCalledTimes(2);
	});
});
