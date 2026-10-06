/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import { AmountLines, amountsAllowed } from "./AmountLines";

afterEach(cleanup);

describe("AmountLines", () => {
	it("writes one line per currency, sorted, never summed", () => {
		render(
			<AmountLines
				amounts={{ USD: 120, PHP: 6885 }}
				cost="visible"
				kind="team"
			/>,
		);
		expect(screen.getByTestId("amount-lines").textContent).toBe(
			"PHP 6,885.00 · USD 120.00",
		);
	});

	it("stacks lines, with a prefix and suffix", () => {
		render(
			<AmountLines
				amounts={{ PHP: 6885, USD: 120 }}
				cost="visible"
				kind="workspace"
				layout="stacked"
				prefix="Estimated cost:"
				suffix="(final at approval)"
			/>,
		);
		const lines = Array.from(
			screen.getByTestId("amount-lines").querySelectorAll("span"),
		).map((el) => el.textContent);
		expect(lines).toEqual([
			"Estimated cost:",
			"PHP 6,885.00",
			"USD 120.00",
			"(final at approval)",
		]);
	});

	it("never shows hidden cost", () => {
		const { container } = render(
			<AmountLines
				amounts={{ PHP: 450 }}
				cost="hidden"
				kind="team"
				empty="—"
			/>,
		);
		expect(container.innerHTML).toBe("");
	});

	it("never shows agreement amounts on native", () => {
		const { container, rerender } = render(
			<AmountLines
				amounts={{ PHP: 450 }}
				cost="visible"
				kind="assignment"
				native
			/>,
		);
		expect(container.innerHTML).toBe("");
		rerender(
			<AmountLines
				amounts={{ PHP: 450 }}
				cost="visible"
				kind="engagement"
				native
			/>,
		);
		expect(container.innerHTML).toBe("");
		// Team time is not agreement time.
		rerender(
			<AmountLines amounts={{ PHP: 450 }} cost="visible" kind="team" native />,
		);
		expect(container.textContent).toBe("PHP 450.00");
		expect(
			amountsAllowed({ cost: "visible", kind: "assignment", native: false }),
		).toBe(true);
	});

	it("shows `empty` only when amounts may show but there are none", () => {
		const { container, rerender } = render(
			<AmountLines amounts={null} cost="visible" kind="team" empty="—" />,
		);
		expect(container.textContent).toBe("—");
		rerender(<AmountLines amounts={{}} cost="visible" kind="team" />);
		expect(container.innerHTML).toBe("");
	});
});
