/* @vitest-environment jsdom */

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

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));
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
import type {
	CommentRow,
	SegmentRow,
	TimeEntryView,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import { TimeEntryDetailModal } from "./TimeEntryDetailModal";

const TZ = "Asia/Manila";
const NOW = new Date("2026-10-06T04:00:00.000Z");
const ID = "8f0e2c1a-1111-4222-8333-944455556666";
const SHEET = "5a0e2c1a-1111-4222-8333-944455556666";
const ME = "u1";

function entry(over: Partial<TimeEntryView> = {}): TimeEntryView {
	return {
		id: ID,
		context_kind: "team",
		context_ref: "t1",
		context_label_snapshot: "Prodigitality Services Inc. Team",
		timesheet_id: SHEET,
		work_item: "task",
		started_at: "2026-10-01T01:00:00.000Z",
		ended_at: "2026-10-01T04:30:00.000Z",
		paused_at: null,
		duration_seconds: 3.5 * 3600,
		break_seconds: 900,
		break_minutes: 15,
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
		timesheet: {
			id: SHEET,
			status: "open",
			period_start: "2026-09-28",
			period_end: "2026-10-04",
			decision_kind: null,
			decided_by: null,
			decided_at: null,
			decision_note: null,
			scope_label_snapshot: "Prodigitality Services Inc. Team",
		},
		locked_reason: null,
		identity: "visible",
		member_user_id: ME,
		member_display_name_snapshot: "Maria Santos",
		member: { id: ME, display_name: "Maria Santos", avatar_url: null },
		member_label: null,
		content: "visible",
		task_id: "task-1",
		note: "Pairing with Leo",
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

const segments: SegmentRow[] = [
	{
		id: "g1",
		entry_id: ID,
		kind: "work",
		started_at: "2026-10-01T01:00:00.000Z",
		ended_at: "2026-10-01T02:00:00.000Z",
		created_at: "2026-10-01T01:00:00.000Z",
	},
	{
		id: "g2",
		entry_id: ID,
		kind: "break",
		started_at: "2026-10-01T02:00:00.000Z",
		ended_at: "2026-10-01T02:15:00.000Z",
		created_at: "2026-10-01T02:00:00.000Z",
	},
];

function comment(over: Partial<CommentRow> = {}): CommentRow {
	return {
		id: "c1",
		entry_id: ID,
		author_user_id: "u2",
		body: "Can you split Thursday?",
		created_at: "2026-10-02T03:00:00.000Z",
		updated_at: "2026-10-02T03:00:00.000Z",
		author: { id: "u2", display_name: "Ana Reyes", avatar_url: null },
		...over,
	};
}

function stubMatchMedia() {
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		writable: true,
		value: (query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		}),
	});
}

function renderModal(ui: ReactElement) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

function dialog() {
	return screen.getByRole("dialog");
}

/** The value next to a field label. */
function field(label: string): string {
	const dt = within(dialog())
		.getAllByText(label)
		.find((el) => el.tagName === "DT");
	if (!dt) throw new Error(`no field ${label}`);
	return dt.nextElementSibling?.textContent ?? "";
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
	vi.setSystemTime(NOW);
	stubMatchMedia();
	useAuthStore.setState({ user: { id: ME } as never });
	vi.spyOn(timeService, "getEntry").mockResolvedValue(entry());
	vi.spyOn(timeService, "listEntrySegments").mockResolvedValue(segments);
	vi.spyOn(timeService, "listEntryComments").mockResolvedValue([comment()]);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
	useAuthStore.setState({ user: null });
	for (const fn of Object.values(toast)) fn.mockReset();
});

