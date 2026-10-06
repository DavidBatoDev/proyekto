/* @vitest-environment jsdom */

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

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({ children, to }: { children?: ReactNode; to: string }) => (
			<a href={to}>{children}</a>
		),
	};
});

import { timeService } from "@/services/time.service";
import type { TimeEntryView } from "@/services/time.types";
import { TimeEntriesTable } from "./TimeEntriesTable";

const TZ = "Asia/Manila";
const NOW = new Date("2026-10-06T04:00:00.000Z"); // Tue Oct 6, 12:00 in Manila

function sheet(
	status: NonNullable<TimeEntryView["timesheet"]>["status"],
	over: Partial<NonNullable<TimeEntryView["timesheet"]>> = {},
): TimeEntryView["timesheet"] {
	return {
		id: "s1",
		status,
		period_start: "2026-09-28",
		period_end: "2026-10-04",
		decision_kind: null,
		decided_by: null,
		decided_at: null,
		decision_note: null,
		scope_label_snapshot: "Prodigitality Services Inc. Team",
		...over,
	};
}

function entry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return {
		id: "a",
		context_kind: "team",
		context_ref: "t1",
		context_label_snapshot: "Prodigitality Services Inc. Team",
		timesheet_id: "s1",
		work_item: "task",
		started_at: "2026-10-01T01:00:00.000Z",
		ended_at: "2026-10-01T04:30:00.000Z",
		paused_at: null,
		duration_seconds: 3.5 * 3600,
		break_seconds: 0,
		break_minutes: 0,
		payable_seconds: null,
		source: "timer",
		work_type_snapshot: "real_work",
		legacy_status: null,
		payout_id: null,
		flagged_reason: null,
		project_id: "p1",
		team_id: "t1",
		workspace_id: "w1",
		engagement_assignment_id: null,
		created_at: "2026-10-01T04:30:00.000Z",
		updated_at: "2026-10-01T04:30:00.000Z",
		timesheet: sheet("open"),
		locked_reason: null,
		identity: "visible",
		member_user_id: "u1",
		member_display_name_snapshot: "Maria Santos",
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

const open = entry();
const locked = entry({
	id: "b",
	context_kind: "assignment",
	context_ref: "as1",
	context_label_snapshot: "Acme Corp",
	timesheet_id: "s2",
	timesheet: sheet("submitted", {
		id: "s2",
		scope_label_snapshot: "Acme Corp",
	}),
	locked_reason: "sheet_submitted",
	work_item: "meeting",
	task_id: null,
	task: null,
	started_at: "2026-10-01T05:00:00.000Z",
	ended_at: "2026-10-01T06:00:00.000Z",
	duration_seconds: 3600,
});
const long = entry({
	id: "c",
	started_at: "2026-09-30T00:00:00.000Z",
	ended_at: "2026-09-30T12:00:00.000Z",
	duration_seconds: 12 * 3600,
	task: {
		id: "task-2",
		title: "Forgotten timer",
		work_type: null,
		status: null,
	},
	task_id: "task-2",
});

/** jsdom has no matchMedia; answer `(max-width: Npx)` for a viewport width. */
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

function renderTable(ui: ReactElement) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

function row(container: HTMLElement, id: string): HTMLElement {
	const el = container.querySelector<HTMLElement>(`[data-entry-id="${id}"]`);
	if (!el) throw new Error(`row ${id} not rendered`);
	return el;
}

function openMenu(rowEl: HTMLElement) {
	fireEvent.click(within(rowEl).getByRole("button", { name: "Log actions" }));
}

function menuLabels(): string[] {
	// The menu is portalled to <body>, after the table.
	const items = Array.from(
		document.body.querySelectorAll<HTMLButtonElement>(
			"div.fixed button[type=button]",
		),
	);
	return items.map((b) => b.textContent?.trim() ?? "");
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
	vi.setSystemTime(NOW);
	stubViewport(1440);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("TimeEntriesTable", () => {
	it("groups days in the given timezone with the ux columns", () => {
		const { container } = renderTable(
			<TimeEntriesTable entries={[open, locked]} timeZone={TZ} />,
		);
		const headers = Array.from(container.querySelectorAll("thead th")).map(
			(th) => th.textContent,
		);
		expect(headers).toEqual([
			"#",
			"Task",
			"Project",
			"For",
			"In",
			"Out",
			"Dur",
			"Actions",
		]);
		expect(screen.getByText("Thu Oct 1")).toBeTruthy();
		const first = row(container, "a");
		expect(within(first).getByText("Fix login bug")).toBeTruthy();
		expect(within(first).getByText("Acme Website")).toBeTruthy();
		expect(within(first).getByText("09:00")).toBeTruthy();
		expect(within(first).getByText("12:30")).toBeTruthy();
		expect(within(first).getByText("3:30")).toBeTruthy();
		// The For chip, cut at 22 characters.
		expect(within(first).getByText("Prodigitality Services…")).toBeTruthy();
		// Preset rows show ◦ and the work item.
		const second = row(container, "b");
		expect(within(second).getByText("◦")).toBeTruthy();
		expect(within(second).getByText("Meeting")).toBeTruthy();
	});

	it("puts the accent on the sheet status, with the status in words", () => {
		const { container } = renderTable(
			<TimeEntriesTable
				entries={[
					open,
					locked,
					entry({
						id: "d",
						timesheet: sheet("returned"),
						started_at: "2026-10-02T01:00:00.000Z",
						ended_at: "2026-10-02T02:00:00.000Z",
					}),
				]}
				timeZone={TZ}
			/>,
		);
		const accent = (id: string) =>
			row(container, id).querySelector("td[title]") as HTMLElement;
		expect(accent("b").className).toContain("border-l-muted-foreground/40");
		expect(accent("b").getAttribute("title")).toBe("Submitted");
		expect(accent("d").className).toContain("border-l-warning");
		expect(within(row(container, "d")).getByText("Returned")).toBeTruthy();
	});

	it("a locked row keeps only View details and Comment, and no quick actions", () => {
		const onEdit = vi.fn();
		const { container } = renderTable(
			<TimeEntriesTable
				entries={[open, locked]}
				timeZone={TZ}
				sheets={[{ id: "s2", submitted_at: "2026-10-06T02:00:00.000Z" }]}
				onOpenEntry={vi.fn()}
				onEdit={onEdit}
				onDelete={vi.fn()}
				onChangeFor={vi.fn()}
				onChangeTask={vi.fn()}
			/>,
		);
		const lockedRow = row(container, "b");
		expect(lockedRow.getAttribute("data-locked")).toBe("true");
		expect(
			within(lockedRow).queryByRole("button", { name: "Edit" }),
		).toBeNull();
		// The 🔒 chip says why.
		expect(
			lockedRow.querySelector('[data-variant="locked"]')?.textContent,
		).toContain("Submitted Oct 6. Withdraw to change.");
		openMenu(lockedRow);
		expect(menuLabels()).toEqual(["View details", "Comment"]);
	});

	it("an open row of your own offers the edits, wired to the callbacks", () => {
		const onDelete = vi.fn();
		const onChangeFor = vi.fn();
		const onOpenEntry = vi.fn();
		const { container } = renderTable(
			<TimeEntriesTable
				entries={[open]}
				timeZone={TZ}
				onOpenEntry={onOpenEntry}
				onEdit={vi.fn()}
				onChangeTask={vi.fn()}
				onChangeFor={onChangeFor}
				onDelete={onDelete}
				onOpenTask={vi.fn()}
				canOpenTask={() => true}
			/>,
		);
		const r = row(container, "a");
		expect(within(r).getByRole("button", { name: "Edit" })).toBeTruthy();
		openMenu(r);
		expect(menuLabels()).toEqual([
			"View details",
			"Comment",
			"Edit",
			"Change task",
			"Change For…",
			"Delete",
			"Open task in roadmap",
		]);
		fireEvent.click(screen.getByText("Change For…"));
		expect(onChangeFor).toHaveBeenCalledWith([open]);
		openMenu(r);
		fireEvent.click(screen.getByText("Comment"));
		expect(onOpenEntry).toHaveBeenLastCalledWith(open, { focus: "comments" });
		openMenu(r);
		fireEvent.click(screen.getByText("Delete"));
		expect(onDelete).toHaveBeenCalledWith(open);
	});

	it("a row click opens the entry; actions without a handler are not offered", () => {
		const onOpenEntry = vi.fn();
		const { container } = renderTable(
			<TimeEntriesTable
				entries={[open]}
				timeZone={TZ}
				onOpenEntry={onOpenEntry}
			/>,
		);
		fireEvent.click(within(row(container, "a")).getByText("Fix login bug"));
		expect(onOpenEntry).toHaveBeenCalledWith(open);
		openMenu(row(container, "a"));
		expect(menuLabels()).toEqual(["View details", "Comment"]);
	});

	it("review and readonly modes never edit", () => {
		for (const mode of ["review", "readonly"] as const) {
			const { container, unmount } = renderTable(
				<TimeEntriesTable
					entries={[open]}
					mode={mode}
					timeZone={TZ}
					onOpenEntry={vi.fn()}
					onEdit={vi.fn()}
					onDelete={vi.fn()}
				/>,
			);
			const r = row(container, "a");
			expect(within(r).queryByRole("button", { name: "Edit" })).toBeNull();
			openMenu(r);
			expect(menuLabels()).toEqual(["View details", "Comment"]);
			unmount();
		}
	});

	it("a running row has Stop, reads 'now' and ticks", () => {
		const onStop = vi.fn();
		const running = entry({
			id: "r",
			ended_at: null,
			duration_seconds: null,
			started_at: new Date(NOW.getTime() - 3600_000).toISOString(),
		});
		const { container } = renderTable(
			<TimeEntriesTable entries={[running]} timeZone={TZ} onStop={onStop} />,
		);
		const r = row(container, "r");
		expect(within(r).getByText("now")).toBeTruthy();
		expect(within(r).getAllByText("Running").length).toBeGreaterThan(0);
		expect(within(r).getByText("1:00")).toBeTruthy();
		fireEvent.click(within(r).getByRole("button", { name: /Stop/ }));
		expect(onStop).toHaveBeenCalledWith(running);
	});

	it("a running row says why Edit is off, in the tooltip and the menu", () => {
		const running = entry({
			id: "r",
			ended_at: null,
			duration_seconds: null,
			started_at: new Date(NOW.getTime() - 3600_000).toISOString(),
		});
		const { container } = renderTable(
			<TimeEntriesTable
				entries={[running]}
				timeZone={TZ}
				onStop={vi.fn()}
				onOpenEntry={vi.fn()}
				onEdit={vi.fn()}
				onDelete={vi.fn()}
			/>,
		);
		const r = row(container, "r");
		const edit = within(r).getByRole("button", { name: "Edit" });
		expect((edit as HTMLButtonElement).disabled).toBe(true);
		expect(edit.getAttribute("title")).toBe(
			"Stop the timer to edit its times.",
		);
		openMenu(r);
		expect(menuLabels()).toContain("Edit · Stop the timer to edit its times.");
	});

	it("clicks inside the For chip's popover never open the entry", async () => {
		vi.spyOn(timeService, "getProjectPolicy").mockReturnValue(
			new Promise(() => {}),
		);
		const onOpenEntry = vi.fn();
		const { container } = renderTable(
			<TimeEntriesTable
				entries={[open]}
				timeZone={TZ}
				onOpenEntry={onOpenEntry}
			/>,
		);
		const chip = row(container, "a").querySelector<HTMLElement>(
			'[data-variant="readonly"] button',
		);
		if (!chip) throw new Error("no interactive For chip");
		fireEvent.click(chip);
		const popover = await screen.findByRole("dialog", {
			name: "Who approves this time",
		});
		fireEvent.click(within(popover).getByText("Who approves this time"));
		expect(onOpenEntry).not.toHaveBeenCalled();
		// The rest of the row still opens it.
		fireEvent.click(within(row(container, "a")).getByText("Fix login bug"));
		expect(onOpenEntry).toHaveBeenCalledWith(open);
	});

	it("folds Needs review away in `mine`, open in `review`", () => {
		const { container, unmount } = renderTable(
			<TimeEntriesTable entries={[open, long]} timeZone={TZ} />,
		);
		const header = screen.getByText("Needs review (1)");
		expect(screen.getByText("one entry ran over 10h")).toBeTruthy();
		expect(container.querySelector('[data-entry-id="c"]')).toBeNull();
		// Pulled out of its day: only the open entry's day remains.
		expect(screen.queryByText("Wed Sep 30")).toBeNull();
		fireEvent.click(header);
		expect(row(container, "c")).toBeTruthy();
		unmount();

		const review = renderTable(
			<TimeEntriesTable entries={[open, long]} mode="review" timeZone={TZ} />,
		);
		expect(row(review.container, "c")).toBeTruthy();
		// Row numbers run on through the groups.
		expect(within(row(review.container, "c")).getByText("1")).toBeTruthy();
		expect(within(row(review.container, "a")).getByText("2")).toBeTruthy();
	});

	it("a day over 8 hours shows ⚠", () => {
		const { container } = renderTable(
			<TimeEntriesTable
				entries={[
					open,
					entry({
						id: "e",
						started_at: "2026-10-01T05:00:00.000Z",
						ended_at: "2026-10-01T10:00:00.000Z",
						duration_seconds: 5 * 3600,
					}),
				]}
				timeZone={TZ}
			/>,
		);
		const total = container.querySelector('[title="Over 8 hours this day"]');
		expect(total?.textContent).toContain("8:30");
	});

	it("hidden content reads 'A project you can't open' and the kind only", () => {
		const hidden = entry({
			id: "h",
			content: "hidden",
			content_label: "A project you can't open",
			task: null,
			task_id: null,
			project: null,
			note: null,
			identity: "masked",
			member: null,
			member_label: "Delivery team",
		});
		const { container } = renderTable(
			<TimeEntriesTable entries={[hidden]} mode="review" timeZone={TZ} />,
		);
		const r = row(container, "h");
		expect(within(r).getByText("A project you can't open")).toBeTruthy();
		expect(within(r).getByText("Task")).toBeTruthy();
		expect(within(r).getByText("—")).toBeTruthy();
		expect(r.textContent).not.toContain("Fix login bug");
	});

	it("selection mode: only open, finished rows; the bar offers Change For…", () => {
		const onChange = vi.fn();
		const onChangeFor = vi.fn();
		const { container, rerender } = renderTable(
			<TimeEntriesTable
				entries={[open, locked]}
				timeZone={TZ}
				onChangeFor={onChangeFor}
				selection={{ selectedIds: new Set(), onChange }}
			/>,
		);
		const lockedBox = within(row(container, "b")).getByRole("checkbox");
		expect((lockedBox as HTMLInputElement).disabled).toBe(true);
		expect(lockedBox.getAttribute("title")).toBe(
			"Submitted. Withdraw to change.",
		);
		fireEvent.click(within(row(container, "a")).getByRole("checkbox"));
		expect(onChange).toHaveBeenLastCalledWith(new Set(["a"]));

		// Select all takes only what can change.
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: "Select all entries you can change",
			}),
		);
		expect(onChange).toHaveBeenLastCalledWith(new Set(["a"]));

		rerender(
			<QueryClientProvider client={new QueryClient()}>
				<TimeEntriesTable
					entries={[open, locked]}
					timeZone={TZ}
					onChangeFor={onChangeFor}
					selection={{ selectedIds: new Set(["a", "b"]), onChange }}
				/>
			</QueryClientProvider>,
		);
		const bar = screen.getByRole("toolbar", { name: "Selected time entries" });
		expect(within(bar).getByText("1 selected")).toBeTruthy();
		fireEvent.click(within(bar).getByRole("button", { name: /Change For/ }));
		expect(onChangeFor).toHaveBeenCalledWith([open]);
		fireEvent.click(within(bar).getByRole("button", { name: "Clear" }));
		expect(onChange).toHaveBeenLastCalledWith(new Set());
	});

	it("no selection boxes outside `mine`", () => {
		const { container } = renderTable(
			<TimeEntriesTable
				entries={[open]}
				mode="review"
				timeZone={TZ}
				selection={{ selectedIds: new Set(), onChange: vi.fn() }}
			/>,
		);
		expect(container.querySelector("input[type=checkbox]")).toBeNull();
	});

	it("folds Project, In and For into the task cell on a phone", () => {
		stubViewport(390);
		const { container } = renderTable(
			<TimeEntriesTable entries={[open]} timeZone={TZ} />,
		);
		const headers = Array.from(container.querySelectorAll("thead th")).map(
			(th) => th.textContent,
		);
		expect(headers).toEqual(["", "Task", "Dur", "Actions"]);
		const r = row(container, "a");
		expect(within(r).getByText("Acme Website")).toBeTruthy();
		expect(within(r).getByText("09:00")).toBeTruthy();
		expect(within(r).getByText("Prodigitality Services…")).toBeTruthy();
	});

	it("shows amounts only when asked, for cost viewers", () => {
		const { container, rerender } = renderTable(
			<TimeEntriesTable entries={[open]} timeZone={TZ} />,
		);
		expect(container.textContent).not.toContain("PHP");
		rerender(
			<QueryClientProvider client={new QueryClient()}>
				<TimeEntriesTable entries={[open]} timeZone={TZ} showAmounts />
			</QueryClientProvider>,
		);
		const amount = within(row(container, "a")).getByTestId("amount-lines");
		expect(amount.textContent).toBe("PHP 1,575.00");
		expect(amount.getAttribute("title")).toBe("Estimated. Final at approval.");
		rerender(
			<QueryClientProvider client={new QueryClient()}>
				<TimeEntriesTable
					entries={[{ ...open, cost: "hidden" }]}
					timeZone={TZ}
					showAmounts
				/>
			</QueryClientProvider>,
		);
		expect(container.textContent).not.toContain("PHP");
	});

	it("shows Paid on a row", () => {
		const { container } = renderTable(
			<TimeEntriesTable
				entries={[
					entry({
						payout_id: "po1",
						locked_reason: "paid",
						timesheet: sheet("approved"),
					}),
				]}
				timeZone={TZ}
			/>,
		);
		expect(within(row(container, "a")).getByText("Paid")).toBeTruthy();
	});

	it("renders the skeleton while loading and `empty` with no entries", () => {
		const { rerender } = renderTable(
			<TimeEntriesTable entries={[]} loading timeZone={TZ} />,
		);
		expect(screen.getByTestId("entries-skeleton")).toBeTruthy();
		rerender(
			<QueryClientProvider client={new QueryClient()}>
				<TimeEntriesTable
					entries={[]}
					timeZone={TZ}
					empty={<p>Nothing here</p>}
				/>
			</QueryClientProvider>,
		);
		expect(screen.getByText("Nothing here")).toBeTruthy();
	});
});
