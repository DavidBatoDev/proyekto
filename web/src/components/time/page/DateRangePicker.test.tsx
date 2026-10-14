/* @vitest-environment jsdom */

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import {
	beyondCap,
	DATE_PICKER_COPY,
	DateRangePicker,
	dayAriaLabel,
	monthWeeks,
	orderedRange,
	rangeTriggerLabel,
} from "./DateRangePicker";

const TODAY = "2026-10-06";
const WEEK = { start: "2026-10-05", end: "2026-10-11" };

function renderPicker(
	props: Partial<Parameters<typeof DateRangePicker>[0]> = {},
) {
	const onApply = vi.fn();
	const onPreset = vi.fn();
	const view = render(
		<DateRangePicker
			range={WEEK}
			preset="this_week"
			today={TODAY}
			onApply={onApply}
			onPreset={onPreset}
			{...props}
		/>,
	);
	return { ...view, onApply, onPreset };
}

const open = () => fireEvent.click(screen.getByTestId("time-range-trigger"));
const day = (label: string) => screen.getByRole("button", { name: label });
const header = () => screen.getByTestId("date-picker-header").textContent;

afterEach(() => cleanup());

describe("helpers", () => {
	it("lays months out Monday-first, padded to whole weeks", () => {
		const weeks = monthWeeks("2026-10-01");
		// Oct 1, 2026 is a Thursday: the grid starts Mon Sep 28.
		expect(weeks[0][0]).toBe("2026-09-28");
		expect(weeks[0][3]).toBe("2026-10-01");
		expect(weeks.at(-1)?.[6]).toBe("2026-11-01");
		expect(weeks.every((week) => week.length === 7)).toBe(true);
	});

	it("orders two picks, caps the end, and labels days", () => {
		expect(orderedRange("2026-10-20", "2026-10-14")).toEqual({
			start: "2026-10-14",
			end: "2026-10-20",
		});
		// 93 days inclusive: start + 92 is the last allowed day.
		expect(beyondCap("2026-10-01", "2027-01-01")).toBe(false);
		expect(beyondCap("2026-10-01", "2027-01-02")).toBe(true);
		expect(beyondCap("2026-10-01", "2026-06-30")).toBe(true);
		expect(dayAriaLabel("2026-10-06")).toBe("Tuesday, October 6, 2026");
	});

	it("names the preset on the trigger, else the dates", () => {
		expect(rangeTriggerLabel(WEEK, "this_week", TODAY)).toBe(
			"This week · Oct 5 – 11",
		);
		expect(
			rangeTriggerLabel(
				{ start: "2026-10-06", end: "2026-10-19" },
				null,
				TODAY,
			),
		).toBe("Oct 6 – 19, 2026");
		expect(
			rangeTriggerLabel(
				{ start: "2026-10-06", end: "2026-10-06" },
				"today",
				TODAY,
			),
		).toBe("Today · Oct 6");
	});
});

