import { describe, expect, it } from "vitest";
import { summariseProjectMoneyIn } from "./projectMoneyIn";

const invoice = (
	status: string,
	total: number,
	amount_paid: number,
	currency = "AUD",
) => ({
	id: `${status}-${total}`,
	status,
	total,
	currency,
	issued_at: "2026-09-01T00:00:00Z",
	amount_paid,
});

describe("summariseProjectMoneyIn", () => {
	it("totals billed, collected and outstanding, ignoring drafts and voids", () => {
		const rows = summariseProjectMoneyIn([
			invoice("paid", 10000, 10000),
			invoice("partially_paid", 5000, 2000),
			invoice("issued", 1500, 0),
			invoice("draft", 999, 0),
			invoice("void", 777, 0),
		]);
		expect(rows).toEqual([
			{
				currency: "AUD",
				billed: 16500,
				collected: 12000,
				outstanding: 4500,
				count: 3,
			},
		]);
	});

	it("keeps currencies apart", () => {
		const rows = summariseProjectMoneyIn([
			invoice("issued", 100, 0, "PHP"),
			invoice("paid", 50, 50, "USD"),
		]);
		expect(rows.map((row) => row.currency)).toEqual(["PHP", "USD"]);
	});

	it("returns nothing when there are no invoices", () => {
		expect(summariseProjectMoneyIn(undefined)).toEqual([]);
	});
});
