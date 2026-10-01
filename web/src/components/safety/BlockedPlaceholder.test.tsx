/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BlockedContent } from "./BlockedPlaceholder";

describe("BlockedContent", () => {
	afterEach(cleanup);

	it("renders the content untouched when the author is not blocked", () => {
		render(<BlockedContent blocked={false}>hello there</BlockedContent>);
		expect(screen.getByText("hello there")).toBeTruthy();
	});

	it("collapses a blocked person's message until the viewer chooses to see it", () => {
		render(<BlockedContent blocked>hello there</BlockedContent>);
		expect(screen.queryByText("hello there")).toBeNull();
		expect(screen.getByText("Blocked message")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Show" }));
		expect(screen.getByText("hello there")).toBeTruthy();
	});

	it("says comment for comments", () => {
		render(
			<BlockedContent blocked kind="comment">
				nope
			</BlockedContent>,
		);
		expect(screen.getByText("Blocked comment")).toBeTruthy();
	});
});