describe("DateRangePicker", () => {
	it("opens on two Monday-first months with the range shaded and today ringed", () => {
		renderPicker();
		open();
		const picker = screen.getByTestId("date-range-picker");
		const grids = within(picker).getAllByRole("grid");
		expect(grids).toHaveLength(2);
		expect(
			within(grids[0])
				.getAllByRole("columnheader")
				.map((th) => th.textContent),
		).toEqual(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]);
		expect(
			(screen.getByTestId("date-picker-month-0") as HTMLSelectElement).value,
		).toBe("10");
		expect(
			(screen.getByTestId("date-picker-month-1") as HTMLSelectElement).value,
		).toBe("11");
		expect(header()).toBe("Oct 5, 2026→Oct 11, 2026");
		// Start and end are filled circles, the days between the band.
		expect(day("Monday, October 5, 2026").getAttribute("data-endpoint")).toBe(
			"true",
		);
		expect(
			day("Wednesday, October 7, 2026")
				.closest("td")
				?.getAttribute("aria-selected"),
		).toBe("true");
		expect(
			day("Monday, October 12, 2026")
				.closest("td")
				?.getAttribute("aria-selected"),
		).toBe("false");
		expect(day("Tuesday, October 6, 2026").getAttribute("aria-current")).toBe(
			"date",
		);
		// The active preset is highlighted.
		expect(
			screen.getByTestId("date-preset-this_week").getAttribute("aria-pressed"),
		).toBe("true");
	});

	it("first click sets the start, the second the end (an earlier end swaps); Apply commits", () => {
		const { onApply } = renderPicker();
		open();
		fireEvent.click(day("Tuesday, October 20, 2026"));
		expect(header()).toBe(`Oct 20, 2026→${DATE_PICKER_COPY.end}`);
		fireEvent.click(day("Wednesday, October 14, 2026"));
		expect(header()).toBe("Oct 14, 2026→Oct 20, 2026");
		expect(onApply).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));
		expect(onApply).toHaveBeenCalledWith({
			start: "2026-10-14",
			end: "2026-10-20",
		});
		expect(screen.queryByTestId("date-range-picker")).toBeNull();
	});

	it("previews the range while hovering for the end", () => {
		renderPicker();
		open();
		fireEvent.click(day("Thursday, October 15, 2026"));
		fireEvent.mouseEnter(day("Monday, October 19, 2026"));
		const selected = (label: string) =>
			day(label).closest("td")?.getAttribute("aria-selected");
		expect(selected("Saturday, October 17, 2026")).toBe("true");
		expect(selected("Monday, October 19, 2026")).toBe("true");
		expect(selected("Tuesday, October 20, 2026")).toBe("false");
		// Hovering back before the start previews backwards.
		fireEvent.mouseEnter(day("Monday, October 12, 2026"));
		expect(selected("Tuesday, October 13, 2026")).toBe("true");
		expect(selected("Saturday, October 17, 2026")).toBe("false");
	});

	it("disables days past the 93-day cap while picking the end, with a hint", () => {
		renderPicker();
		open();
		expect(screen.getByTestId("date-picker-cap").className).toContain(
			"invisible",
		);
		fireEvent.click(day("Thursday, October 1, 2026"));
		expect(screen.getByTestId("date-picker-cap").className).not.toContain(
			"invisible",
		);
		fireEvent.click(screen.getByRole("button", { name: "Next month" }));
		fireEvent.click(screen.getByRole("button", { name: "Next month" }));
		// Now December and January: Jan 1 is day 93, Jan 2 is past it.
		expect((day("Friday, January 1, 2027") as HTMLButtonElement).disabled).toBe(
			false,
		);
		expect(
			(day("Saturday, January 2, 2027") as HTMLButtonElement).disabled,
		).toBe(true);
	});

	it("a preset applies at once; Cancel and Esc close without changes", () => {
		const { onApply, onPreset } = renderPicker();
		open();
		fireEvent.click(screen.getByTestId("date-preset-last_month"));
		expect(onPreset).toHaveBeenCalledWith("last_month");
		expect(screen.queryByTestId("date-range-picker")).toBeNull();
		open();
		fireEvent.click(day("Tuesday, October 20, 2026"));
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(screen.queryByTestId("date-range-picker")).toBeNull();
		open();
		// A fresh open starts from the range again.
		expect(header()).toBe("Oct 5, 2026→Oct 11, 2026");
		fireEvent.keyDown(screen.getByTestId("date-range-picker"), {
			key: "Escape",
		});
		expect(screen.queryByTestId("date-range-picker")).toBeNull();
		expect(onApply).not.toHaveBeenCalled();
	});

	it("moves focus with the arrow keys and pages months with the selects and arrows", async () => {
		renderPicker();
		open();
		await waitFor(() =>
			expect(document.activeElement).toBe(day("Monday, October 5, 2026")),
		);
		fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
		await waitFor(() =>
			expect(document.activeElement).toBe(day("Tuesday, October 6, 2026")),
		);
		fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
		await waitFor(() =>
			expect(document.activeElement).toBe(day("Tuesday, October 13, 2026")),
		);
		fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
		await waitFor(() =>
			expect(document.activeElement).toBe(day("Monday, October 12, 2026")),
		);
		// Only the focused day is a tab stop in its month.
		expect(day("Monday, October 12, 2026").tabIndex).toBe(0);
		expect(day("Tuesday, October 13, 2026").tabIndex).toBe(-1);
		fireEvent.change(screen.getByTestId("date-picker-year-0"), {
			target: { value: "2025" },
		});
		expect(
			(screen.getByTestId("date-picker-month-1") as HTMLSelectElement).value,
		).toBe("11");
		expect(
			(screen.getByTestId("date-picker-year-1") as HTMLSelectElement).value,
		).toBe("2025");
		fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
		expect(
			(screen.getByTestId("date-picker-month-0") as HTMLSelectElement).value,
		).toBe("9");
	});

	it("keeps Tab inside the picker", async () => {
		renderPicker();
		open();
		const picker = screen.getByTestId("date-range-picker");
		const apply = screen.getByRole("button", { name: "Apply" });
		apply.focus();
		fireEvent.keyDown(apply, { key: "Tab" });
		expect(picker.contains(document.activeElement)).toBe(true);
		expect(document.activeElement).not.toBe(apply);
	});

	it("is a bottom sheet with one month and preset chips on phones", () => {
		const { onApply } = renderPicker({ compact: true, preset: null });
		open();
		const picker = screen.getByTestId("date-range-picker");
		expect(within(picker).getAllByRole("grid")).toHaveLength(1);
		const chips = within(
			screen.getByTestId("date-picker-presets"),
		).getAllByRole("button");
		expect(chips.map((chip) => chip.textContent)).toEqual([
			"Today",
			"Yesterday",
			"This week",
			"Last week",
			"This month",
			"Last month",
			"Last 30 days",
		]);
		fireEvent.click(day("Thursday, October 8, 2026"));
		// One click then Apply: a one-day range.
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));
		expect(onApply).toHaveBeenCalledWith({
			start: "2026-10-08",
			end: "2026-10-08",
		});
	});
});
