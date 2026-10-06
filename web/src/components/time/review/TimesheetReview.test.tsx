/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
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
const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));
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

import { TimeApiError, timeService } from "@/services/time.service";
import type { TimesheetDetail, TimesheetRow } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import {
	DECIDER,
	deciderDetail,
	ENGAGEMENT_ID,
	entry,
	event,
	MEMBER,
	memberDetail,
	NOW,
	rules,
	SHEET_ID,
	sheet,
	TZ,
} from "./__fixtures__/reviewFixtures";
import { TimesheetReview } from "./TimesheetReview";

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

let client: QueryClient;

function renderWith(ui: ReactElement) {
	client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>,
	);
}

function review(props: Partial<Parameters<typeof TimesheetReview>[0]> = {}) {
	return (
		<TimesheetReview
			timesheetId={SHEET_ID}
			now={NOW}
			userTimezone={TZ}
			{...props}
		/>
	);
}

function asRow(detail: TimesheetDetail, over: Partial<TimesheetRow> = {}) {
	const { entry_count, running_count, logged_seconds, ...rest } = detail.sheet;
	void entry_count;
	void running_count;
	void logged_seconds;
	return { ...rest, ...over } as TimesheetRow;
}

function serve(detail: TimesheetDetail) {
	return vi.spyOn(timeService, "getTimesheet").mockResolvedValue(detail);
}

