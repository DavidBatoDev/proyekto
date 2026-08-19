/* @vitest-environment jsdom */

import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommentPreview } from "@/types/roadmap";
import { CommentPreviewPopover } from "./CommentPreviewPopover";

const preview: CommentPreview = {
	id: "c-1",
	created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
	author_id: "u-2",
	author_name: "Ada Lovelace",
	excerpt: "Blocked until the test key lands.",
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	cleanup();
});

function setup(
	over: Partial<React.ComponentProps<typeof CommentPreviewPopover>> = {},
) {
	return render(
		<CommentPreviewPopover
			preview={preview}
			commentCount={3}
			contextTitle="Integrate Stripe SDK"
			{...over}
		>
			<button type="button">3</button>
		</CommentPreviewPopover>,
	);
}

/** The popover waits out a hover-intent delay before opening. */
const hover = (el: HTMLElement) => {
	fireEvent.mouseEnter(el);
	act(() => {
		vi.advanceTimersByTime(300);
	});
};

describe("CommentPreviewPopover", () => {
	it("stays closed until the hover-intent delay elapses", () => {
		const { container } = setup();
		const wrapper = container.firstElementChild as HTMLElement;

		fireEvent.mouseEnter(wrapper);
		expect(screen.queryByRole("tooltip")).toBeNull();

		act(() => {
			vi.advanceTimersByTime(300);
		});
		expect(screen.getByRole("tooltip")).toBeTruthy();
	});

	it("shows the author, the excerpt and the context title", () => {
		const { container } = setup();
		hover(container.firstElementChild as HTMLElement);

		const tip = screen.getByRole("tooltip");
		expect(tip.textContent).toContain("Ada Lovelace");
		expect(tip.textContent).toContain("Blocked until the test key lands.");
		expect(tip.textContent).toContain("Integrate Stripe SDK");
		expect(tip.textContent).toContain("ago");
	});

	it("renders the excerpt as text, never as markup", () => {
		const { container } = setup({
			preview: { ...preview, excerpt: "<img src=x onerror=alert(1)>" },
		});
		hover(container.firstElementChild as HTMLElement);

		const tip = screen.getByRole("tooltip");
		expect(tip.querySelector("img")).toBeNull();
		expect(tip.textContent).toContain("<img src=x onerror=alert(1)>");
	});

	it("never opens when there is no preview to show", () => {
		const { container } = setup({ preview: null, commentCount: 0 });
		hover(container.firstElementChild as HTMLElement);

		expect(screen.queryByRole("tooltip")).toBeNull();
	});

	it("closes on mouse leave and on Escape", () => {
		const { container } = setup();
		const wrapper = container.firstElementChild as HTMLElement;

		hover(wrapper);
		fireEvent.mouseLeave(wrapper);
		expect(screen.queryByRole("tooltip")).toBeNull();

		hover(wrapper);
		expect(screen.getByRole("tooltip")).toBeTruthy();
		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByRole("tooltip")).toBeNull();
	});

	it("opens on keyboard focus, so the preview is not mouse-only", () => {
		const { container } = setup();
		const wrapper = container.firstElementChild as HTMLElement;

		fireEvent.focus(wrapper);
		act(() => {
			vi.advanceTimersByTime(300);
		});

		expect(screen.getByRole("tooltip")).toBeTruthy();
	});

	it("omits the count line for a single comment", () => {
		const { container } = setup({ commentCount: 1 });
		hover(container.firstElementChild as HTMLElement);

		expect(screen.getByRole("tooltip").textContent).not.toContain("comments");
	});
});
