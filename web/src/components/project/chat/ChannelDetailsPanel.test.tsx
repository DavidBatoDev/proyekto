/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatRoom } from "@/services/chat.service";
import { ChannelDetailsPanel } from "./ChannelDetailsPanel";

const { useChannelMembersQuery } = vi.hoisted(() => ({
	useChannelMembersQuery: vi.fn(),
}));

vi.mock("@/hooks/useChatQueries", () => ({
	useChannelMembersQuery,
	useLeaveChannelMutation: () => ({ mutate: vi.fn(), isPending: false }),
	useRemoveChannelMemberMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

// The modals own their own queries; this suite is about which controls the
// panel offers, not what they open.
vi.mock("./AddChannelMembersModal", () => ({
	AddChannelMembersModal: () => null,
}));
vi.mock("./ChannelSettingsModal", () => ({ ChannelSettingsModal: () => null }));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const room = (isPrivate: boolean): ChatRoom =>
	({
		id: "room-1",
		project_id: "project-1",
		type: "channel",
		slug: "design-review",
		name: "Design Review",
		is_private: isPrivate,
		is_archived: false,
		created_at: "2026-09-01T00:00:00.000Z",
		updated_at: "2026-09-01T00:00:00.000Z",
		last_message: null,
		participants: [],
	}) satisfies ChatRoom;

const members = [
	{ user_id: "user-1", user: { display_name: "Ada" } },
	{ user_id: "user-2", user: { display_name: "Grace" } },
];

function renderPanel(isPrivate: boolean) {
	useChannelMembersQuery.mockReturnValue({
		data: members,
		isPending: false,
	});

	return render(
		<ChannelDetailsPanel
			projectId="project-1"
			room={room(isPrivate)}
			// A project member who is not in the channel, so "Add" has something to
			// offer and its absence on a public channel means something.
			members={
				[
					{ user_id: "user-3", user: { display_name: "Alan" } },
				] as unknown as never
			}
			currentUserId="user-1"
			canManage
			isOpen
			onToggle={() => {}}
			onClose={() => {}}
			onExitChannel={() => {}}
		/>,
	);
}

describe("ChannelDetailsPanel", () => {
	it("offers no membership controls on a public channel", () => {
		renderPanel(false);

		// Every project member can already see a public channel, so Add would
		// pre-create a row the next sidebar load writes anyway and Remove is
		// undone by that same load.
		expect(screen.queryByRole("button", { name: /add/i })).toBeNull();
		expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
		expect(screen.queryByRole("button", { name: /leave channel/i })).toBeNull();
	});

	it("says the roster is the audience on a public channel", () => {
		renderPanel(false);

		expect(
			screen.getByText(/Channel · everyone in the project \(2\)/),
		).toBeTruthy();
		expect(screen.getByText(/Make it private in settings/)).toBeTruthy();
	});

	it("offers the full membership controls on a private channel", () => {
		renderPanel(true);

		expect(screen.getByRole("button", { name: /add/i })).toBeTruthy();
		expect(screen.getAllByRole("button", { name: /remove/i })).toHaveLength(2);
		expect(screen.getByRole("button", { name: /leave channel/i })).toBeTruthy();
		expect(screen.getByText(/Private channel · 2 members/)).toBeTruthy();
	});
});
