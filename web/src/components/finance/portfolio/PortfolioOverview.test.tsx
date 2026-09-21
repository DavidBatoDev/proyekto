/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	FinanceCurrencyTotals,
	FinancePortfolio,
	FinanceProject,
} from "@/services/finance.service";
import { PortfolioOverview } from "./PortfolioOverview";

afterEach(cleanup);

function project(overrides: Partial<FinanceProject> = {}): FinanceProject {
	return {
		id: "project-1",
		title: "Test Project",
		status: "active",
		currency: "PHP",
		owner_id: null,
		created_at: "2026-01-01T00:00:00Z",
		revenue: 30000,
		collected: 0,
		outstanding: 30000,
		cost: 0,
		margin: 30000,
		margin_percent: 100,
		invoice_count: 2,
		overdue_amount: 0,
		overdue_count: 0,
		latest_contract: null,
		...overrides,
	};
}

function totals(
	overrides: Partial<FinanceCurrencyTotals> = {},
): FinanceCurrencyTotals {
	return {
		currency: "PHP",
		revenue: 30000,
		collected: 0,
		outstanding: 30000,
		cost: 0,
		margin: 30000,
		margin_percent: 100,
		invoice_count: 2,
		project_count: 1,
		overdue_amount: 0,
		overdue_count: 0,
		aging: { current: 30000, d1_30: 0, d31_60: 0, d61_plus: 0 },
		...overrides,
	};
}

function renderOverview(portfolio: Partial<FinancePortfolio> = {}) {
	return render(
		<PortfolioOverview
			loading={false}
			portfolio={{
				projects: [project()],
				totals_by_currency: [totals()],
				as_of: "2026-08-18",
				...portfolio,
			}}
			onOpen={vi.fn()}
		/>,
	);
}

describe("PortfolioOverview", () => {
	it("keeps the overview scaffold when the portfolio is empty", () => {
		renderOverview({ projects: [], totals_by_currency: [] });
		// The section heading and projects table must survive an empty
		// portfolio; only the currency cards give way to a placeholder.
		expect(screen.getByText("Project performance")).toBeTruthy();
		expect(screen.getByText("Projects")).toBeTruthy();
		expect(screen.getByText("No billing activity yet")).toBeTruthy();
		expect(
			screen.getByText(
				"Projects appear here once they have a contract or an invoice.",
			),
		).toBeTruthy();
	});

	it("stays quiet when nothing is past due", () => {
		renderOverview();
		expect(screen.queryByText(/invoices? past due$/)).toBeNull();
	});

	it("leads with an overdue banner when money is late", () => {
		renderOverview({
			totals_by_currency: [
				totals({
					overdue_amount: 12000,
					overdue_count: 2,
					aging: { current: 18000, d1_30: 12000, d31_60: 0, d61_plus: 0 },
				}),
			],
		});
		expect(screen.getByText("2 invoices past due")).toBeTruthy();
	});

	it("breaks the outstanding balance into ageing bands", () => {
		renderOverview({
			totals_by_currency: [
				totals({
					outstanding: 9000,
					aging: { current: 1000, d1_30: 2000, d31_60: 3000, d61_plus: 3000 },
				}),
			],
		});
		expect(screen.getByText("Receivables")).toBeTruthy();
		expect(screen.getByText("PHP 2,000.00")).toBeTruthy();
		expect(screen.getByText("As of Aug 18, 2026")).toBeTruthy();
	});

	it("hides receivables entirely when nothing is owed", () => {
		renderOverview({
			totals_by_currency: [
				totals({
					collected: 30000,
					outstanding: 0,
					aging: { current: 0, d1_30: 0, d31_60: 0, d61_plus: 0 },
				}),
			],
		});
		expect(screen.queryByText("Receivables")).toBeNull();
	});

	it("makes every project row reachable by keyboard", () => {
		renderOverview({
			projects: [
				project({ id: "a", title: "Alpha" }),
				project({ id: "b", title: "Beta" }),
			],
		});
		// The rows used to be <tr onClick>, which tab order never reached.
		expect(screen.getByRole("button", { name: /Alpha/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /Beta/ })).toBeTruthy();
	});

	it("calls back with the project id the reader activated", () => {
		const onOpen = vi.fn();
		render(
			<PortfolioOverview
				loading={false}
				portfolio={{
					projects: [project({ id: "project-42", title: "Answer" })],
					totals_by_currency: [totals()],
					as_of: "2026-08-18",
				}}
				onOpen={onOpen}
			/>,
		);
		screen.getByRole("button", { name: /Answer/ }).click();
		expect(onOpen).toHaveBeenCalledWith("project-42");
	});

	it("flags an overdue balance on the project row", () => {
		renderOverview({
			projects: [project({ overdue_amount: 15000, overdue_count: 1 })],
		});
		expect(screen.getByText("1 invoice overdue")).toBeTruthy();
	});
});
