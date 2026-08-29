/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoSizingTaskTitle } from "./SidePanel";

beforeEach(() => {
	vi.spyOn(
		HTMLTextAreaElement.prototype,
		"scrollHeight",
		"get",
	).mockReturnValue(84);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("AutoSizingTaskTitle", () => {
	it("grows to show the complete wrapped task title", () => {
		render(
			<AutoSizingTaskTitle
				value="A task title long enough to wrap over several rendered lines"
				onChange={vi.fn()}
			/>,
		);

		const textarea = screen.getByRole("textbox");
		expect(textarea.style.height).toBe("84px");
		expect(screen.queryByRole("button", { name: /view more/i })).toBeNull();
	});

	it("keeps the task title single-value while allowing visual wrapping", () => {
		const onChange = vi.fn();
		render(<AutoSizingTaskTitle value="Task" onChange={onChange} />);

		fireEvent.change(screen.getByRole("textbox"), {
			target: { value: "First line\nSecond line" },
		});
		expect(onChange).toHaveBeenCalledWith("First line Second line");
	});
});
