/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { Comment } from "@/types/roadmap";
import { CommentsSection } from "./CommentsSection";

afterEach(() => {
	window.getSelection()?.removeAllRanges();
	cleanup();
});

it("preserves selected comment text when the panel rerenders with refreshed comments", () => {
	const comment = {
		id: "comment-1",
		user_id: "user-1",
		content: "<p>Copy this text</p><p>Another paragraph</p>",
		created_at: "2026-09-06T12:00:00Z",
		updated_at: "2026-09-06T12:00:00Z",
	} satisfies Comment;
	const props = {
		comments: [comment],
		canComment: false,
		onAddComment: async () => {},
	};
	const { rerender } = render(<CommentsSection {...props} />);
	const text = screen.getByText("Copy this text").firstChild!;
	const range = document.createRange();
	range.setStart(text, 0);
	range.setEnd(text, 9);
	window.getSelection()?.addRange(range);
	expect(window.getSelection()?.toString()).toBe("Copy this");
	rerender(<CommentsSection {...props} comments={[{ ...comment }]} />);
	expect(window.getSelection()?.toString()).toBe("Copy this");
	expect(screen.getByText("Copy this text").firstChild).toBe(text);
	// A new comment or an update elsewhere must not interrupt copying either.
	rerender(
		<CommentsSection
			{...props}
			comments={[
				{ ...comment },
				{ ...comment, id: "comment-2", content: "<p>New reply</p>" },
			]}
		/>,
	);
	expect(window.getSelection()?.toString()).toBe("Copy this");
	// Actual edits still replace the displayed content.
	rerender(
		<CommentsSection
			{...props}
			comments={[{ ...comment, content: "<p>Edited comment</p>" }]}
		/>,
	);
	expect(screen.queryByText("Copy this text")).toBeNull();
	expect(screen.getByText("Edited comment")).toBeTruthy();
});
