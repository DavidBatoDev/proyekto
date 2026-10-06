/* @vitest-environment jsdom */

import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DateTimeField, type DateTimeFieldProps } from "./DateTimeField";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function Field(
	props: Partial<DateTimeFieldProps> & { onValue?: (v: string) => void },
) {
	const { onValue, ...rest } = props;
	const [value, setValue] = useState(rest.value ?? "2026-10-06T14:30");
	return (
		<DateTimeField
			ariaLabel="Start"
			{...rest}
			value={value}
			onChange={(next) => {
				setValue(next);
				onValue?.(next);
			}}
		/>
	);
}

function timeInput() {
	return screen.getByLabelText("Start time") as HTMLInputElement;
}

function openSlots(): string[] {
	fireEvent.focus(timeInput());
	const list = screen.getByRole("dialog", { name: "Time options" });
	return within(list)
		.getAllByRole("button")
		.map((b) => b.textContent ?? "");
}

describe("DateTimeField", () => {
	it("reads 12-hour times by default (meetings keep this)", () => {
		render(<Field />);
		expect(timeInput().value).toBe("2:30 PM");
		expect(timeInput().placeholder).toBe("9:00 AM");
		expect(openSlots().slice(0, 2)).toEqual(["12:00 AM", "12:15 AM"]);
	});

	it('hourCycle="h23" reads the 24-hour clock, options from 00:00', () => {
		render(<Field hourCycle="h23" value="2026-10-06T09:00" />);
		expect(timeInput().value).toBe("09:00");
		expect(timeInput().placeholder).toBe("09:00");
		const slots = openSlots();
		expect(slots.slice(0, 3)).toEqual(["00:00", "00:15", "00:30"]);
		expect(slots.at(-1)).toBe("23:45");
		expect(slots.some((s) => /AM|PM/.test(s))).toBe(false);
	});

	it("h23 still accepts a typed 12-hour time, and shows it as 24-hour", () => {
		const onValue = vi.fn();
		render(<Field hourCycle="h23" onValue={onValue} />);
		const input = timeInput();
		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "2:45 pm" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onValue).toHaveBeenLastCalledWith("2026-10-06T14:45");
		expect(input.value).toBe("14:45");
		fireEvent.focus(input);
		fireEvent.change(input, { target: { value: "0930" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onValue).toHaveBeenLastCalledWith("2026-10-06T09:30");
		expect(input.value).toBe("09:30");
	});

	it("picking a slot in h23 writes HH:mm and shows it as 24-hour", () => {
		const onValue = vi.fn();
		render(<Field hourCycle="h23" onValue={onValue} />);
		fireEvent.focus(timeInput());
		const list = screen.getByRole("dialog", { name: "Time options" });
		fireEvent.click(within(list).getByRole("button", { name: "17:15" }));
		expect(onValue).toHaveBeenLastCalledWith("2026-10-06T17:15");
		expect(timeInput().value).toBe("17:15");
	});

	it("shows the whole date on the date button", () => {
		render(<Field hourCycle="h23" />);
		expect(screen.getByRole("button", { name: "Start date" }).textContent).toBe(
			"Tue, Oct 6, 2026",
		);
	});
});
