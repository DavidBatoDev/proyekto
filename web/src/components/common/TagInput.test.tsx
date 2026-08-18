/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TagInput } from "./TagInput";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function setup(value: string[] = []) {
	const onChange = vi.fn();
	render(<TagInput value={value} onChange={onChange} />);
	return { onChange, input: screen.getByLabelText("Tags") };
}

describe("TagInput", () => {
	it("commits the pending text on Enter", () => {
		const { onChange, input } = setup();
		fireEvent.change(input, { target: { value: "design" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onChange).toHaveBeenCalledWith(["design"]);
	});

	it("commits on a comma keypress", () => {
		const { onChange, input } = setup();
		fireEvent.change(input, { target: { value: "growth" } });
		fireEvent.keyDown(input, { key: "," });
		expect(onChange).toHaveBeenCalledWith(["growth"]);
	});

	/**
	 * The case that actually loses user data: someone types a label, then clicks
	 * Save/Next without pressing Enter. Without a blur commit the label vanishes
	 * and nothing tells them.
	 */
	it("commits pending text on blur", () => {
		const { onChange, input } = setup();
		fireEvent.change(input, { target: { value: "onboarding" } });
		fireEvent.blur(input);
		expect(onChange).toHaveBeenCalledWith(["onboarding"]);
	});

	it("ignores a duplicate that differs only in casing", () => {
		const { onChange, input } = setup(["Design"]);
		fireEvent.change(input, { target: { value: "design" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onChange).not.toHaveBeenCalled();
	});

	it("removes the last chip on Backspace in an empty field", () => {
		const { onChange, input } = setup(["alpha", "beta"]);
		fireEvent.keyDown(input, { key: "Backspace" });
		expect(onChange).toHaveBeenCalledWith(["alpha"]);
	});

	it("splits a pasted, comma-separated list", () => {
		const { onChange, input } = setup();
		fireEvent.paste(input, {
			clipboardData: { getData: () => "a, b, c" },
		});
		expect(onChange).toHaveBeenCalledWith(["a", "b", "c"]);
	});

	it("removes the chip whose X is clicked", () => {
		const { onChange } = setup(["alpha", "beta"]);
		fireEvent.click(screen.getByLabelText("Remove alpha"));
		expect(onChange).toHaveBeenCalledWith(["beta"]);
	});

	it("blocks further input once the cap is reached", () => {
		const full = Array.from({ length: 20 }, (_, i) => `tag-${i}`);
		const { input } = setup(full);
		expect((input as HTMLInputElement).disabled).toBe(true);
	});
});
