import { describe, expect, it } from "vitest";
import { defaultBilledCurrency } from "./imports/ImportWorkspace";
import { invoiceHoursLabel } from "./ProjectInvoices";
import { formatFinanceDate } from "./portfolio/FinancePrimitives";

describe("invoiceHoursLabel", () => {
	const line = (source_type: "manual" | "time_log") =>
		({ source_type }) as never;

	it("says nothing about hours on an imported invoice", () => {
		expect(
			invoiceHoursLabel({
				origin: "imported",
				hours_detail_level: "summary",
				line_items: [line("manual")],
			}),
		).toBeNull();
	});

	it("says nothing on a hand-written invoice with no time lines", () => {
		expect(
			invoiceHoursLabel({
				origin: "manual",
				hours_detail_level: "summary",
				line_items: [line("manual")],
			}),
		).toBeNull();
	});

	it("keeps the label on invoices built from logged time", () => {
		expect(
			invoiceHoursLabel({
				origin: "manual",
				hours_detail_level: "summary",
				line_items: [line("time_log")],
			}),
		).toBe("Hours summarised");
		expect(
			invoiceHoursLabel({
				origin: "scheduled",
				hours_detail_level: "detailed",
				line_items: [],
			}),
		).toBe("Hours itemised by task");
	});
});

describe("defaultBilledCurrency", () => {
	it("defaults to the project's currency", () => {
		expect(defaultBilledCurrency(null, "php")).toBe("PHP");
	});
	it("lets an explicit choice win", () => {
		expect(defaultBilledCurrency("USD", "PHP")).toBe("USD");
	});
	it("falls back when the project has none", () => {
		expect(defaultBilledCurrency(null, undefined)).toBe("AUD");
	});
});

describe("formatFinanceDate", () => {
	it("formats expense dates like the rest of finance", () => {
		expect(formatFinanceDate("2026-09-18")).toMatch(/Sep 18, 2026/);
	});
});
