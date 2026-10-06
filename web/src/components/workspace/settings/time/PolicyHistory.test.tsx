/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import { invalidateTime } from "@/queries/time";
import { TimeApiError, timeService } from "@/services/time.service";
import type { Paged, PolicyHistoryRow } from "@/services/time.types";
import {
	historyChanges,
	historyFieldLabel,
	historyKind,
	historyLine,
	historyValue,
	POLICY_HISTORY_COPY,
	POLICY_HISTORY_PAGE_SIZE,
	PolicyHistory,
	policyHistoryFeedKey,
} from "./PolicyHistory";

const NOW = new Date("2026-10-06T03:00:00.000Z");
const TZ = "Asia/Manila";
const ANA = { id: "u1", display_name: "Ana Reyes" };

function row(over: Partial<PolicyHistoryRow> = {}): PolicyHistoryRow {
	return {
		id: 1,
		created_at: "2026-10-02T02:00:00.000Z",
		actor: ANA,
		changes: { period_kind: ["weekly", "semi_monthly"] },
		scope: "workspace",
		team_id: null,
		team_name: null,
		kind: "changed",
		...over,
	};
}

function page(
	items: PolicyHistoryRow[],
	over: Partial<Paged<PolicyHistoryRow>> = {},
): Paged<PolicyHistoryRow> {
	return {
		items,
		total: items.length,
		page: 1,
		limit: POLICY_HISTORY_PAGE_SIZE,
		...over,
	};
}

const line = (r: PolicyHistoryRow) =>
	historyLine(r, { now: NOW, userTimezone: TZ, native: false });

let client: QueryClient;

beforeEach(() => {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
	cleanup();
	client.clear();
	vi.restoreAllMocks();
});

function renderHistory(enabled = true) {
	return render(
		<QueryClientProvider client={client}>
			<PolicyHistory
				workspaceId="w1"
				enabled={enabled}
				now={NOW}
				userTimezone={TZ}
			/>
		</QueryClientProvider>,
	);
}

describe("history lines", () => {
	it("reads a change the way ux.md writes it", () => {
		expect(line(row())).toBe(
			"Changed by Ana Reyes, Oct 2: period weekly → twice a month",
		);
	});

	it("reads a confirmation as Confirmed (no changes) (D81)", () => {
		expect(line(row({ kind: "confirmed", changes: {} }))).toBe(
			"Confirmed (no changes) by Ana Reyes, Oct 2",
		);
	});

	it("reads a system write without an actor", () => {
		expect(
			line(
				row({
					actor: null,
					kind: "created",
					changes: {
						timezone: [null, "Asia/Manila"],
						period_kind: [null, "weekly"],
						week_start: [null, 1],
						rounding_minutes: [null, 0],
						tracking_enabled: [null, true],
					},
				}),
			),
		).toBe(
			"Set up on Oct 2: time on workspace projects on; period weekly; week start Monday; timezone Asia/Manila; rounding none",
		);
	});

	it("names the team on a team override row; a null there means inherit", () => {
		expect(
			line(
				row({
					scope: "team",
					team_id: "t1",
					team_name: "Design",
					changes: {
						rounding_minutes: [null, 15],
						approver_scope: [null, "team"],
					},
				}),
			),
		).toBe(
			"Changed by Ana Reyes, Oct 2 · Design: approvers workspace policy → this team's owners and admins; rounding workspace policy → 15 min",
		);
		expect(
			line(
				row({
					scope: "team",
					team_id: "t1",
					team_name: "Design",
					kind: "deleted",
					changes: { rounding_minutes: [15, null] },
				}),
			),
		).toBe("Team rules removed by Ana Reyes, Oct 2 · Design");
		expect(
			line(
				row({
					scope: "team",
					team_id: "t1",
					team_name: "Design",
					kind: "created",
					changes: { rounding_minutes: [null, 15], period_kind: [null, null] },
				}),
			),
		).toBe("Team rules added by Ana Reyes, Oct 2 · Design: rounding 15 min");
	});

	it("formats each field in plain words", () => {
		expect(historyValue("retroactive_days", null)).toBe("no limit");
		expect(historyValue("retroactive_days", 7)).toBe("up to 7 days back");
		expect(historyValue("weekly_limit_minutes", 2400)).toBe("40h");
		expect(historyValue("weekly_limit_minutes", null)).toBe("none");
		expect(historyValue("approval_required", false)).toBe("not required");
		expect(historyValue("allow_manual_entries", true)).toBe("allowed");
		expect(historyValue("reminder_days", 2)).toBe("2 days");
		expect(historyValue("hidden_presets", ["admin", "other"])).toBe(
			"Admin, Other",
		);
		expect(historyValue("hidden_presets", [])).toBe("none");
		expect(historyValue("period_anchor", "2026-10-05")).toBe("Oct 5");
		expect(historyValue("anything", null, "team")).toBe("workspace policy");
		expect(historyFieldLabel("some_new_field")).toBe("some new field");
		expect(
			historyChanges(
				row({
					changes: {
						reminder_days: [1, 3],
						allow_manual_entries: [true, false],
					},
				}),
			),
		).toBe("manual time allowed → off; reminder 1 day → 3 days");
	});

	it("works out the kind when the server leaves it out", () => {
		expect(historyKind(row({ kind: undefined, changes: {} }))).toBe(
			"confirmed",
		);
		expect(
			historyKind(
				row({ kind: undefined, changes: { rounding_minutes: [null, 5] } }),
			),
		).toBe("created");
		expect(
			historyKind(
				row({ kind: undefined, changes: { rounding_minutes: [5, null] } }),
			),
		).toBe("deleted");
		expect(
			historyKind(
				row({ kind: undefined, changes: { rounding_minutes: [5, 10] } }),
			),
		).toBe("changed");
	});

	it("an actor with no name reads as someone, and another year shows its year", () => {
		expect(
			line(
				row({
					actor: { id: "u9", display_name: null },
					created_at: "2025-12-01T02:00:00.000Z",
				}),
			),
		).toBe("Changed by someone, Dec 1, 2025: period weekly → twice a month");
	});
});

