/* @vitest-environment jsdom */

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	listener: null as null | ((e: { canGoBack: boolean }) => void),
	minimizeApp: vi.fn(() => Promise.resolve()),
}));

vi.mock("@capacitor/app", () => ({
	App: {
		addListener: vi.fn(
			(_event: string, cb: (e: { canGoBack: boolean }) => void) => {
				mocks.listener = cb;
				return Promise.resolve({ remove: vi.fn() });
			},
		),
		minimizeApp: mocks.minimizeApp,
	},
}));

import {
	backStackDepth,
	handleBackPress,
	installBackButtonHandler,
	pushBackHandler,
	useBackHandler,
} from "./backStack";

afterEach(() => {
	vi.clearAllMocks();
	expect(backStackDepth()).toBe(0);
});

describe("back stack", () => {
	it("closes the topmost overlay first (a confirm over a panel)", () => {
		const closed: string[] = [];
		const offPanel = pushBackHandler(() => closed.push("panel"));
		const offConfirm = pushBackHandler(() => closed.push("confirm"));

		expect(handleBackPress()).toBe(true);
		expect(closed).toEqual(["confirm"]);

		offConfirm();
		expect(handleBackPress()).toBe(true);
		expect(closed).toEqual(["confirm", "panel"]);
		offPanel();
	});

	it("reports nothing handled when no overlay is open", () => {
		expect(handleBackPress()).toBe(false);
	});

	it("useBackHandler registers only while active and uses the latest callback", () => {
		const first = vi.fn();
		const second = vi.fn();
		const { rerender, unmount } = renderHook(
			({ active, fn }) => useBackHandler(active, fn),
			{ initialProps: { active: false, fn: first } },
		);
		expect(backStackDepth()).toBe(0);

		rerender({ active: true, fn: first });
		expect(backStackDepth()).toBe(1);

		rerender({ active: true, fn: second });
		expect(backStackDepth()).toBe(1); // no re-registration
		handleBackPress();
		expect(second).toHaveBeenCalledTimes(1);
		expect(first).not.toHaveBeenCalled();

		rerender({ active: false, fn: second });
		expect(backStackDepth()).toBe(0);
		unmount();
	});
});

describe("installBackButtonHandler", () => {
	it("closes an open overlay instead of navigating", async () => {
		await installBackButtonHandler();
		const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
		const close = vi.fn();
		const off = pushBackHandler(close);

		mocks.listener?.({ canGoBack: true });

		expect(close).toHaveBeenCalledTimes(1);
		expect(back).not.toHaveBeenCalled();
		off();
		back.mockRestore();
	});

	it("goes back when nothing is open and there is history", async () => {
		await installBackButtonHandler();
		const back = vi.spyOn(window.history, "back").mockImplementation(() => {});

		mocks.listener?.({ canGoBack: true });

		expect(back).toHaveBeenCalledTimes(1);
		expect(mocks.minimizeApp).not.toHaveBeenCalled();
		back.mockRestore();
	});

	it("minimizes the app at a root screen", async () => {
		await installBackButtonHandler();
		mocks.listener?.({ canGoBack: false });
		expect(mocks.minimizeApp).toHaveBeenCalledTimes(1);
	});
});
