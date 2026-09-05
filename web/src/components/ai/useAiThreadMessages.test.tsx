/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AiMessage } from "@/services/ai-sessions.service";
import type { AiSessionScope } from "./scope";
import type { AiChatMessage } from "./types";
import {
	dbRowToClientMessage,
	useAiThreadMessages,
} from "./useAiThreadMessages";

function userMessage(id: string, content: string): AiChatMessage {
	return {
		id,
		role: "user",
		content,
		timestamp: "2026-07-29T08:00:00.000Z",
	};
}

function dbRow(overrides: Partial<AiMessage> = {}): AiMessage {
	return {
		id: "m1",
		session_id: "t1",
		seq: 1,
		role: "assistant",
		content: "Done",
		intent_type: "roadmap_edit",
		response_mode: "edit_plan",
		parse_mode: "run_report",
		artifacts: null,
		activity_timeline: null,
		commit_lifecycle: null,
		tokens: null,
		metadata: {},
		created_at: "2026-09-04T10:00:00.000Z",
		...overrides,
	};
}

describe("useAiThreadMessages thread targeting", () => {
	const scope: AiSessionScope = {
		kind: "roadmap",
		roadmapId: "roadmap-first-message",
		projectId: "n",
	};

	it("keeps the first optimistic message when a new thread becomes active", () => {
		const threadId = "thread-first-message";
		const message = userMessage("message-first", "Create an onboarding epic");
		const { result, rerender } = renderHook(
			({ activeThreadId }: { activeThreadId: string | null }) =>
				useAiThreadMessages(scope, activeThreadId),
			{ initialProps: { activeThreadId: null as string | null } },
		);

		act(() => {
			result.current.markThreadHydrated(threadId);
			result.current.appendMessage(threadId, message);
		});
		rerender({ activeThreadId: threadId });

		expect(result.current.isLoading).toBe(false);
		expect(result.current.messages).toEqual([message]);
	});

	it("writes an in-flight turn to its captured thread instead of the visible thread", () => {
		const switchScope: AiSessionScope = {
			kind: "roadmap",
			roadmapId: "roadmap-thread-switch",
			projectId: "n",
		};
		const originalThreadId = "thread-original";
		const visibleThreadId = "thread-visible";
		const originalMessage = userMessage(
			"message-original",
			"Keep this in the original thread",
		);
		const visibleMessage = userMessage(
			"message-visible",
			"This belongs to the visible thread",
		);
		const { result, rerender } = renderHook(
			({ activeThreadId }: { activeThreadId: string | null }) =>
				useAiThreadMessages(switchScope, activeThreadId),
			{ initialProps: { activeThreadId: null as string | null } },
		);

		act(() => {
			result.current.markThreadHydrated(originalThreadId);
			result.current.markThreadHydrated(visibleThreadId);
			result.current.appendMessage(originalThreadId, originalMessage);
			result.current.appendMessage(visibleThreadId, visibleMessage);
		});

		rerender({ activeThreadId: originalThreadId });
		expect(result.current.messages).toEqual([originalMessage]);

		rerender({ activeThreadId: visibleThreadId });
		expect(result.current.messages).toEqual([visibleMessage]);
	});
});

describe("dbRowToClientMessage", () => {
	it("reads mention refs and the run summary back from metadata", () => {
		const message = dbRowToClientMessage(
			dbRow({
				role: "user",
				metadata: {
					refs: [
						{
							kind: "roadmap",
							id: "rm-2",
							label: "Beta",
							offset: 3,
							length: 5,
							roadmapId: "rm-2",
							projectId: null,
						},
						{ kind: "bogus", id: "x", label: "y", offset: 0, length: 1 },
					],
					run: {
						run_id: "run-1",
						phase: "verify",
						status: "done",
						commits: [
							{
								batch_id: "b1",
								roadmap_id: "rm-2",
								status: "committed",
								operations_count: 1,
							},
							{ not: "a commit" },
						],
					},
				},
			}),
		);
		expect(message.refs).toEqual([
			{
				kind: "roadmap",
				id: "rm-2",
				label: "Beta",
				offset: 3,
				length: 5,
				roadmapId: "rm-2",
				projectId: null,
			},
		]);
		expect(message.runId).toBe("run-1");
		expect(message.commits).toEqual([
			{
				batch_id: "b1",
				roadmap_id: "rm-2",
				status: "committed",
				operations_count: 1,
			},
		]);
	});

	it("maps system rows to the assistant role and keeps legacy card metadata", () => {
		const message = dbRowToClientMessage(
			dbRow({
				role: "system",
				metadata: {
					clarifier: {
						lane: "edit",
						question_id: "q1",
						question: "Which?",
						options: ["A"],
						allow_custom: true,
					},
				},
				commit_lifecycle: {
					state: "committed",
					impactedItems: [],
					updatedAt: "2026-09-04T10:00:00.000Z",
				},
			}),
		);
		expect(message.role).toBe("assistant");
		expect(message.clarifier?.question_id).toBe("q1");
		expect(message.commitLifecycle?.state).toBe("committed");
		expect(message.refs).toBeUndefined();
		expect(message.commits).toBeUndefined();
	});
});
