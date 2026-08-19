import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { projectKeys } from "@/queries/project";
import type { Comment, NodeCommentSummary } from "@/types/roadmap";
import {
	applyCommentSummaryAuthoritative,
	applyCommentSummaryDelta,
	htmlToPlainExcerpt,
} from "./useRoadmapCommentSummary";

const ROADMAP = "rm-1";

describe("applyCommentSummaryDelta", () => {
	let queryClient: QueryClient;
	const key = projectKeys.roadmapCommentSummary(ROADMAP);

	const seed = (rows: NodeCommentSummary[]) =>
		queryClient.setQueryData(key, rows);
	const read = () => queryClient.getQueryData<NodeCommentSummary[]>(key);

	const row = (over: Partial<NodeCommentSummary> = {}): NodeCommentSummary => ({
		node_type: "task",
		node_id: "t-1",
		comment_count: 2,
		last_comment: {
			id: "c-2",
			created_at: "2026-08-19T10:00:00.000Z",
			author_id: "u-1",
			author_name: "Ada",
			excerpt: "second",
		},
		...over,
	});

	beforeEach(() => {
		queryClient = new QueryClient();
	});

	it("increments the count and takes the new comment as the preview", () => {
		seed([row()]);

		applyCommentSummaryDelta(queryClient, ROADMAP, "t-1", "task", {
			countDelta: 1,
			preview: {
				id: "c-3",
				created_at: "2026-08-19T11:00:00.000Z",
				author_id: "u-2",
				author_name: "Bob",
				excerpt: "third",
			},
		});

		expect(read()?.[0].comment_count).toBe(3);
		expect(read()?.[0].last_comment?.excerpt).toBe("third");
	});

	it("returns the previous rows so a failed write can roll back", () => {
		const before = [row()];
		seed(before);

		const snapshot = applyCommentSummaryDelta(
			queryClient,
			ROADMAP,
			"t-1",
			"task",
			{ countDelta: 1 },
		);
		expect(read()?.[0].comment_count).toBe(3);

		queryClient.setQueryData(key, snapshot);
		expect(read()?.[0].comment_count).toBe(2);
	});

	it("leaves the preview alone when none is supplied", () => {
		seed([row()]);

		applyCommentSummaryDelta(queryClient, ROADMAP, "t-1", "task", {
			countDelta: -1,
		});

		expect(read()?.[0].comment_count).toBe(1);
		expect(read()?.[0].last_comment?.id).toBe("c-2");
	});

	it("clears the preview when the deleted comment WAS the preview", () => {
		// Showing no preview for one round-trip is honest; guessing the previous
		// comment would display something that is not actually the latest.
		seed([row()]);

		applyCommentSummaryDelta(queryClient, ROADMAP, "t-1", "task", {
			countDelta: -1,
			clearPreview: true,
		});

		expect(read()?.[0].last_comment).toBeNull();
	});

	it("never drives a count below zero", () => {
		seed([row({ comment_count: 0, last_comment: null })]);

		applyCommentSummaryDelta(queryClient, ROADMAP, "t-1", "task", {
			countDelta: -1,
		});

		expect(read()?.[0].comment_count).toBe(0);
	});

	it("adds a row for a node the summary has never seen", () => {
		seed([row()]);

		applyCommentSummaryDelta(queryClient, ROADMAP, "e-9", "epic", {
			countDelta: 1,
		});

		const added = read()?.find((r) => r.node_id === "e-9");
		expect(added).toMatchObject({ node_type: "epic", comment_count: 1 });
	});

	it("is a no-op when the summary has not been fetched", () => {
		// The flag may be off, in which case there is no cache entry to patch and
		// patching one would create a phantom the query never asked for.
		expect(
			applyCommentSummaryDelta(queryClient, ROADMAP, "t-1", "task", {
				countDelta: 1,
			}),
		).toBeUndefined();
		expect(read()).toBeUndefined();
	});
});

describe("applyCommentSummaryAuthoritative", () => {
	const key = projectKeys.roadmapCommentSummary(ROADMAP);

	const comment = (id: string, content: string): Comment =>
		({
			id,
			user_id: "u-1",
			author_id: "u-1",
			content,
			created_at: "2026-08-19T12:00:00.000Z",
			updated_at: "2026-08-19T12:00:00.000Z",
			user: { id: "u-1", display_name: "Ada" },
		}) as Comment;

	it("takes the LAST comment as the preview, since the list renders oldest-first", () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(key, [
			{
				node_type: "task",
				node_id: "t-1",
				comment_count: 0,
				last_comment: null,
			},
		]);

		applyCommentSummaryAuthoritative(queryClient, ROADMAP, "t-1", "task", [
			comment("c-1", "<p>first</p>"),
			comment("c-2", "<p>latest</p>"),
		]);

		const rows = queryClient.getQueryData<NodeCommentSummary[]>(key);
		expect(rows?.[0].comment_count).toBe(2);
		expect(rows?.[0].last_comment?.id).toBe("c-2");
		expect(rows?.[0].last_comment?.excerpt).toBe("latest");
	});

	it("heals a drifted count back to the real list length", () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(key, [
			{
				node_type: "task",
				node_id: "t-1",
				comment_count: 99,
				last_comment: null,
			},
		]);

		applyCommentSummaryAuthoritative(queryClient, ROADMAP, "t-1", "task", [
			comment("c-1", "only"),
		]);

		expect(
			queryClient.getQueryData<NodeCommentSummary[]>(key)?.[0].comment_count,
		).toBe(1);
	});
});

describe("htmlToPlainExcerpt", () => {
	it("strips tags but keeps the words", () => {
		expect(htmlToPlainExcerpt("<p>Blocked on <b>Stripe</b></p>")).toBe(
			"Blocked on Stripe",
		);
	});

	it("drops a trailing partial tag rather than leaking it", () => {
		expect(htmlToPlainExcerpt('Blocked <span class="men')).toBe("Blocked");
	});

	it("removes script content entirely", () => {
		const out = htmlToPlainExcerpt("hi <script>alert(1)</script> there");
		expect(out).not.toContain("alert");
		expect(out).not.toContain("<");
	});

	it("truncates with an ellipsis past the limit", () => {
		expect(htmlToPlainExcerpt("abcdefghij", 5)).toBe("abcde…");
	});
});