describe("TimeEntryDetailModal", () => {
	it("shows the entry, its sheet, timeline and comments", async () => {
		renderModal(
			<TimeEntryDetailModal entryId={ID} onClose={vi.fn()} timeZone={TZ} />,
		);
		await screen.findByText("3:30");
		expect(screen.getByText("Thu Oct 1 · 09:00 – 12:30")).toBeTruthy();
		expect(
			screen.getByText(
				"Open · Prodigitality Services Inc. Team · Sep 28–Oct 4",
			),
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Open timesheet →" })
				.getAttribute("href"),
		).toBe(`/time/timesheets/${SHEET}`);
		expect(field("Project")).toBe("Acme Website");
		expect(field("Task")).toBe("Fix login bug");
		expect(field("Note")).toBe("Pairing with Leo");
		expect(field("Break")).toBe("15m");
		expect(field("Source")).toBe("Timer");
		expect(field("For")).toContain("Prodigitality Services…");
		// Own time: no Person row.
		expect(within(dialog()).queryByText("Person")).toBeNull();
		// Cost for a cost viewer (web): the estimate and the rate.
		expect(field("Estimated cost")).toBe("PHP 1,575.00 (final at approval)");
		expect(field("Rate")).toBe("PHP 450.00 / hour");

		await screen.findByText("Work and break timeline");
		expect(await screen.findByText("09:00 – 10:00")).toBeTruthy();
		expect(screen.getByText("10:00 – 10:15")).toBeTruthy();
		expect(screen.getByText("Ana Reyes")).toBeTruthy();
		expect(screen.getByText("Can you split Thursday?")).toBeTruthy();
	});

	it("shows the list's copy while the fresh one loads", () => {
		vi.spyOn(timeService, "getEntry").mockReturnValue(new Promise(() => {}));
		renderModal(
			<TimeEntryDetailModal
				entryId={ID}
				entry={entry()}
				onClose={vi.fn()}
				timeZone={TZ}
			/>,
		);
		expect(screen.getByText("3:30")).toBeTruthy();
	});

	it("an approved entry reads its amount at approval and the lock", async () => {
		vi.spyOn(timeService, "getEntry").mockResolvedValue(
			entry({
				payable_seconds: 12600,
				amount_snapshot: 1575,
				locked_reason: "frozen",
				timesheet: {
					...entry().timesheet!,
					status: "approved",
					decided_at: "2026-10-06T02:00:00.000Z",
				},
			}),
		);
		renderModal(
			<TimeEntryDetailModal
				entryId={ID}
				onClose={vi.fn()}
				timeZone={TZ}
				onEdit={vi.fn()}
				onDelete={vi.fn()}
			/>,
		);
		await screen.findByText("Approved time");
		expect(field("Approved time")).toBe("3:30");
		expect(field("Amount at approval")).toBe("PHP 1,575.00");
		expect(
			screen.getAllByText("Approved Oct 6. Ask to reopen to change.").length,
		).toBeGreaterThan(0);
		// Locked: no Edit or Delete.
		expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
	});

	it("shows the legacy markers here", async () => {
		vi.spyOn(timeService, "getEntry").mockResolvedValue(
			entry({
				legacy_status: "paid_outside",
				locked_reason: "paid",
				payable_seconds: 12600,
			}),
		);
		renderModal(
			<TimeEntryDetailModal entryId={ID} onClose={vi.fn()} timeZone={TZ} />,
		);
		expect(await screen.findByText("Paid outside Proyekto")).toBeTruthy();
		expect(
			screen.getAllByText(
				"This time was paid outside Proyekto, so it can't change.",
			).length,
		).toBeGreaterThan(0);

		cleanup();
		vi.spyOn(timeService, "getEntry").mockResolvedValue(
			entry({
				legacy_status: "rejected",
				locked_reason: "legacy",
				payable_seconds: 0,
			}),
		);
		renderModal(
			<TimeEntryDetailModal entryId={ID} onClose={vi.fn()} timeZone={TZ} />,
		);
		expect(await screen.findByText("Not approved (legacy)")).toBeTruthy();
		expect(field("Approved time")).toBe("0:00");
	});

	it("someone else's hidden, masked entry: no identity, no content", async () => {
		vi.spyOn(timeService, "getEntry").mockResolvedValue(
			entry({
				identity: "masked",
				member_user_id: null,
				member: null,
				member_display_name_snapshot: null,
				member_label: "Delivery team",
				content: "hidden",
				content_label: "A project you can't open",
				task: null,
				task_id: null,
				note: null,
				project: null,
				cost: "hidden",
				rate_snapshot: undefined,
				currency_snapshot: undefined,
				amount_snapshot: undefined,
				rate_type_snapshot: undefined,
			}),
		);
		vi.spyOn(timeService, "listEntryComments").mockResolvedValue([
			comment({ author_user_id: null, author: null, body: "Done." }),
		]);
		renderModal(
			<TimeEntryDetailModal
				entryId={ID}
				mode="review"
				onClose={vi.fn()}
				timeZone={TZ}
				onEdit={vi.fn()}
			/>,
		);
		await screen.findByText("Person");
		expect(field("Person")).toBe("Delivery team");
		expect(field("Project")).toBe("A project you can't open");
		expect(field("Kind")).toBe("Task");
		expect(within(dialog()).queryByText("Note")).toBeNull();
		expect(within(dialog()).queryByText("Rate")).toBeNull();
		expect(dialog().textContent).not.toContain("PHP");
		expect(await screen.findByText("Delivery team member")).toBeTruthy();
		// Review mode is already on the sheet.
		expect(screen.queryByText("Open timesheet →")).toBeNull();
		expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
	});

	it("a miss is the 404 card", async () => {
		vi.spyOn(timeService, "getEntry").mockRejectedValue(
			new TimeApiError({
				status: 404,
				code: "TIME_NOT_FOUND",
				message: "Not found",
			}),
		);
		renderModal(
			<TimeEntryDetailModal entryId={ID} onClose={vi.fn()} timeZone={TZ} />,
		);
		expect(
			await screen.findByText(
				"This time entry doesn't exist or you can't open it.",
			),
		).toBeTruthy();
	});

	it("a malformed id is a miss without a request", () => {
		const getEntry = vi.spyOn(timeService, "getEntry");
		renderModal(
			<TimeEntryDetailModal
				entryId="not-a-real-id"
				onClose={vi.fn()}
				timeZone={TZ}
			/>,
		);
		expect(
			screen.getByText("This time entry doesn't exist or you can't open it."),
		).toBeTruthy();
		expect(getEntry).not.toHaveBeenCalled();
	});

	it("a failed read offers Try again", async () => {
		const getEntry = vi
			.spyOn(timeService, "getEntry")
			.mockRejectedValueOnce(
				// A 4xx is an answer (no automatic retry), so the card shows.
				new TimeApiError({ status: 400, code: "HTTP_400", message: "" }),
			)
			.mockResolvedValueOnce(entry());
		renderModal(
			<TimeEntryDetailModal entryId={ID} onClose={vi.fn()} timeZone={TZ} />,
		);
		fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
		expect(await screen.findByText("3:30")).toBeTruthy();
		expect(getEntry).toHaveBeenCalledTimes(2);
	});

	it("posts a comment and refreshes the thread", async () => {
		const add = vi
			.spyOn(timeService, "addEntryComment")
			.mockResolvedValue(comment({ id: "c2", body: "Split it." }));
		const list = vi.spyOn(timeService, "listEntryComments");
		renderModal(
			<TimeEntryDetailModal entryId={ID} onClose={vi.fn()} timeZone={TZ} />,
		);
		const box = await screen.findByLabelText("Add a comment");
		const post = screen.getByRole("button", { name: "Post comment" });
		expect((post as HTMLButtonElement).disabled).toBe(true);
		fireEvent.change(box, { target: { value: "  Split it.  " } });
		fireEvent.click(post);
		await waitFor(() => expect(add).toHaveBeenCalledWith(ID, "Split it."));
		await waitFor(() =>
			expect(toast.success).toHaveBeenCalledWith("Comment added"),
		);
		expect((box as HTMLTextAreaElement).value).toBe("");
		await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(1));
	});

	it("a failed comment keeps the draft and says why", async () => {
		vi.spyOn(timeService, "addEntryComment").mockRejectedValue(
			new TimeApiError({ status: 0, code: "NETWORK_ERROR", message: "" }),
		);
		renderModal(
			<TimeEntryDetailModal entryId={ID} onClose={vi.fn()} timeZone={TZ} />,
		);
		const box = await screen.findByLabelText("Add a comment");
		fireEvent.change(box, { target: { value: "Hello" } });
		fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
		await waitFor(() => expect(toast.error).toHaveBeenCalled());
		expect(toast.error.mock.calls[0][0]).toMatch(/Proyekto couldn't reach/);
		expect((box as HTMLTextAreaElement).value).toBe("Hello");
	});

	it("offers Edit and Delete on your own open entry", async () => {
		const onEdit = vi.fn();
		const onDelete = vi.fn();
		renderModal(
			<TimeEntryDetailModal
				entryId={ID}
				onClose={vi.fn()}
				timeZone={TZ}
				onEdit={onEdit}
				onDelete={onDelete}
			/>,
		);
		fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
		expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: ID }));
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: ID }));
	});

	it("someone else's entry opened from /time: a Person row, no edits", async () => {
		vi.spyOn(timeService, "getEntry").mockResolvedValue(
			entry({
				member_user_id: "u9",
				member: { id: "u9", display_name: "Leo Cruz", avatar_url: null },
			}),
		);
		renderModal(
			<TimeEntryDetailModal
				entryId={ID}
				onClose={vi.fn()}
				timeZone={TZ}
				onEdit={vi.fn()}
			/>,
		);
		await screen.findByText("Person");
		expect(field("Person")).toBe("Leo Cruz");
		expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
		// Their sheet may not open for this viewer; the caller opts in.
		expect(screen.queryByText("Open timesheet →")).toBeNull();
	});

	it("says so when the thread can't load, and keeps the box", async () => {
		vi.spyOn(timeService, "listEntryComments").mockRejectedValue(
			new TimeApiError({ status: 403, code: "HTTP_403", message: "" }),
		);
		renderModal(
			<TimeEntryDetailModal entryId={ID} onClose={vi.fn()} timeZone={TZ} />,
		);
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.getByLabelText("Add a comment")).toBeTruthy();
	});

	it("a failed timeline read says so instead of the empty sentence", async () => {
		// A 4xx is not retried, so the failure shows at once.
		vi.spyOn(timeService, "listEntrySegments").mockRejectedValue(
			new TimeApiError({ status: 403, code: "HTTP_403", message: "" }),
		);
		renderModal(
			<TimeEntryDetailModal entryId={ID} onClose={vi.fn()} timeZone={TZ} />,
		);
		await screen.findByText("Work and break timeline");
		const alert = await screen.findByRole("alert");
		expect(alert.textContent?.trim()).toBeTruthy();
		expect(screen.queryByText(/No timeline for this entry/)).toBeNull();
	});

	it("the For chip's popover opens above the dialog at its default stacking", async () => {
		vi.spyOn(timeService, "getProjectPolicy").mockReturnValue(
			new Promise(() => {}),
		);
		renderModal(
			<TimeEntryDetailModal entryId={ID} onClose={vi.fn()} timeZone={TZ} />,
		);
		await screen.findByText("3:30");
		const forCell = within(dialog())
			.getAllByText("For")
			.find((el) => el.tagName === "DT")?.nextElementSibling as HTMLElement;
		fireEvent.click(within(forCell).getByRole("button"));
		const popover = await screen.findByRole("dialog", {
			name: "Who approves this time",
		});
		// AppDialog sits at 1200 by default; AnchoredPopover's own 1100 is under it.
		expect(popover.style.zIndex).toBe("1210");
	});

	it("flags a long entry", async () => {
		vi.spyOn(timeService, "getEntry").mockResolvedValue(
			entry({ flagged_reason: "auto_stopped_24h", duration_seconds: 86400 }),
		);
		renderModal(
			<TimeEntryDetailModal entryId={ID} onClose={vi.fn()} timeZone={TZ} />,
		);
		expect(
			await screen.findByText(
				"Stopped automatically after 24 hours. Check the end time.",
			),
		).toBeTruthy();
	});

	it("'Comment' focuses the comment box", async () => {
		renderModal(
			<TimeEntryDetailModal
				entryId={ID}
				onClose={vi.fn()}
				timeZone={TZ}
				focus="comments"
			/>,
		);
		const box = await screen.findByLabelText("Add a comment");
		await waitFor(() => expect(document.activeElement).toBe(box));
	});

	it("is closed without an id", () => {
		renderModal(
			<TimeEntryDetailModal entryId={null} onClose={vi.fn()} timeZone={TZ} />,
		);
		expect(screen.queryByRole("dialog")).toBeNull();
	});
});
