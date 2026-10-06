/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import { NOW, U1 } from "./__fixtures__/reportFixtures";
import { ReportGroupTable } from "./ReportGroupTable";
import { isPersonRow, type ReportRow } from "./reportModel";

afterEach(cleanup);

function row(over: Partial<ReportRow>): ReportRow {
	return {
		key: "k",
		label: "Label",
		approvedSeconds: 0,
		notApprovedSeconds: 0,
		billableSeconds: null,
		amounts: null,
		...over,
	};
}

const dateOptions = { now: NOW, userTimezone: "Asia/Manila" };

describe("ReportGroupTable", () => {
	it("labels A5 week rows from their key and keeps the split in two columns", () => {
		render(
			<ReportGroupTable
				groupBy="week"
				dateOptions={dateOptions}
				rows={[
					row({
						key: "2026-09-21",
						label: "Sep 21–27",
						approvedSeconds: 144_000,
						notApprovedSeconds: 3_600,
					}),
					row({ key: "2025-12-29", label: "Dec 29, 2025–Jan 4, 2026" }),
				]}
			/>,
		);
		const headers = screen
			.getAllByRole("columnheader")
			.map((h) => h.textContent);
		expect(headers).toEqual(["Week", "Approved", "Not yet approved"]);
		const first = screen.getByRole("rowheader", { name: "Sep 21–27" });
		const cells = first.parentElement?.querySelectorAll("td") ?? [];
		expect([...cells].map((c) => c.textContent)).toEqual(["40:00", "1:00"]);
		expect(
			screen.getByRole("rowheader", { name: "Dec 29, 2025–Jan 4, 2026" }),
		).toBeTruthy();
	});

	it("adds a Cost column only for rows whose amounts may show", () => {
		const rows = [
			row({ key: "a", label: "A", amounts: { PHP: 10 } }),
			row({ key: "b", label: "B", amounts: { PHP: 20 } }),
		];
		const { rerender } = render(
			<ReportGroupTable
				groupBy="project"
				rows={rows}
				amountsFor={(r) => r.key === "a"}
			/>,
		);
		expect(screen.getByRole("columnheader", { name: "Cost" })).toBeTruthy();
		expect(document.body.textContent).toContain("PHP 10.00");
		expect(document.body.textContent).not.toContain("PHP 20.00");
		rerender(
			<ReportGroupTable
				groupBy="project"
				rows={rows}
				amountsFor={() => false}
			/>,
		);
		expect(screen.queryByRole("columnheader", { name: "Cost" })).toBeNull();
	});

	it("filters to a person from their row", () => {
		const onSelectRow = vi.fn();
		render(
			<ReportGroupTable
				groupBy="member"
				rows={[
					row({ key: U1, label: "Maria Santos" }),
					row({ key: "masked:a1", label: "Delivery team" }),
				]}
				onSelectRow={onSelectRow}
				canSelect={(r) => isPersonRow("member", r.key)}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Maria Santos" }));
		expect(onSelectRow).toHaveBeenCalledWith(
			expect.objectContaining({ key: U1 }),
		);
		expect(screen.queryByRole("button", { name: "Delivery team" })).toBeNull();
	});

	it("says so when there is no time, and drops the split column for clients", () => {
		const { rerender } = render(<ReportGroupTable groupBy="day" rows={[]} />);
		expect(document.body.textContent).toBe("No time in this range.");
		rerender(
			<ReportGroupTable
				groupBy="week"
				rows={[row({ key: "2026-09-21" })]}
				showNotApproved={false}
			/>,
		);
		expect(
			screen.queryByRole("columnheader", { name: "Not yet approved" }),
		).toBeNull();
		// Two columns fit a phone: no width floor that would hide Approved
		// behind a sideways scroll.
		expect(screen.getByRole("table").className).not.toMatch(/min-w-/);
		rerender(
			<ReportGroupTable groupBy="week" rows={[row({ key: "2026-09-21" })]} />,
		);
		expect(screen.getByRole("table").className).toMatch(/min-w-/);
	});
});
