/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import { TimePageHeader, waitingPillText } from "./TimePageHeader";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("TimePageHeader", () => {
	it("titles the page Time", () => {
		render(<TimePageHeader />);
		expect(
			screen.getByRole("heading", { level: 1, name: "Time" }),
		).toBeTruthy();
	});

	it("shows the Waiting pill only while something waits, and it scrolls there", () => {
		const onShowWaiting = vi.fn();
		const { rerender } = render(
			<TimePageHeader waitingCount={0} onShowWaiting={onShowWaiting} />,
		);
		expect(screen.queryByTestId("waiting-pill")).toBeNull();
		rerender(<TimePageHeader waitingCount={3} onShowWaiting={onShowWaiting} />);
		const pill = screen.getByRole("link", { name: "Waiting for you · 3" });
		expect(pill.getAttribute("href")).toBe("#waiting");
		fireEvent.click(pill);
		expect(onShowWaiting).toHaveBeenCalledTimes(1);
		expect(waitingPillText(12)).toBe("Waiting for you · 12");
	});

	it("puts the approver-mode action on the right", () => {
		render(
			<TimePageHeader action={<button type="button">Start timer</button>} />,
		);
		expect(screen.getByRole("button", { name: "Start timer" })).toBeTruthy();
	});
});
