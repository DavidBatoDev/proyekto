/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ContractDocumentPreview,
	type ContractDocumentView,
	contractClauseOutline,
	stripClauseNumberPrefix,
} from "./ContractDocumentPreview";

afterEach(cleanup);

describe("stripClauseNumberPrefix", () => {
	it("removes complete top-level and nested display numbers", () => {
		expect(stripClauseNumberPrefix("1. Parties")).toBe("Parties");
		expect(stripClauseNumberPrefix("1.1. New subclause")).toBe("New subclause");
		expect(stripClauseNumberPrefix("12.4.2. Nested title")).toBe(
			"Nested title",
		);
	});
});

const contract: ContractDocumentView = {
	contract_number: "CTR-0001",
	service_start_date: "2026-08-01",
	service_end_date: "2027-07-31",
	clauses: [
		{
			key: "confidentiality",
			title: "Confidentiality",
			body: "{{provider}} must keep records for {{client}} confidential.",
			position: 0,
		},
	],
	services: [],
	periods: [],
	signed_by_consultant_at: null,
	signed_by_consultant_name: null,
	signed_by_consultant_signature_url: null,
	signed_by_consultant_signature_scale: 1,
	signed_by_consultant_signature_offset_x: 0,
	signed_by_consultant_signature_offset_y: 0,
	signed_by_client_at: null,
	signed_by_client_name: null,
	signed_by_client_signature_url: null,
	signed_by_client_signature_scale: 1,
	signed_by_client_signature_offset_x: 0,
	signed_by_client_signature_offset_y: 0,
};

const parties = {
	provider_name: "Northstar Studio",
	provider_address: "Manila",
	client_name: "Heavenly Glow",
	client_contact_name: "Rio Ramirez",
	client_address: "Makati",
};

const terms = {
	currency: "PHP",
	billing_mode: "retainer" as const,
	fixed_fee: "",
	recurring_fee: "50000",
	client_hourly_rate: "",
	service_description: "Brand consulting",
	payment_method: "Bank transfer",
	due_days: "15",
	billing_timing: "advance" as const,
	auto_renew: false,
	notice_days: "30",
};

describe("ContractDocumentPreview canvas", () => {
	it("numbers nested clauses as a legal outline", () => {
		const outline = contractClauseOutline([
			{ ...contract.clauses[0], position: 0 },
			{
				key: "records",
				parent_key: "confidentiality",
				title: "Records",
				body: "Keep records for seven years.",
				position: 1,
			},
			{
				key: "payment",
				title: "Payment",
				body: "Invoices are due within fifteen days.",
				position: 2,
			},
		]);

		expect(outline.map((item) => item.number)).toEqual(["1", "1.1", "2"]);
	});

	it("uses document regions to drive the structured inspector", () => {
		const onSectionSelect = vi.fn();
		render(
			<ContractDocumentPreview
				contract={contract}
				parties={parties}
				terms={terms}
				mode="canvas"
				activeSection="parties"
				onSectionSelect={onSectionSelect}
				editable
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Edit terms section" }));
		expect(onSectionSelect).toHaveBeenCalledWith("terms");
		expect(screen.getByText("Document editor")).toBeTruthy();
	});

	it("uses one agreement outline for all visible clauses", () => {
		const multiClauseContract: ContractDocumentView = {
			...contract,
			clauses: [
				...contract.clauses,
				{
					key: "payment",
					title: "Payment terms",
					body: "Invoices are due within fifteen days.",
					position: 1,
				},
			],
		};

		render(
			<ContractDocumentPreview
				contract={multiClauseContract}
				parties={parties}
				terms={terms}
				mode="canvas"
				activeSection="agreement"
				onSectionSelect={() => {}}
				editable
			/>,
		);

		expect(
			screen.getAllByRole("button", { name: "Edit agreement section" }),
		).toHaveLength(1);
	});

	it("keeps each clause margin inside its pagination block", () => {
		const { container } = render(
			<ContractDocumentPreview
				contract={contract}
				parties={parties}
				terms={terms}
				mode="canvas"
				onSectionSelect={() => {}}
				editable
			/>,
		);

		expect(
			container.querySelector(
				'[data-contract-block="clause:confidentiality:0"]',
			)?.className,
		).toContain("flow-root");
	});

	it("preserves structured party tokens when a clause is edited inline", () => {
		const onClauseChange = vi.fn();
		const { container } = render(
			<ContractDocumentPreview
				contract={contract}
				parties={parties}
				terms={terms}
				mode="canvas"
				activeSection="agreement"
				onSectionSelect={() => {}}
				editable
				onClauseChange={onClauseChange}
			/>,
		);

		expect(
			container.querySelector('[data-contract-token="{{provider}}"]')
				?.textContent,
		).toBe("Northstar Studio");

		const clause = container.querySelector(
			'[data-contract-clause="confidentiality"]',
		) as HTMLParagraphElement;
		clause.innerHTML =
			'<span data-contract-token="{{provider}}">Northstar Studio</span> must keep records.';
		fireEvent.blur(clause);

		expect(onClauseChange).toHaveBeenCalledWith("confidentiality", {
			body: "{{provider}} must keep records.",
		});
	});

	it("keeps signed or client-facing documents read-only", () => {
		const { container } = render(
			<ContractDocumentPreview
				contract={contract}
				parties={parties}
				terms={terms}
				mode="canvas"
				activeSection="agreement"
				onSectionSelect={() => {}}
			/>,
		);

		expect(container.querySelector('[contenteditable="true"]')).toBeNull();
		expect(
			screen.getByRole("button", { name: "View agreement section" }),
		).toBeTruthy();
	});
});
