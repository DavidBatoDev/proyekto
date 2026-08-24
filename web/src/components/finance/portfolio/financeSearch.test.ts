import { describe, expect, it } from "vitest";
import {
	financeSectionFromPathname,
	legacyTabRoute,
	validateContractStep,
	validateFinanceSharedSearch,
} from "./financeSearch";

describe("legacyTabRoute", () => {
	it("forwards every tab that became its own route", () => {
		expect(legacyTabRoute("contracts")).toBe("/marketplace/finance/contracts");
		expect(legacyTabRoute("invoices")).toBe("/marketplace/finance/invoices");
	});

	it("stays put for the overview and for junk", () => {
		// The overview IS the route doing the forwarding, so redirecting would
		// loop; anything unrecognised belongs there too rather than 404ing.
		expect(legacyTabRoute("overview")).toBeUndefined();
		// `engagements` stopped being a finance tab when the section moved to
		// the top-level `/engagements` page; the legacy value lands on the
		// overview rather than a section that no longer exists.
		expect(legacyTabRoute("engagements")).toBeUndefined();
		expect(legacyTabRoute(undefined)).toBeUndefined();
		expect(legacyTabRoute("../evil")).toBeUndefined();
		expect(legacyTabRoute(7)).toBeUndefined();
	});
});

describe("financeSectionFromPathname", () => {
	it("names the section for each list route", () => {
		expect(financeSectionFromPathname("/marketplace/finance")).toBe("overview");
		expect(financeSectionFromPathname("/marketplace/finance/contracts")).toBe(
			"contracts",
		);
		expect(financeSectionFromPathname("/marketplace/finance/invoices")).toBe(
			"invoices",
		);
	});

	it("keeps the invoice editors inside the invoices section", () => {
		// They render outside the portfolio chrome, but a filter toolbar built
		// while one is open should still be the invoice one.
		expect(
			financeSectionFromPathname("/marketplace/finance/invoices/new"),
		).toBe("invoices");
		expect(
			financeSectionFromPathname("/marketplace/finance/invoices/abc-123/edit"),
		).toBe("invoices");
	});

	it("treats a contract id as the overview, not a section", () => {
		// `/marketplace/finance/<uuid>` is the document editor. It is not one of
		// the four sections, and claiming it were would light up the wrong tab.
		expect(
			financeSectionFromPathname(
				"/marketplace/finance/7f3c1e2a-0000-4000-8000-000000000000",
			),
		).toBe("overview");
	});
});

describe("validateFinanceSharedSearch", () => {
	it("keeps the filters that survive a section change", () => {
		expect(
			validateFinanceSharedSearch({
				q: "atlas",
				projectId: "p1",
				projectStatus: "active",
				currency: "USD",
				from: "2026-01-01",
				to: "2026-02-01",
			}),
		).toEqual({
			q: "atlas",
			projectId: "p1",
			projectStatus: "active",
			currency: "USD",
			from: "2026-01-01",
			to: "2026-02-01",
		});
	});

	it("drops empty strings and non-strings rather than passing them on", () => {
		// An empty `?q=` would otherwise count as an active filter and light up
		// the Reset chip with nothing to reset.
		const result = validateFinanceSharedSearch({
			q: "",
			projectId: 42,
			currency: null,
		});
		expect(result.q).toBeUndefined();
		expect(result.projectId).toBeUndefined();
		expect(result.currency).toBeUndefined();
	});

	it("ignores params that belong to a single section", () => {
		const result = validateFinanceSharedSearch({
			contractStatus: "signed",
			invoiceStatus: "paid",
		}) as Record<string, unknown>;
		expect(result.contractStatus).toBeUndefined();
		expect(result.invoiceStatus).toBeUndefined();
	});
});

describe("validateContractStep", () => {
	it("accepts the document's own sections and nothing else", () => {
		expect(validateContractStep("signatures")).toBe("signatures");
		expect(validateContractStep("parties")).toBe("parties");
		expect(validateContractStep("not-a-step")).toBeUndefined();
		expect(validateContractStep(undefined)).toBeUndefined();
	});
});
