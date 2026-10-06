/* @vitest-environment jsdom */

/**
 * AddTeamMemberDialog (W3-review-b #2): adding someone from an attached team
 * gives them project access, so they can log time here. The time keys that
 * depend on who can log are refreshed, as on the remove paths.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));
vi.mock("@/hooks/useConfirm", () => ({
	useConfirm: () => () => Promise.resolve(true),
}));
vi.mock("@/components/common/Avatar", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	Avatar: () => null,
}));
vi.mock("@/services/teams.service", () => ({
	addCuratedMember: vi.fn(),
	listAvailableTeamMembers: vi.fn(),
}));

import {
	addCuratedMember,
	listAvailableTeamMembers,
} from "@/services/teams.service";
import { AddTeamMemberDialog } from "./AddTeamMemberDialog";

const WHO_CAN_LOG_KEYS = [
	["time", "loggers"],
	["time", "logging-for"],
	["time", "me", "projects"],
	["time", "me", "overview"],
];

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function renderDialog() {
	vi.mocked(listAvailableTeamMembers).mockResolvedValue([
		{
			user_id: "u-maria",
			role: "member",
			user: {
				id: "u-maria",
				display_name: "Maria Santos",
				avatar_url: null,
				email: null,
				first_name: null,
				last_name: null,
			},
		},
	] as never);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const invalidate = vi.spyOn(client, "invalidateQueries");
	const onClose = vi.fn();
	render(
		<QueryClientProvider client={client}>
			<AddTeamMemberDialog
				projectId="p1"
				teamId="t1"
				teamName="Design"
				directInvitedUserIds={new Set()}
				onClose={onClose}
			/>
		</QueryClientProvider>,
	);
	return { invalidate, onClose };
}

async function addMaria() {
	fireEvent.click(await screen.findByText("Maria Santos"));
	fireEvent.click(screen.getByRole("button", { name: "Add member" }));
}

describe("AddTeamMemberDialog › after adding", () => {
	it("refreshes who can log here, the For options, the loggable projects and the overview", async () => {
		vi.mocked(addCuratedMember).mockResolvedValue({} as never);
		const { invalidate, onClose } = renderDialog();
		await addMaria();
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(addCuratedMember).toHaveBeenCalledWith("p1", "t1", {
			user_id: "u-maria",
			role: "editor",
			move_direct_grant: undefined,
		});
		for (const queryKey of WHO_CAN_LOG_KEYS) {
			expect(invalidate).toHaveBeenCalledWith({ queryKey });
		}
	});

	it("refreshes nothing time-related when the add fails", async () => {
		vi.mocked(addCuratedMember).mockRejectedValue(new Error("Nope"));
		const { invalidate, onClose } = renderDialog();
		await addMaria();
		await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nope"));
		expect(onClose).not.toHaveBeenCalled();
		expect(invalidate).not.toHaveBeenCalledWith({
			queryKey: ["time", "loggers"],
		});
	});
});