describe("PolicyHistory", () => {
	it("shows the latest change, then the rest on Show all, then more pages", async () => {
		const first = Array.from({ length: POLICY_HISTORY_PAGE_SIZE }, (_, i) =>
			row({
				id: i + 1,
				changes: { reminder_days: [i + 1, i + 2] },
			}),
		);
		const second = [row({ id: 99, kind: "confirmed", changes: {} })];
		const get = vi
			.spyOn(timeService, "getWorkspacePolicyHistory")
			.mockImplementation(async (_id, query) =>
				query?.page === 2
					? page(second, { page: 2, total: 21 })
					: page(first, { total: 21 }),
			);
		renderHistory();
		const rows = await screen.findAllByTestId("policy-history-row");
		expect(rows).toHaveLength(1);
		expect(rows[0]?.textContent).toBe(
			"Changed by Ana Reyes, Oct 2: reminder 1 day → 2 days",
		);
		expect(get).toHaveBeenCalledWith("w1", {
			page: 1,
			limit: POLICY_HISTORY_PAGE_SIZE,
		});

		const toggle = screen.getByRole("button", {
			name: POLICY_HISTORY_COPY.showAll,
		});
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		const list = screen.getByRole("list", {
			name: POLICY_HISTORY_COPY.listLabel,
		});
		expect(toggle.getAttribute("aria-controls")).toBe(list.id);
		fireEvent.click(toggle);
		expect(screen.getAllByTestId("policy-history-row")).toHaveLength(20);
		expect(
			screen
				.getByRole("button", { name: POLICY_HISTORY_COPY.showLess })
				.getAttribute("aria-expanded"),
		).toBe("true");

		fireEvent.click(
			screen.getByRole("button", { name: POLICY_HISTORY_COPY.showMore }),
		);
		await waitFor(() =>
			expect(screen.getAllByTestId("policy-history-row")).toHaveLength(21),
		);
		expect(get).toHaveBeenCalledWith("w1", {
			page: 2,
			limit: POLICY_HISTORY_PAGE_SIZE,
		});
		expect(
			screen.getByText("Confirmed (no changes) by Ana Reyes, Oct 2"),
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: POLICY_HISTORY_COPY.showMore }),
		).toBeNull();
	});

	it("has no Show all with a single row, and says when there is nothing", async () => {
		vi.spyOn(timeService, "getWorkspacePolicyHistory").mockResolvedValue(
			page([row()]),
		);
		renderHistory();
		await screen.findByTestId("policy-history-row");
		expect(
			screen.queryByRole("button", { name: POLICY_HISTORY_COPY.showAll }),
		).toBeNull();
		cleanup();
		client.clear();
		vi.spyOn(timeService, "getWorkspacePolicyHistory").mockResolvedValue(
			page([]),
		);
		renderHistory();
		expect(await screen.findByText(POLICY_HISTORY_COPY.empty)).toBeTruthy();
	});

	it("renders nothing for members: no request, and a 404 hides it", async () => {
		const get = vi
			.spyOn(timeService, "getWorkspacePolicyHistory")
			.mockRejectedValue(
				new TimeApiError({ status: 404, code: "HTTP_404", message: "" }),
			);
		const { container } = renderHistory(false);
		expect(container.innerHTML).toBe("");
		expect(get).not.toHaveBeenCalled();
		cleanup();
		const shown = renderHistory(true);
		await waitFor(() => expect(get).toHaveBeenCalled());
		await waitFor(() => expect(shown.container.innerHTML).toBe(""));
	});

	it("a failed read says so, with Try again", async () => {
		const get = vi
			.spyOn(timeService, "getWorkspacePolicyHistory")
			// A 4xx is never retried by the time queries, so the card shows at once.
			.mockRejectedValueOnce(
				new TimeApiError({
					status: 400,
					code: "HTTP_400",
					message: "Bad request",
				}),
			)
			.mockResolvedValueOnce(page([row()]));
		renderHistory();
		expect((await screen.findByRole("alert")).textContent).not.toBe("");
		fireEvent.click(
			screen.getByRole("button", { name: POLICY_HISTORY_COPY.retry }),
		);
		await screen.findByTestId("policy-history-row");
		expect(get).toHaveBeenCalledTimes(2);
	});

	it("refreshes after a policy write (its key sits under the policy prefix)", async () => {
		const get = vi
			.spyOn(timeService, "getWorkspacePolicyHistory")
			.mockResolvedValue(page([row()]));
		renderHistory();
		await screen.findByTestId("policy-history-row");
		expect(policyHistoryFeedKey("w1").slice(0, 2)).toEqual(["time", "policy"]);
		await invalidateTime(client, "policy");
		await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
	});
});
