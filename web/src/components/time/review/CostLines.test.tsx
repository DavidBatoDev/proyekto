/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import { CostLines } from "./CostLines";

afterEach(cleanup);

describe("CostLines", () => {
	it("reads 'Estimated cost' before approval, one line per currency", () => {
		render(
			<CostLines
				cost={{ kind: "estimate", amounts: { USD: 120, PHP: 6885 } }}
				kind="team"
			/>,
		);
		expect(screen.getByTestId("review-cost").textContent).toBe(
			"Estimated cost: PHP 6,885.00 · USD 120.00 (final at approval)",
		);
	});

	it("reads 'Amount at approval' after", () => {
		render(
			<CostLines
				cost={{ kind: "final", amounts: { PHP: 6885 } }}
				kind="workspace"
			/>,
		);
		expect(screen.getByTestId("review-cost").textContent).toBe(
			"Amount at approval: PHP 6,885.00",
		);
	});

	it("shows nothing without cost, or for an agreement sheet on native", () => {
		const { container, rerender } = render(
			<CostLines cost={null} kind="team" />,
		);
		expect(container.textContent).toBe("");
		rerender(
			<CostLines
				cost={{ kind: "estimate", amounts: { USD: 120 } }}
				kind="engagement"
				native
			/>,
		);
		expect(container.textContent).toBe("");
		expect(screen.queryByTestId("review-cost")).toBeNull();
	});
});
