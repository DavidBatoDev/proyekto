/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewActions } from "./ReviewActions";
import { reviewButtons } from "./reviewModel";

afterEach(cleanup);

describe("ReviewActions", () => {
	it("renders the decider's buttons and reports presses", () => {
		const onAction = vi.fn();
		render(
			<ReviewActions
				buttons={reviewButtons(["approve", "return"], "submitted")}
				onAction={onAction}
			/>,
		);
		const group = screen.getByRole("group", { name: "Timesheet actions" });
		expect(group.textContent).toBe("Return…Approve…");
		fireEvent.click(screen.getByRole("button", { name: "Return…" }));
		fireEvent.click(screen.getByRole("button", { name: "Approve…" }));
		expect(onAction.mock.calls.map((c) => c[0])).toEqual(["return", "approve"]);
	});

	it("is a sticky bottom bar on phones", () => {
		render(
			<ReviewActions
				buttons={reviewButtons(["approve", "return"], "submitted")}
				onAction={() => {}}
				layout="bar"
			/>,
		);
		const bar = screen.getByTestId("review-action-bar");
		expect(bar.className).toMatch(/\bsticky\b/);
		expect(bar.className).toMatch(/\bbottom-0\b/);
	});

	it("holds every button while one runs or the sheet changed", () => {
		const { rerender } = render(
			<ReviewActions
				buttons={reviewButtons(["withdraw"], "submitted")}
				onAction={() => {}}
				busyId="withdraw"
			/>,
		);
		expect(
			(screen.getByRole("button", { name: "Withdraw" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		rerender(
			<ReviewActions
				buttons={reviewButtons(["approve", "return"], "submitted")}
				onAction={() => {}}
				disabledReason="Maria changed this timesheet while you were looking."
			/>,
		);
		const approve = screen.getByRole("button", {
			name: "Approve…",
		}) as HTMLButtonElement;
		expect(approve.disabled).toBe(true);
		expect(approve.title).toBe(
			"Maria changed this timesheet while you were looking.",
		);
	});

	it("renders nothing without actions", () => {
		const { container } = render(
			<ReviewActions buttons={[]} onAction={() => {}} />,
		);
		expect(container.textContent).toBe("");
	});
});
