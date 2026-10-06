/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import { ReportTotals, sheetCountsLine } from "./ReportTotals";

afterEach(cleanup);

const figures = {
	approvedSeconds: 137_700, // 38:15
	notApprovedSeconds: 50_400, // 14:00
	billableSeconds: null,
	amounts: { PHP: 6885, USD: 120 },
};

function tile(name: string): HTMLElement {
	return screen.getByRole("group", { name });
}

describe("ReportTotals", () => {
	it("shows Approved and Not yet approved apart, with no total", () => {
		render(<ReportTotals figures={figures} showAmounts />);
		expect(tile("Approved").textContent).toContain("38:15");
		expect(tile("Not yet approved").textContent).toContain("14:00");
		expect(tile("Not yet approved").textContent).toContain(
			"Not part of Approved or cost",
		);
		// 38:15 + 14:00 is never shown.
		expect(document.body.textContent).not.toContain("52:15");
		expect(screen.queryByRole("group", { name: /total/i })).toBeNull();
	});

	it("shows cost one line per currency, only when allowed", () => {
		const { rerender } = render(<ReportTotals figures={figures} showAmounts />);
		expect(tile("Cost").textContent).toBe("CostPHP 6,885.00USD 120.00");
		rerender(<ReportTotals figures={figures} showAmounts={false} />);
		expect(screen.queryByRole("group", { name: "Cost" })).toBeNull();
	});

	it("shows Billable only when it is known", () => {
		const { rerender } = render(<ReportTotals figures={figures} />);
		expect(screen.queryByRole("group", { name: "Billable" })).toBeNull();
		rerender(
			<ReportTotals figures={{ ...figures, billableSeconds: 126_000 }} />,
		);
		expect(tile("Billable").textContent).toContain("35:00");
	});

	it("waits on a pending split and reads an unknown one as a dash", () => {
		const pending = { ...figures, notApprovedSeconds: null };
		const { rerender } = render(
			<ReportTotals figures={pending} notApprovedPending />,
		);
		expect(tile("Not yet approved").textContent).not.toContain("—");
		rerender(<ReportTotals figures={pending} />);
		expect(tile("Not yet approved").textContent).toContain("—");
	});

	it("hides Not yet approved in the client's view", () => {
		render(<ReportTotals figures={figures} showNotApproved={false} />);
		expect(
			screen.queryByRole("group", { name: "Not yet approved" }),
		).toBeNull();
	});

	it("counts timesheets by status, leaving zeros out", () => {
		expect(
			sheetCountsLine({ open: 2, submitted: 1, returned: 0, approved: 4 }),
		).toBe("Timesheets: 2 open · 1 submitted · 4 approved");
		expect(sheetCountsLine({ open: 0 })).toBeNull();
	});
});
