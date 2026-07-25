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
	it("renders the Canva-layout fields", () => {
		render(<InvoicePreview {...baseProps} />);
		expect(screen.getByText("Prodigitality Services Inc.")).toBeTruthy();
		expect(screen.getByText("TIN: 617-100-003-00000")).toBeTruthy();
		expect(screen.getByText("Filro Caregivers")).toBeTruthy();
		expect(screen.getByText("#BS2026-001")).toBeTruthy();
		expect(screen.getByText("Digital marketing services")).toBeTruthy();
		expect(screen.getByText("25.75 HOURS")).toBeTruthy();
		expect(screen.getByText("ONLINE PAYMENT")).toBeTruthy();
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
		expect(screen.queryByText("1 HOURS")).toBeNull();
	});

	it("falls back to Draft when no number is set", () => {
		render(<InvoicePreview {...baseProps} number="" />);
		expect(screen.getByText("#Draft")).toBeTruthy();
	});
});
