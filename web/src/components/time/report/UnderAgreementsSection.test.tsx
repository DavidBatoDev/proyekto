/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UnderAgreementsSection } from "./UnderAgreementsSection";

afterEach(cleanup);

describe("UnderAgreementsSection", () => {
	it("shows the team's agreement hours as the delivery team, hours only", () => {
		render(<UnderAgreementsSection seconds={136_800} />);
		const section = screen.getByRole("region", { name: "Under agreements" });
		expect(section.textContent).toContain("Delivery team");
		expect(section.textContent).toContain("38:00");
		expect(section.textContent).toContain("logged (hours only)");
		expect(section.textContent).not.toMatch(/PHP|USD|Approved/);
	});

	it("renders nothing without hours", () => {
		for (const seconds of [0, null, undefined, Number.NaN]) {
			const { container, unmount } = render(
				<UnderAgreementsSection seconds={seconds} />,
			);
			expect(container.innerHTML).toBe("");
			unmount();
		}
	});
});