beforeEach(() => {
	stubViewport(1280);
	useAuthStore.setState({ user: { id: DECIDER } as never });
	vi.spyOn(timeService, "getEntry").mockImplementation(async (id) => {
		const found = deciderDetail().entries.find((e) => e.id === id);
		if (!found)
			throw new TimeApiError({ status: 404, code: "HTTP_404", message: "" });
		return found;
	});
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

describe("TimesheetReview: misses", () => {
	it("a non-uuid id is the 404 card without a request", () => {
		const get = vi.spyOn(timeService, "getTimesheet");
		renderWith(review({ timesheetId: "not-a-sheet" }));
		expect(
			screen.getByText("This timesheet doesn't exist or you can't open it."),
		).toBeTruthy();
		expect(get).not.toHaveBeenCalled();
		expect(
			screen.getByRole("link", { name: /Time/ }).getAttribute("href"),
		).toBe("/time");
	});

	it("a 404 is the same card", async () => {
		vi.spyOn(timeService, "getTimesheet").mockRejectedValue(
			new TimeApiError({ status: 404, code: "HTTP_404", message: "Not Found" }),
		);
		renderWith(review());
		expect(
			await screen.findByText(
				"This timesheet doesn't exist or you can't open it.",
			),
		).toBeTruthy();
	});

	it("a 404 on a refetch replaces the cached copy; another failure keeps it", async () => {
		// Access revoked, or another account in this tab: the copy on screen
		// must not outlive the server's 404.
		const get = serve(deciderDetail());
		renderWith(review());
		expect(await screen.findByText("Maria Santos")).toBeTruthy();

		get.mockRejectedValue(
			new TimeApiError({ status: 400, code: "HTTP_400", message: "" }),
		);
		await act(() => client.refetchQueries({ queryKey: ["time", "timesheet"] }));
		expect(screen.getByText("Maria Santos")).toBeTruthy();

		get.mockRejectedValue(
			new TimeApiError({ status: 404, code: "HTTP_404", message: "" }),
		);
		await act(() => client.refetchQueries({ queryKey: ["time", "timesheet"] }));
		expect(
			await screen.findByText(
				"This timesheet doesn't exist or you can't open it.",
			),
		).toBeTruthy();
		expect(screen.queryByText("Maria Santos")).toBeNull();
		expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
	});

	it("any other failure offers Try again", async () => {
		const get = vi
			.spyOn(timeService, "getTimesheet")
			.mockRejectedValueOnce(
				new TimeApiError({ status: 400, code: "HTTP_400", message: "" }),
			)
			.mockResolvedValue(deciderDetail());
		renderWith(review());
		const retry = await screen.findByRole("button", { name: "Try again" });
		expect(screen.getByRole("alert").textContent).toMatch(/Proyekto couldn't/);
		fireEvent.click(retry);
		expect(await screen.findByText("Maria Santos")).toBeTruthy();
		expect(get).toHaveBeenCalledTimes(2);
	});
});

describe("TimesheetReview: a decider", () => {
	it("V11: the hirer reviewing an agreement sheet reads 'Waiting for you', not her own name", async () => {
		serve(
			deciderDetail({
				sheet: sheet({
					scope_kind: "engagement",
					// The worker's counterparty, which is the decider herself.
					scope_label_snapshot: "Ana Reyes",
					engagement_id: ENGAGEMENT_ID,
					team_id: null,
					approver_scope: "hirer",
				}),
			}),
		);
		renderWith(review());
		const status = await screen.findByTestId("review-status");
		expect(status.textContent).toBe("Submitted · Waiting for you");
		expect(status.textContent).not.toMatch(/Ana Reyes/);
	});

	it("shows the header, the rules, the grid with merged projects and the history", async () => {
		serve(deciderDetail());
		renderWith(review());
		const heading = await screen.findByRole("heading", { level: 1 });
		expect(heading.textContent).toBe(
			"Maria Santos · Prodigitality Services Inc. Team · Sep 21 – 27, 2026 (Asia/Manila)",
		);
		expect(screen.getByTestId("review-status").textContent).toMatch(
			/^Submitted · Waiting on/,
		);
		expect(screen.getByTestId("review-facts").textContent).toBe(
			"Submitted Sep 28, 10:14 · 18:00 · 4 projects",
		);
		expect(screen.getByTestId("review-rules").textContent).toBe(
			"Rules at submit: weekly · team owners & admins approve · manual time up to 7 days back",
		);
		const grid = screen.getByTestId("review-grid");
		expect(within(grid).getByText("Projects you can't open")).toBeTruthy();
		expect(within(grid).getByTestId("review-grid-total").textContent).toBe(
			"18:00",
		);
		// Thu is over 8h: flagged on the grid and in the flags line.
		expect(
			within(grid).getByRole("button", {
				name: "Total, Thu Sep 24: 11:40 (over 8 hours)",
			}),
		).toBeTruthy();
		expect(screen.getByTestId("review-flags").textContent).toContain(
			"Thu is 11h 40m · 1 entry added later",
		);
		expect(screen.getByTestId("review-history").textContent).toContain(
			"Submitted",
		);
		// Hidden content never leaks a title (L21).
		expect(
			screen.getAllByText("A project you can't open").length,
		).toBeGreaterThan(0);
		expect(
			screen.getByRole("group", { name: "Timesheet actions" }).textContent,
		).toBe("Return…Approve…");
	});

	it("a cell filters the entries to that project and day, and again clears it", async () => {
		serve(deciderDetail());
		const { container } = renderWith(review());
		const cell = await screen.findByRole("button", {
			name: "Acme Website, Thu Sep 24: 8:10 (over 8 hours)",
		});
		fireEvent.click(cell);
		expect(cell.getAttribute("aria-pressed")).toBe("true");
		expect(screen.getByTestId("review-filter").textContent).toContain(
			"Showing Acme Website · Thu Sep 24",
		);
		expect(
			[...container.querySelectorAll("[data-entry-id]")].map((el) =>
				el.getAttribute("data-entry-id"),
			),
		).toEqual(["e2"]);
		fireEvent.click(cell);
		expect(screen.queryByTestId("review-filter")).toBeNull();
		expect(container.querySelectorAll("[data-entry-id]").length).toBe(6);
	});

	it("the merged row filters to the merged entries", async () => {
		serve(deciderDetail());
		const { container } = renderWith(review());
		fireEvent.click(
			await screen.findByRole("button", {
				name: "Projects you can't open, total: 1:20",
			}),
		);
		expect(
			[...container.querySelectorAll("[data-entry-id]")]
				.map((el) => el.getAttribute("data-entry-id"))
				.sort(),
		).toEqual(["e4", "e5"]);
	});

	it("Show flagged keeps the flagged entries", async () => {
		serve(deciderDetail());
		const { container } = renderWith(review());
		fireEvent.click(
			await screen.findByRole("button", { name: "Show flagged" }),
		);
		expect(
			[...container.querySelectorAll("[data-entry-id]")].map((el) =>
				el.getAttribute("data-entry-id"),
			),
		).toEqual(["e6"]);
		fireEvent.click(
			within(screen.getByTestId("review-flags")).getByRole("button", {
				name: "Show all entries",
			}),
		);
		expect(container.querySelectorAll("[data-entry-id]").length).toBe(6);
	});

	it("Return… asks what Maria should change", async () => {
		serve(deciderDetail());
		const ret = vi
			.spyOn(timeService, "returnTimesheet")
			.mockResolvedValue(
				asRow(deciderDetail(), { status: "returned", revision: 5 }),
			);
		renderWith(review());
		fireEvent.click(await screen.findByRole("button", { name: "Return…" }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.change(
			within(dialog).getByPlaceholderText("What should Maria change?"),
			{ target: { value: "Split Thursday" } },
		);
		fireEvent.click(
			within(dialog).getByRole("button", { name: "Return to Maria" }),
		);
		await waitFor(() =>
			expect(ret).toHaveBeenCalledWith(SHEET_ID, {
				expected_revision: 4,
				note: "Split Thursday",
			}),
		);
		await waitFor(() =>
			expect(toast.success).toHaveBeenCalledWith("Returned to Maria"),
		);
		// Our own change is not "changed while you were looking".
		expect(screen.queryByTestId("stale-revision-banner")).toBeNull();
	});

	it("Approve… freezes the sheet", async () => {
		serve(deciderDetail());
		const approve = vi.spyOn(timeService, "approveTimesheet").mockResolvedValue(
			asRow(deciderDetail(), {
				status: "approved",
				revision: 5,
				payable_seconds: 18 * 3600,
			}),
		);
		renderWith(review());
		fireEvent.click(await screen.findByRole("button", { name: "Approve…" }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
		await waitFor(() =>
			expect(approve).toHaveBeenCalledWith(SHEET_ID, { expected_revision: 4 }),
		);
		await waitFor(() =>
			expect(toast.success).toHaveBeenCalledWith("Approved · 18:00 frozen"),
		);
	});

	it("over a cap that cuts pay: the panel's tick carries into the approval", async () => {
		serve(
			deciderDetail({
				sheet: sheet({
					scope_kind: "engagement",
					scope_label_snapshot: "Acme Corp",
					engagement_id: ENGAGEMENT_ID,
					approver_scope: "hirer",
				}),
				rules: rules({
					weekly_limit_minutes: 960,
					sources: { weekly_limit_minutes: "contract" },
				}),
				freeze_preview: {
					timesheet_id: SHEET_ID,
					over_cap_seconds: 2 * 3600,
					entries: [
						{
							entry_id: "e1",
							rounded_seconds: 18 * 3600,
							payable_seconds: 16 * 3600,
							over_cap_seconds: 2 * 3600,
						},
					],
				},
			}),
		);
		const approve = vi
			.spyOn(timeService, "approveTimesheet")
			.mockResolvedValue(asRow(deciderDetail(), { status: "approved" }));
		renderWith(review());
		const panel = await screen.findByTestId("review-over-limit");
		expect(panel.textContent).toContain(
			"Weekly limit 16h in the agreement with Acme Corp · 18:00 logged · 2:00 over",
		);
		expect(panel.textContent).toContain(
			"Left unticked, 16:00 is approved for payment; the extra time stays on record.",
		);
		// No separate indicator line when the panel shows the agreement's limit.
		expect(screen.queryByTestId("review-weekly-limit")).toBeNull();
		fireEvent.click(
			within(panel).getByRole("checkbox", {
				name: "Approve the 2h over the limit",
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: "Approve…" }));
		const dialog = await screen.findByRole("dialog");
		const box = within(dialog).getByRole("checkbox") as HTMLInputElement;
		expect(box.checked).toBe(true);
		fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
		await waitFor(() =>
			expect(approve).toHaveBeenCalledWith(SHEET_ID, {
				expected_revision: 4,
				approve_overtime: true,
			}),
		);
		// Agreement rules line with View terms (web).
		expect(
			screen.getByRole("link", { name: "View terms →" }).getAttribute("href"),
		).toBe(`/engagements/${ENGAGEMENT_ID}`);
	});

	it("a policy limit is an indicator line only (D65)", async () => {
		serve(
			deciderDetail({
				rules: rules({
					weekly_limit_minutes: 960,
					sources: { weekly_limit_minutes: "team" },
				}),
			}),
		);
		renderWith(review());
		const line = await screen.findByTestId("review-weekly-limit");
		expect(line.textContent).toBe(
			"Weekly limit 16h (Prodigitality Services Inc. Team) · 18:00 logged · 2:00 over",
		);
		expect(line.textContent).not.toMatch(/cut|unpaid|not paid/i);
		expect(screen.queryByTestId("review-over-limit")).toBeNull();
	});

	it("with rounding, the panel's head agrees with its box (rounding, then the cap)", async () => {
		serve(
			deciderDetail({
				sheet: sheet({
					scope_kind: "engagement",
					scope_label_snapshot: "Acme Corp",
					engagement_id: ENGAGEMENT_ID,
					approver_scope: "hirer",
				}),
				rules: rules({
					rounding_minutes: 15,
					weekly_limit_minutes: 960,
					sources: { weekly_limit_minutes: "contract" },
				}),
				// 18:00 logged; rounded per entry to 18:30, so 2:30 is over 16h.
				freeze_preview: {
					timesheet_id: SHEET_ID,
					over_cap_seconds: 2.5 * 3600,
					entries: [
						{
							entry_id: "e1",
							rounded_seconds: 16 * 3600,
							payable_seconds: 16 * 3600,
							over_cap_seconds: 0,
						},
						{
							entry_id: "e2",
							rounded_seconds: 2.5 * 3600,
							payable_seconds: 0,
							over_cap_seconds: 2.5 * 3600,
						},
					],
				},
			}),
		);
		renderWith(review());
		const panel = await screen.findByTestId("review-over-limit");
		expect(panel.textContent).toContain(
			"Weekly limit 16h in the agreement with Acme Corp · 18:30 logged · 2:30 over",
		);
		expect(
			within(panel).getByRole("checkbox", {
				name: "Approve the 2h 30m over the limit",
			}),
		).toBeTruthy();
		expect(panel.textContent).toContain(
			"Left unticked, 16:00 is approved for payment; the extra time stays on record.",
		);
	});

	it("shows the estimated cost to a cost viewer only", async () => {
		serve(
			deciderDetail({
				freeze_preview: {
					timesheet_id: SHEET_ID,
					entries: [],
					over_cap_seconds: 0,
					amounts_by_currency: { USD: 120, PHP: 6885 },
				},
			}),
		);
		renderWith(review());
		expect((await screen.findByTestId("review-cost")).textContent).toBe(
			"Estimated cost: PHP 6,885.00 · USD 120.00 (final at approval)",
		);
	});

	it("says when the sheet changed under the reader and holds the buttons", async () => {
		const get = serve(deciderDetail());
		renderWith(review());
		await screen.findByRole("button", { name: "Approve…" });
		const changed = deciderDetail({
			sheet: sheet({ status: "open", revision: 5, submitted_at: null }),
			events: [
				event(),
				event({
					id: 2,
					event: "withdrawn",
					from_status: "submitted",
					to_status: "open",
					revision: 5,
					created_at: "2026-10-06T03:00:00.000Z",
				}),
			],
			viewer: { is_member: false, can_decide: true, actions: [] },
		});
		get.mockResolvedValue(changed);
		act(() => {
			client.setQueryData(["time", "timesheet", SHEET_ID], {
				...deciderDetail(),
				sheet: sheet({ revision: 5 }),
				events: changed.events,
			});
		});
		const banner = await screen.findByTestId("stale-revision-banner");
		expect(banner.textContent).toContain(
			"Maria changed this timesheet while you were looking.",
		);
		expect(
			(screen.getByRole("button", { name: "Approve…" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		fireEvent.click(
			within(banner).getByRole("button", { name: "Review the latest" }),
		);
		await waitFor(() =>
			expect(screen.queryByTestId("stale-revision-banner")).toBeNull(),
		);
		expect(screen.getByTestId("review-status").textContent).toMatch(/^Open/);
		expect(screen.queryByRole("button", { name: "Approve…" })).toBeNull();
	});

	it("a co-decider's change reads 'This timesheet changed…'", async () => {
		serve(deciderDetail());
		renderWith(review());
		await screen.findByRole("button", { name: "Approve…" });
		act(() => {
			client.setQueryData(["time", "timesheet", SHEET_ID], {
				...deciderDetail(),
				sheet: sheet({ revision: 5 }),
				events: [
					event(),
					event({
						id: 2,
						actor_user_id: "66666666-6666-4666-8666-666666666666",
						event: "returned",
						to_status: "returned",
						revision: 5,
						created_at: "2026-10-06T03:00:00.000Z",
					}),
				],
			});
		});
		expect(
			(await screen.findByTestId("stale-revision-banner")).textContent,
		).toContain("This timesheet changed while you were looking.");
	});

	it("a row opens the entry through the route", async () => {
		serve(deciderDetail());
		const onOpenEntry = vi.fn();
		const { container } = renderWith(review({ onOpenEntry }));
		await screen.findByTestId("review-grid");
		const row = container.querySelector<HTMLElement>('[data-entry-id="e2"]');
		fireEvent.click(row as HTMLElement);
		expect(onOpenEntry).toHaveBeenCalledWith("e2");
	});

	it("?entry= opens the entry detail over the screen", async () => {
		const id = "55555555-5555-4555-8555-555555555555";
		const one = entry({ id });
		serve(deciderDetail({ entries: [one] }));
		const getEntry = vi.spyOn(timeService, "getEntry").mockResolvedValue(one);
		const onCloseEntry = vi.fn();
		renderWith(review({ entryId: id, onOpenEntry: vi.fn(), onCloseEntry }));
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByText("Time entry")).toBeTruthy();
		await waitFor(() => expect(getEntry).toHaveBeenCalledWith(id));
		expect(within(dialog).getAllByText("Fix login bug").length).toBeGreaterThan(
			0,
		);
	});
});

describe("TimesheetReview: the submitter", () => {
	beforeEach(() => useAuthStore.setState({ user: { id: MEMBER } as never }));

	it("withdraws a submitted sheet, with no decision buttons", async () => {
		serve(memberDetail());
		const withdraw = vi
			.spyOn(timeService, "withdrawTimesheet")
			.mockResolvedValue(
				asRow(memberDetail(), { status: "open", revision: 5 }),
			);
		renderWith(review());
		expect((await screen.findByTestId("review-status")).textContent).toBe(
			"Submitted · Waiting on Prodigitality Services Inc. Team's owners and admins",
		);
		expect(screen.queryByRole("button", { name: "Approve…" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
		await waitFor(() =>
			expect(withdraw).toHaveBeenCalledWith(SHEET_ID, {
				expected_revision: 4,
			}),
		);
		await waitFor(() =>
			expect(toast.success).toHaveBeenCalledWith(
				"Withdrawn. You can edit again.",
			),
		);
	});

	it("an open sheet says where it goes and links back to Time", async () => {
		serve(
			memberDetail({
				sheet: sheet({ status: "open", submitted_at: null }),
				rules: null,
				viewer: { is_member: true, can_decide: false, actions: ["submit"] },
				routing_preview: {
					approver_scope: "team",
					cost_money: false,
					deciders: [{ id: DECIDER, display_name: "Ana Reyes" }],
				},
			}),
		);
		renderWith(review());
		expect((await screen.findByTestId("review-goes-to")).textContent).toBe(
			"Goes to Prodigitality Services Inc. Team's owners and admins",
		);
		expect(
			screen.getByRole("link", { name: "Open in Time →" }).getAttribute("href"),
		).toBe("/time");
		expect(screen.getByRole("button", { name: "Submit" })).toBeTruthy();
	});

	it("their open self-routed sheet sends itself on the policy's reminder day, as the /time card says (D85)", async () => {
		serve(
			memberDetail({
				sheet: sheet({
					status: "open",
					submitted_at: null,
					approver_scope: "self",
					reminder_days: 3,
				}),
				rules: null,
				viewer: { is_member: true, can_decide: false, actions: ["submit"] },
				routing_preview: {
					approver_scope: "self",
					cost_money: false,
					deciders: [],
				},
			}),
		);
		renderWith(review());
		// period_end Sep 27 + 3 days, not the default of 1 (Sep 28).
		expect((await screen.findByTestId("review-status")).textContent).toBe(
			"Open · sends itself Sep 30",
		);
	});

	it("their open agreement sheet names the agreement and where it goes", async () => {
		serve(
			memberDetail({
				sheet: sheet({
					status: "open",
					submitted_at: null,
					scope_kind: "engagement",
					scope_label_snapshot: "Acme Corp",
					engagement_id: ENGAGEMENT_ID,
					team_id: null,
					approver_scope: "hirer",
				}),
				rules: null,
				viewer: { is_member: true, can_decide: false, actions: ["submit"] },
				routing_preview: {
					approver_scope: "hirer",
					cost_money: false,
					deciders: [{ id: DECIDER, display_name: "Ana Reyes" }],
				},
			}),
		);
		renderWith(review());
		expect((await screen.findByTestId("review-rules")).textContent).toBe(
			"Rules from your agreement with Acme Corp · View terms →",
		);
		expect(screen.getByTestId("review-goes-to").textContent).toBe(
			"Goes to Ana Reyes",
		);
	});

	it("an empty open sheet says it has no time once", async () => {
		serve(
			memberDetail({
				sheet: sheet({ status: "open", submitted_at: null }),
				entries: [],
				rules: null,
				viewer: { is_member: true, can_decide: false, actions: [] },
			}),
		);
		renderWith(review());
		await screen.findByTestId("timesheet-review");
		expect(screen.getAllByText("No time on this timesheet yet.")).toHaveLength(
			1,
		);
		// The way back to add time stays.
		expect(screen.getByRole("link", { name: "Open in Time →" })).toBeTruthy();
	});

	it("reopens their own self-approved sheet", async () => {
		serve(
			memberDetail({
				sheet: sheet({
					status: "approved",
					approver_scope: "self",
					decision_kind: "self",
				}),
				viewer: { is_member: true, can_decide: false, actions: ["reopen"] },
			}),
		);
		const reopen = vi
			.spyOn(timeService, "reopenTimesheet")
			.mockResolvedValue(
				asRow(memberDetail(), { status: "open", revision: 6 }),
			);
		renderWith(review());
		expect((await screen.findByTestId("review-status")).textContent).toBe(
			"Approved · Self-approved",
		);
		fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Reopen" }));
		await waitFor(() =>
			expect(reopen).toHaveBeenCalledWith(SHEET_ID, { expected_revision: 4 }),
		);
		await waitFor(() =>
			expect(toast.success).toHaveBeenCalledWith(
				"Reopened. You can edit again.",
			),
		);
	});
});

describe("TimesheetReview: phones", () => {
	it("stacks day cards and keeps Return and Approve in a sticky bar", async () => {
		stubViewport(390);
		serve(deciderDetail());
		renderWith(review());
		const cards = await screen.findByTestId("review-day-cards");
		expect(screen.queryByTestId("review-grid")).toBeNull();
		expect(within(cards).getByText("Thu Sep 24")).toBeTruthy();
		expect(within(cards).getByTestId("review-cards-total").textContent).toBe(
			"18:00",
		);
		const bar = screen.getByTestId("review-action-bar");
		expect(bar.className).toContain("sticky");
		expect(bar.className).toContain("bottom-0");
		expect(within(bar).getByRole("button", { name: "Return…" })).toBeTruthy();
		expect(within(bar).getByRole("button", { name: "Approve…" })).toBeTruthy();
		// One set of buttons only (none in the header on phones).
		expect(screen.getAllByRole("button", { name: "Approve…" })).toHaveLength(1);
		fireEvent.click(
			within(cards).getByRole("button", {
				name: "Internal ops, Thu Sep 24: 3:30",
			}),
		);
		expect(screen.getByTestId("review-filter").textContent).toContain(
			"Internal ops · Thu Sep 24",
		);
	});
});
