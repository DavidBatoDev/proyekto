/* @vitest-environment jsdom */

import {
	act,
	cleanup,
	fireEvent,
	render,
	renderHook,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	loadTimeView,
	storeTimeView,
	TIME_VIEW_STORAGE_KEY,
	TimeViewToggle,
	useTimeViewMode,
} from "./TimeViewToggle";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	try {
		localStorage.clear();
	} catch {
		// ignore
	}
});

describe("TimeViewToggle", () => {
	it("shows List and Month and reports a change", () => {
		const onChange = vi.fn();
		render(<TimeViewToggle value="list" onChange={onChange} />);
		const list = screen.getByRole("button", { name: "List" });
		const month = screen.getByRole("button", { name: "Month" });
		expect(list.getAttribute("aria-pressed")).toBe("true");
		expect(month.getAttribute("aria-pressed")).toBe("false");
		fireEvent.click(list);
		expect(onChange).not.toHaveBeenCalled();
		fireEvent.click(month);
		expect(onChange).toHaveBeenCalledWith("month");
	});

	it("can be disabled", () => {
		const onChange = vi.fn();
		render(<TimeViewToggle value="list" onChange={onChange} disabled />);
		fireEvent.click(screen.getByRole("button", { name: "Month" }));
		expect(onChange).not.toHaveBeenCalled();
	});
});

describe("remembered view", () => {
	it("stores the person's own view under the `me` key", () => {
		expect(TIME_VIEW_STORAGE_KEY).toBe("timeView:me");
		expect(loadTimeView()).toBe("list");
		storeTimeView("month");
		expect(localStorage.getItem("timeView:me")).toBe("month");
		expect(loadTimeView()).toBe("month");
		localStorage.setItem("timeView:me", "calendar");
		expect(loadTimeView()).toBe("list");
	});

	it("falls back to List when storage throws", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		expect(loadTimeView()).toBe("list");
		expect(() => storeTimeView("month")).not.toThrow();
		const { result } = renderHook(() => useTimeViewMode());
		act(() => result.current[1]("month"));
		expect(result.current[0]).toBe("month");
	});

	it("useTimeViewMode reads and writes the stored view", () => {
		localStorage.setItem("timeView:me", "month");
		const { result } = renderHook(() => useTimeViewMode());
		expect(result.current[0]).toBe("month");
		act(() => result.current[1]("list"));
		expect(result.current[0]).toBe("list");
		expect(localStorage.getItem("timeView:me")).toBe("list");
	});
});
