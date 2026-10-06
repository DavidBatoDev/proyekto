/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDialog } from "./AppDialog";

afterEach(() => {
	cleanup();
});

describe("AppDialog accessible name", () => {
	it("a bare dialog without a title is named by ariaLabel", () => {
		render(
			<AppDialog open onClose={vi.fn()} bare hideCloseButton ariaLabel="Switch">
				<p>Stop Fix login bug (1:12) and start this?</p>
			</AppDialog>,
		);
		const dialog = screen.getByRole("dialog", { name: "Switch" });
		expect(dialog.getAttribute("aria-labelledby")).toBeNull();
	});

	it("a title names the dialog; ariaLabel is ignored then", () => {
		render(
			<AppDialog open onClose={vi.fn()} title="Delete entry" ariaLabel="x">
				<p>Body</p>
			</AppDialog>,
		);
		const dialog = screen.getByRole("dialog", { name: "Delete entry" });
		expect(dialog.getAttribute("aria-label")).toBeNull();
	});

	it("without either, nothing is invented", () => {
		render(
			<AppDialog open onClose={vi.fn()} bare hideCloseButton>
				<p>Body</p>
			</AppDialog>,
		);
		const dialog = screen.getByRole("dialog");
		expect(dialog.getAttribute("aria-label")).toBeNull();
		expect(dialog.getAttribute("aria-labelledby")).toBeNull();
	});
});
