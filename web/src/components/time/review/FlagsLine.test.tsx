/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlagsLine } from "./FlagsLine";

afterEach(cleanup);

describe("FlagsLine", () => {
	it("reads the flags and toggles Show flagged", () => {
		const onToggle = vi.fn();
		const { rerender } = render(
			<FlagsLine
				parts={["Thu is 11h 40m", "1 entry over 10h", "2 entries added later"]}
				flaggedCount={3}
				flaggedOnly={false}
				onToggleFlagged={onToggle}
			/>,
		);
		expect(screen.getByTestId("review-flags").textContent).toContain(
			"Thu is 11h 40m · 1 entry over 10h · 2 entries added later",
		);
		fireEvent.click(screen.getByRole("button", { name: "Show flagged" }));
		expect(onToggle).toHaveBeenCalledTimes(1);
		rerender(
			<FlagsLine
				parts={["1 entry over 10h"]}
				flaggedCount={1}
				flaggedOnly
				onToggleFlagged={onToggle}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "Show all entries" }),
		).toBeTruthy();
	});

	it("has no button when only days are flagged, and nothing when nothing is", () => {
		const { rerender, container } = render(
			<FlagsLine
				parts={["Thu is 11h 40m"]}
				flaggedCount={0}
				flaggedOnly={false}
				onToggleFlagged={() => {}}
			/>,
		);
		expect(screen.queryByRole("button")).toBeNull();
		rerender(
			<FlagsLine
				parts={[]}
				flaggedCount={0}
				flaggedOnly={false}
				onToggleFlagged={() => {}}
			/>,
		);
		expect(container.textContent).toBe("");
	});
});
