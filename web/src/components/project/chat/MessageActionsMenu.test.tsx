/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageActionsMenu } from "./MessageActionsMenu";

describe("MessageActionsMenu", () => {
	afterEach(cleanup);

	it("offers Report message on someone else's message", () => {
		const onReport = vi.fn();
		render(
			<MessageActionsMenu
				isMine={false}
				canModify={false}
				hasText
				onReport={onReport}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
		fireEvent.click(screen.getByRole("menuitem", { name: /report message/i }));
		expect(onReport).toHaveBeenCalledTimes(1);
	});

	it("never offers Report on your own message", () => {
		render(
			<MessageActionsMenu
				isMine
				canModify
				hasText
				onReport={vi.fn()}
				onEdit={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
		expect(screen.queryByRole("menuitem", { name: /report/i })).toBeNull();
		expect(screen.getByRole("menuitem", { name: "Edit" })).toBeTruthy();
	});

	it("renders no button at all when there is nothing to offer", () => {
		render(<MessageActionsMenu isMine={false} canModify={false} hasText />);
		expect(
			screen.queryByRole("button", { name: "Message actions" }),
		).toBeNull();
	});
});
