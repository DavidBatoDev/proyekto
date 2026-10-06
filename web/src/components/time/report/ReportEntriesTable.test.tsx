/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import {
	entry,
	maskedAgreementEntry,
	NOW,
} from "./__fixtures__/reportFixtures";
import { ReportEntriesTable } from "./ReportEntriesTable";

afterEach(cleanup);

const base = {
	total: 1,
	page: 1,
	timezone: "Asia/Manila",
	dateOptions: { now: NOW, userTimezone: "Asia/Manila" },
};

function headers(): string[] {
	return screen.getAllByRole("columnheader").map((h) => h.textContent ?? "");
}

describe("ReportEntriesTable", () => {
	it("reads dates and times in the scope's timezone", () => {
		render(<ReportEntriesTable {...base} entries={[entry()]} />);
		// 01:00Z is 09:00 in Manila.
		expect(document.body.textContent).toContain("Mon Oct 5");
		expect(document.body.textContent).toContain("09:00–10:00");
		expect(document.body.textContent).toContain("1:00");
		expect(document.body.textContent).toContain("Fix login bug");
		expect(document.body.textContent).toContain("Acme Website");
	});

	it("follows the viewer's grant: Delivery team and a project they can't open", () => {
		render(
			<ReportEntriesTable
				{...base}
				total={2}
				entries={[
					maskedAgreementEntry({ id: "m" }),
					entry({
						id: "h",
						content: "hidden",
						task: null,
						project: null,
						task_id: null,
						work_item: "review",
						content_label: "A project you can't open",
					}),
				]}
			/>,
		);
		expect(document.body.textContent).toContain("Delivery team");
		expect(document.body.textContent).toContain("A project you can't open");
		expect(document.body.textContent).toContain("Review");
		expect(document.body.textContent).toContain("Acme Corp · agreement");
	});

	it("shows an amount only where cost is visible and the time is approved", () => {
		render(
			<ReportEntriesTable
				{...base}
				total={3}
				entries={[
					entry({
						id: "v",
						cost: "visible",
						payable_seconds: 3600,
						currency_snapshot: "PHP",
						amount_snapshot: 450,
					}),
					entry({ id: "x", payable_seconds: 3600 }),
					entry({
						id: "p",
						cost: "visible",
						currency_snapshot: "PHP",
						amount_snapshot: null,
					}),
				]}
			/>,
		);
		expect(headers()).toContain("Cost");
		expect(document.body.textContent).toContain("PHP 450.00");
		expect(document.body.textContent?.match(/PHP/g)).toHaveLength(1);
	});

	it("marks a running timer and an unapproved row", () => {
		render(
			<ReportEntriesTable
				{...base}
				entries={[
					entry({
						ended_at: null,
						duration_seconds: null,
						payable_seconds: null,
					}),
				]}
			/>,
		);
		expect(document.body.textContent).toContain("Running");
		expect(headers()).not.toContain("Cost");
	});

	it("opens an entry and pages", () => {
		const onOpenEntry = vi.fn();
		const onPageChange = vi.fn();
		render(
			<ReportEntriesTable
				{...base}
				total={120}
				page={1}
				pageSize={50}
				entries={[entry()]}
				onOpenEntry={onOpenEntry}
				onPageChange={onPageChange}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Fix login bug" }));
		expect(onOpenEntry).toHaveBeenCalledWith(
			expect.objectContaining({ id: "e1" }),
		);
		expect(document.body.textContent).toContain("1–50 of 120");
		expect(
			(
				screen.getByRole("button", {
					name: "Previous page",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "Next page" }));
		expect(onPageChange).toHaveBeenCalledWith(2);
	});

	it("gives the client date, work and approved hours only", () => {
		render(
			<ReportEntriesTable
				{...base}
				variant="client"
				entries={[
					entry({
						payable_seconds: 5400,
						duration_seconds: null,
						cost: "visible",
						amount_snapshot: 10,
						currency_snapshot: "USD",
					}),
				]}
			/>,
		);
		expect(headers()).toEqual(["Date", "Work", "Approved"]);
		expect(document.body.textContent).toContain("Acme Website · Fix login bug");
		expect(document.body.textContent).toContain("1:30");
		expect(document.body.textContent).not.toContain("Maria");
		expect(document.body.textContent).not.toContain("USD");
	});

	it("folds the date and person into the work cell for a narrow table", () => {
		render(<ReportEntriesTable {...base} entries={[entry()]} />);
		// Shown only below the 36rem container width (CSS); the text is there.
		expect(screen.getByTestId("report-entry-folded").textContent).toBe(
			"Mon Oct 5 · Maria Santos",
		);
		cleanup();
		render(
			<ReportEntriesTable {...base} variant="client" entries={[entry()]} />,
		);
		// The client's table keeps its Date column and never names a person.
		expect(screen.queryByTestId("report-entry-folded")).toBeNull();
	});

	it("lets the work cell take the leftover width so its lines ellipsize", () => {
		// The auto table layout ignores a cell's max-width: a capped Work cell
		// grew to its longest line and pushed Approved off a phone screen.
		render(<ReportEntriesTable {...base} entries={[entry()]} />);
		const cell = screen.getByTestId("report-entry-work");
		expect(cell.className).toContain("w-full");
		expect(cell.className).toContain("max-w-0");
		expect(cell.className).not.toContain("max-w-[18rem]");
	});

	it("says so when empty", () => {
		render(<ReportEntriesTable {...base} total={0} entries={[]} />);
		expect(document.body.textContent).toBe("No time in this range.");
	});
});
