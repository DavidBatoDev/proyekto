/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({
			children,
			to,
			params,
			search,
			className,
			...rest
		}: {
			children?: ReactNode;
			to: string;
			params?: Record<string, string>;
			search?: Record<string, string>;
			className?: string;
		}) => {
			let href = to;
			for (const [key, value] of Object.entries(params ?? {})) {
				href = href.replace(`$${key}`, value);
			}
			if (search) href += `?${new URLSearchParams(search).toString()}`;
			return createElement("a", { href, className, ...rest }, children);
		},
	};
});

import {
	AI_MESSAGE_CONTEXT_LABEL,
	AiMessage,
	type AiMessageProps,
} from "./AiMessage";
import { CONTEXT_ONLY_SPAN } from "./aiMentions";
import type { AiSessionScope } from "./scope";
import type { AiChatMessage, AiMentionSpan } from "./types";

afterEach(() => {
	cleanup();
});

const scope: AiSessionScope = {
	kind: "roadmap",
	roadmapId: "rm-1",
	projectId: "proj-1",
};

function userMessage(content: string, refs?: AiMentionSpan[]): AiChatMessage {
	return {
		id: "m1",
		role: "user",
		content,
		timestamp: "2026-09-05T10:00:00Z",
		...(refs ? { refs } : {}),
	};
}

function renderMessage(
	message: AiChatMessage,
	overrides: Partial<AiMessageProps> = {},
) {
	return render(
		<AiMessage
			message={message}
			scope={scope}
			threadId={null}
			isLatestMessage
			isSending={false}
			activityTimeline={null}
			isLiveTimelineHost={false}
			onSend={vi.fn()}
			{...overrides}
		/>,
	);
}

const EPIC_INLINE: AiMentionSpan = {
	kind: "epic",
	id: "e1",
	label: "Signup flow",
	roadmapId: "rm-1",
	projectId: "proj-1",
	offset: 4,
	length: 12,
};
const ROADMAP_CTX: AiMentionSpan = {
	kind: "roadmap",
	id: "rm-1",
	label: "Onboarding",
	roadmapId: "rm-1",
	projectId: "proj-1",
	...CONTEXT_ONLY_SPAN,
};
const PROJECT_CTX: AiMentionSpan = {
	kind: "project",
	id: "proj-1",
	label: "Client project",
	projectId: "proj-1",
	...CONTEXT_ONLY_SPAN,
};

describe("AiMessage user bubble context row", () => {
	it("lists context-only refs as deep-linked chips under the text", () => {
		const { container } = renderMessage(
			userMessage("Fix @Signup flow", [EPIC_INLINE, ROADMAP_CTX, PROJECT_CTX]),
		);
		// The inline mention still renders inside the text.
		const inline = container.querySelector("a[data-mention-kind='epic']");
		expect(inline?.textContent).toBe("@Signup flow");
		expect(inline?.getAttribute("href")).toBe(
			"/project/proj-1/roadmap/rm-1?nodeId=e1",
		);

		const row = screen.getByTestId("ai-message-context");
		expect(row.textContent).toContain(AI_MESSAGE_CONTEXT_LABEL);
		const links = Array.from(row.querySelectorAll("a"));
		expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
			["Onboarding", "/project/proj-1/roadmap/rm-1"],
			["Client project", "/project/proj-1/roadmap"],
		]);
		expect(links[0].className).toContain(
			"bg-primary-foreground/20 text-primary-foreground",
		);
		expect(links[0].getAttribute("data-mention-kind")).toBe("roadmap");
		expect(links[0].querySelector("svg")).toBeTruthy(); // kind icon
		expect(row.innerHTML).not.toMatch(/slate|gray|violet/);
		// The inline chip is not repeated in the context row.
		expect(row.querySelector("[data-mention-kind='epic']")).toBeNull();
	});

	it("renders no context row when every ref is inline or there are none", () => {
		renderMessage(userMessage("Fix @Signup flow", [EPIC_INLINE]));
		expect(screen.queryByTestId("ai-message-context")).toBeNull();
		cleanup();
		renderMessage(userMessage("plain"));
		expect(screen.queryByTestId("ai-message-context")).toBeNull();
		expect(screen.getByText("plain")).toBeTruthy();
	});

	it("renders an unlinkable ref as a plain chip", () => {
		const team: AiMentionSpan = {
			kind: "team",
			id: "tm1",
			label: "Platform",
			...CONTEXT_ONLY_SPAN,
		};
		renderMessage(userMessage("hello", [team]));
		const row = screen.getByTestId("ai-message-context");
		expect(row.querySelector("a")).toBeNull();
		expect(
			row.querySelector("span[data-mention-kind='team']")?.textContent,
		).toBe("Platform");
	});

	it("dedupes repeated context refs", () => {
		renderMessage(userMessage("hello", [ROADMAP_CTX, ROADMAP_CTX]));
		expect(
			screen
				.getByTestId("ai-message-context")
				.querySelectorAll("[data-mention-kind]"),
		).toHaveLength(1);
	});

	it("assistant turns have no context row", () => {
		renderMessage({
			id: "a1",
			role: "assistant",
			content: "Done.",
			timestamp: "2026-09-05T10:00:00Z",
			refs: [ROADMAP_CTX],
		});
		expect(screen.queryByTestId("ai-message-context")).toBeNull();
		expect(screen.getByText("Done.")).toBeTruthy();
	});
});
