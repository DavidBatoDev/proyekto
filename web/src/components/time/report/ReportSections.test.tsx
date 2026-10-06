/* @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import { entry, maskedAgreementEntry, U2 } from "./__fixtures__/reportFixtures";
import { ReportSections } from "./ReportSections";
import { sectionsFromEntries } from "./reportModel";

afterEach(cleanup);

const sections = sectionsFromEntries([
	entry({
		id: "a",
		context_label_snapshot: "Prodigitality Services Inc. Team",
		payable_seconds: 7200,
		duration_seconds: 7200,
		cost: "visible",
		currency_snapshot: "PHP",
		amount_snapshot: 900,
	}),
	entry({
		id: "b",
		context_label_snapshot: "Prodigitality Services Inc. Team",
		member_user_id: U2,
		member: { id: U2, display_name: "Leo Cruz", avatar_url: null },
		duration_seconds: 1800,
		cost: "visible",
	}),
	maskedAgreementEntry({ id: "c", payable_seconds: 3600 }),
]);

describe("ReportSections", () => {
	it("heads each context and keeps Approved apart from Not yet approved", () => {
		render(<ReportSections sections={sections} />);
		const team = screen.getByRole("region", {
			name: "Prodigitality Services Inc. Team · team",
		});
		const header = within(team).getByRole("banner");
		expect(header.textContent).toContain("Prodigitality Services… · team");
		expect(header.textContent).toContain("Approved 2:00");
		expect(header.textContent).toContain("Not yet approved 0:30");
		expect(header.textContent).toContain("PHP 900.00");
		expect(header.textContent).not.toContain("2:30");
		expect(team.textContent).toContain("Leo Cruz");
		expect(team.textContent).toContain("Maria Santos");
	});

	it("reads an agreement whose people are masked as the delivery team, hours only", () => {
		render(<ReportSections sections={sections} />);
		const agreement = screen.getByRole("region", {
			name: "Delivery team · agreement with Acme Corp",
		});
		expect(agreement.textContent).toContain("Approved 1:00");
		expect(agreement.textContent).toContain("(hours only)");
		expect(agreement.textContent).not.toMatch(/PHP|USD/);
	});

	it("notes the 10,000-entry cap and an empty range", () => {
		const { rerender } = render(<ReportSections sections={sections} capped />);
		expect(document.body.textContent).toContain(
			"Showing the first 10,000 entries",
		);
		rerender(<ReportSections sections={[]} />);
		expect(document.body.textContent).toBe("No time in this range.");
	});
});
