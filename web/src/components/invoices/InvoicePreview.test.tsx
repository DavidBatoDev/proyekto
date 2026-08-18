/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InvoicePreview } from "./InvoicePreview";

afterEach(cleanup);

const baseProps = {
	number: "BS2026-001",
	currency: "USD",
	issueDate: "2026-08-31",
	dueDate: "2026-09-15",
	periodStart: "2026-08-01",
	periodEnd: "2026-08-31",
	issuedBy: {
		name: "Prodigitality Services Inc.",
		address: "Unit 26, 4th Floor The Site Plaza",
		tin: "617-100-003-00000",
		email: "billing@prodigitality.net",
	},
	billTo: { name: "Filro Caregivers" },
	paymentMethod: "Online payment",
	notes: null,
	lines: [
		{
			description: "Digital marketing services",
			quantity: 25.75,
			unit_rate: 15,
			isHours: true,
		},
	],
};

describe("InvoicePreview", () => {
	it("carries every party, date and money field onto the page", () => {
		render(<InvoicePreview {...baseProps} />);
		// Names, descriptions and payment methods keep the casing they were
		// entered with — upper-casing arbitrary prose is shouting.
		expect(screen.getByText("Prodigitality Services Inc.")).toBeTruthy();
		expect(screen.getByText("TIN 617-100-003-00000")).toBeTruthy();
		expect(screen.getByText("Filro Caregivers")).toBeTruthy();
		expect(screen.getByText("BS2026-001")).toBeTruthy();
		expect(screen.getByText("Digital marketing services")).toBeTruthy();
		expect(screen.getByText("25.75 hours")).toBeTruthy();
		expect(screen.getByText("Online payment")).toBeTruthy();
		expect(screen.getByText("Total due")).toBeTruthy();
	});

	it("states the balance and what has already been settled", () => {
		render(
			<InvoicePreview
				{...baseProps}
				status="partially_paid"
				amountPaid={100}
			/>,
		);
		expect(screen.getByText("Partially paid")).toBeTruthy();
		expect(screen.getByText("Paid to date")).toBeTruthy();
		expect(screen.getByText("− USD 100.00")).toBeTruthy();
		// 386.25 billed less 100.00 settled.
		expect(screen.getByText("Balance due")).toBeTruthy();
		expect(screen.getByText("USD 286.25")).toBeTruthy();
	});

	it("marks an overdue invoice on the document itself", () => {
		render(<InvoicePreview {...baseProps} status="issued" isOverdue />);
		expect(screen.getByText("Overdue")).toBeTruthy();
	});

	it("says nothing about status when the caller supplies none", () => {
		render(<InvoicePreview {...baseProps} />);
		for (const word of ["Draft", "Overdue", "Void", "Paid in full"]) {
			expect(screen.queryByText(word)).toBeNull();
		}
	});

	it("computes the total from the line items in the given currency", () => {
		render(<InvoicePreview {...baseProps} />);
		// 25.75 × 15 = 386.25, matching the server PDF math. Appears twice — the
		// line's own total and the footer TOTAL DUE.
		expect(screen.getAllByText("USD 386.25").length).toBeGreaterThanOrEqual(2);
	});

	it("labels a non-hours line as a bare count", () => {
		render(
			<InvoicePreview
				{...baseProps}
				lines={[
					{
						description: "Professional services",
						quantity: 1,
						unit_rate: 15000,
						isHours: false,
					},
				]}
			/>,
		);
		expect(screen.getByText("1")).toBeTruthy();
		expect(screen.queryByText("1 hours")).toBeNull();
	});

	it("falls back to Draft when no number is set", () => {
		render(<InvoicePreview {...baseProps} number="" />);
		expect(screen.getByText("Draft")).toBeTruthy();
	});
});
