/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RoadmapAiChatMessage } from "./useRoadmapAiAssistantSession";
import { useRoadmapAiAssistantSession } from "./useRoadmapAiAssistantSession";

function userMessage(id: string, content: string): RoadmapAiChatMessage {
	return {
		id,
		role: "user",
		content,
		timestamp: "2026-07-29T08:00:00.000Z",
	};
}

describe("useRoadmapAiAssistantSession thread targeting", () => {
	it("keeps the first optimistic message when a new thread becomes active", () => {
		const roadmapId = "roadmap-first-message";
		const threadId = "thread-first-message";
		const message = userMessage("message-first", "Create an onboarding epic");
		const { result, rerender } = renderHook(
			({ activeThreadId }: { activeThreadId: string | null }) =>
				useRoadmapAiAssistantSession(roadmapId, activeThreadId),
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
		const roadmapId = "roadmap-thread-switch";
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
				useRoadmapAiAssistantSession(roadmapId, activeThreadId),
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
