/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FinanceInvoiceSummary } from "@/services/finance.service";
import { InvoicePortfolio } from "./InvoicePortfolio";

afterEach(cleanup);

function invoice(
	overrides: Partial<FinanceInvoiceSummary> = {},
): FinanceInvoiceSummary {
	return {
		id: "inv-1",
		project_id: "project-1",
		project_title_snapshot: "Test Project",
		contract_id: null,
		number: "BS2026-001",
		status: "issued",
		currency: "PHP",
		total: 15000,
		origin: "manual",
		issue_date: "2026-08-01",
		due_date: "2026-08-31",
		period_start: null,
		period_end: null,
		updated_at: "2026-08-01T00:00:00Z",
		project: null,
		amount_paid: 0,
		balance_due: 15000,
		is_overdue: false,
		days_overdue: 0,
		...overrides,
	};
}

function renderList(items: FinanceInvoiceSummary[], total = items.length) {
	return render(
		<InvoicePortfolio
			loading={false}
			items={items}
			total={total}
			page={1}
			limit={25}
			onPageChange={vi.fn()}
			onOpenProject={vi.fn()}
			onExport={vi.fn()}
		/>,
	);
}

describe("InvoicePortfolio", () => {
	it("renders dates through Intl rather than the raw ISO column", () => {
		renderList([invoice()]);
		expect(screen.getByText(/Due Aug 31, 2026/)).toBeTruthy();
		expect(screen.queryByText(/2026-08-31/)).toBeNull();
	});

	it("shows a past-due invoice as overdue with its age", () => {
		renderList([invoice({ is_overdue: true, days_overdue: 12 })]);
		expect(screen.getByText(/12 days overdue/)).toBeTruthy();
		expect(screen.getByText("Overdue")).toBeTruthy();
	});

	it("never labels a void invoice overdue", () => {
		renderList([invoice({ status: "void", is_overdue: true, balance_due: 0 })]);
		expect(screen.getByText("Void")).toBeTruthy();
		expect(screen.queryByText("Overdue")).toBeNull();
	});

	it("renders a detached invoice as a non-interactive row with an explanation", () => {
		const onOpenProject = vi.fn();
		render(
			<InvoicePortfolio
				loading={false}
				items={[invoice({ project_id: null })]}
				total={1}
				page={1}
				limit={25}
				onPageChange={vi.fn()}
				onOpenProject={onOpenProject}
				onExport={vi.fn()}
			/>,
		);
		// The old build rendered a `disabled` button with no reason given.
		expect(screen.queryByRole("button", { name: /BS2026-001/ })).toBeNull();
		expect(screen.getByText("Detached")).toBeTruthy();
	});

	it("sums outstanding balance per currency", () => {
		renderList([
			invoice({ id: "a", balance_due: 15000 }),
			invoice({ id: "b", balance_due: 5000 }),
			// Settled invoices carry no balance and must not be counted.
			invoice({ id: "c", status: "paid", balance_due: 0 }),
		]);
		expect(screen.getByText("PHP 20,000.00")).toBeTruthy();
	});

	it("shows a pager only once the total exceeds one page", () => {
		renderList([invoice()], 3);
		expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();

		cleanup();
		renderList([invoice()], 60);
		expect(screen.getByRole("navigation", { name: "Pagination" })).toBeTruthy();
		expect(screen.getByText("1 / 3")).toBeTruthy();
	});
});
