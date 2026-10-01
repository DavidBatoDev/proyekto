/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLongPress } from "./useLongPress";

function Target({ onLongPress }: { onLongPress: () => void }) {
	const handlers = useLongPress(onLongPress, 450);
	return <div data-testid="target" {...handlers} />;
}

const press = (type: string, pointerType: string, x = 0, y = 0) =>
	fireEvent(
		screen.getByTestId("target"),
		Object.assign(new Event(type, { bubbles: true }), {
			pointerType,
			clientX: x,
			clientY: y,
		}),
	);

describe("useLongPress", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it("fires after a held touch", () => {
		const onLongPress = vi.fn();
		render(<Target onLongPress={onLongPress} />);
		press("pointerdown", "touch");
		vi.advanceTimersByTime(460);
		expect(onLongPress).toHaveBeenCalledTimes(1);
	});

	it("does not fire for a quick tap", () => {
		const onLongPress = vi.fn();
		render(<Target onLongPress={onLongPress} />);
		press("pointerdown", "touch");
		vi.advanceTimersByTime(200);
		press("pointerup", "touch");
		vi.advanceTimersByTime(400);
		expect(onLongPress).not.toHaveBeenCalled();
	});

	it("does not fire when the finger moves (a scroll)", () => {
		const onLongPress = vi.fn();
		render(<Target onLongPress={onLongPress} />);
		press("pointerdown", "touch", 0, 0);
		press("pointermove", "touch", 0, 40);
		vi.advanceTimersByTime(500);
		expect(onLongPress).not.toHaveBeenCalled();
	});

	it("ignores the mouse, which keeps its hover menu", () => {
		const onLongPress = vi.fn();
		render(<Target onLongPress={onLongPress} />);
		press("pointerdown", "mouse");
		vi.advanceTimersByTime(500);
		expect(onLongPress).not.toHaveBeenCalled();
	});
});
