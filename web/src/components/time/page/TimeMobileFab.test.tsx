/* @vitest-environment jsdom */

import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import { backStackDepth, handleBackPress } from "@/lib/backStack";
import { TIME_FAB_COPY, TimeMobileFab } from "./TimeMobileFab";

function renderFab() {
	const onStartTimer = vi.fn();
	const onAddTime = vi.fn();
	render(<TimeMobileFab onStartTimer={onStartTimer} onAddTime={onAddTime} />);
	const trigger = screen.getByRole("button", { name: TIME_FAB_COPY.trigger });
	return { onStartTimer, onAddTime, trigger };
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("TimeMobileFab", () => {
	it("is a phone-only button that opens Start timer and Add time", () => {
		const { trigger, onStartTimer, onAddTime } = renderFab();
		expect(screen.getByTestId("time-fab").className).toContain("sm:hidden");
		expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
		expect(trigger.getAttribute("aria-expanded")).toBe("false");

		fireEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		const items = screen.getAllByRole("menuitem").map((el) => el.textContent);
		expect(items).toEqual(["Start timer", "Add time"]);
		expect(document.activeElement?.textContent).toBe("Start timer");

		fireEvent.click(screen.getByRole("menuitem", { name: "Start timer" }));
		expect(onStartTimer).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole("menu")).toBeNull();

		fireEvent.click(trigger);
		fireEvent.click(screen.getByRole("menuitem", { name: "Add time" }));
		expect(onAddTime).toHaveBeenCalledTimes(1);
	});

	it("moves with the arrows and gives focus back on Escape", () => {
		const { trigger } = renderFab();
		trigger.focus();
		fireEvent.keyDown(trigger, { key: "ArrowUp" });
		expect(document.activeElement?.textContent).toBe("Add time");
		const menu = screen.getByRole("menu", { name: TIME_FAB_COPY.trigger });
		fireEvent.keyDown(menu, { key: "ArrowDown" });
		expect(document.activeElement?.textContent).toBe("Start timer");
		fireEvent.keyDown(menu, { key: "End" });
		expect(document.activeElement?.textContent).toBe("Add time");
		fireEvent.keyDown(menu, { key: "Escape" });
		expect(screen.queryByRole("menu")).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it("closes on the Android back button before back leaves the page", () => {
		const { trigger } = renderFab();
		expect(backStackDepth()).toBe(0);
		fireEvent.click(trigger);
		expect(backStackDepth()).toBe(1);
		let handled = false;
		act(() => {
			handled = handleBackPress();
		});
		expect(handled).toBe(true);
		expect(screen.queryByRole("menu")).toBeNull();
		expect(backStackDepth()).toBe(0);
	});

	it("closes on a click outside", () => {
		const { trigger } = renderFab();
		fireEvent.click(trigger);
		fireEvent.pointerDown(document.body);
		expect(screen.queryByRole("menu")).toBeNull();
	});
});
