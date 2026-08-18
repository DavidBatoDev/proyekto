import { describe, expect, it } from "vitest";
import { effectiveInvoiceStatus, financeStatusMeta } from "./finance-status";

describe("financeStatusMeta", () => {
	it("separates terminal-bad statuses from merely-inactive ones", () => {
		expect(financeStatusMeta("void").tone).toBe("danger");
		expect(financeStatusMeta("cancelled").tone).toBe("danger");
		expect(financeStatusMeta("rejected").tone).toBe("danger");
		// Ended and superseded are ordinary ends of life, not failures.
		expect(financeStatusMeta("ended").tone).toBe("neutral");
		expect(financeStatusMeta("superseded").tone).toBe("neutral");
		expect(financeStatusMeta("draft").tone).toBe("neutral");
	});

	it("reads snake_case DB values as sentences", () => {
		expect(financeStatusMeta("partially_paid").label).toBe("Part paid");
		expect(financeStatusMeta("some_new_status").label).toBe("Some new status");
	});

	it("falls back rather than throwing on an unmapped value", () => {
		expect(financeStatusMeta("").label).toBe("Unknown");
		expect(financeStatusMeta("wat").tone).toBe("neutral");
	});
});

describe("effectiveInvoiceStatus", () => {
	it("promotes an unpaid past-due invoice to overdue", () => {
		expect(effectiveInvoiceStatus({ status: "issued", is_overdue: true })).toBe(
			"overdue",
		);
		expect(
			effectiveInvoiceStatus({ status: "partially_paid", is_overdue: true }),
		).toBe("overdue");
	});

	it("never calls a void or paid invoice overdue", () => {
		expect(effectiveInvoiceStatus({ status: "void", is_overdue: true })).toBe(
			"void",
		);
		expect(effectiveInvoiceStatus({ status: "paid", is_overdue: true })).toBe(
			"paid",
		);
	});

	it("leaves a healthy invoice alone", () => {
		expect(
			effectiveInvoiceStatus({ status: "issued", is_overdue: false }),
		).toBe("issued");
		expect(effectiveInvoiceStatus({ status: "draft" })).toBe("draft");
	});
});
