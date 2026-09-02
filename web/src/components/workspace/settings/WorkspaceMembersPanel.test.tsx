/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	Workspace,
	WorkspaceInvite,
	WorkspaceMember,
} from "@/services/workspaces.service";

const mocks = vi.hoisted(() => ({
	updateRoleMutate: vi.fn(),
	removeMemberMutate: vi.fn(),
	cancelInviteMutate: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

const workspace: Workspace = {
	id: "ws-1",
	name: "Acme",
	description: null,
	avatar_url: null,
	created_by: "user-me",
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
	my_role: "owner",
	slug: "acme",
	previous_slugs: [],
};

const member = (
	id: string,
	userId: string,
	name: string,
	role: WorkspaceMember["role"],
): WorkspaceMember => ({
	id,
	workspace_id: "ws-1",
	user_id: userId,
	role,
	joined_at: "2026-02-01T00:00:00Z",
	user: {
		id: userId,
		display_name: name,
		avatar_url: null,
		email: `${name.toLowerCase()}@example.com`,
		first_name: name,
		last_name: null,
	},
});

const members = [
	member("m-1", "user-me", "Alice", "owner"),
	member("m-2", "user-bob", "Bob", "member"),
];

const invites: WorkspaceInvite[] = [
	{
		id: "invite-1",
		workspace_id: "ws-1",
		invited_by: "user-me",
		invitee_id: null,
		invitee_email: "dana@example.com",
		role: "member",
		status: "pending",
		message: null,
		responded_at: null,
		created_at: "2026-03-01T00:00:00Z",
		updated_at: "2026-03-01T00:00:00Z",
	},
];

vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useCurrentWorkspace: () => ({
		workspace,
		workspaces: [workspace],
		isLoading: false,
	}),
	useWorkspaceMembersQuery: () => ({ data: members, isLoading: false }),
	useWorkspaceInvitesQuery: () => ({ data: invites, isLoading: false }),
	useWorkspaceMemberMutations: () => ({
		updateRole: { mutate: mocks.updateRoleMutate, isPending: false },
		removeMember: { mutate: mocks.removeMemberMutate, isPending: false },
	}),
	useCancelWorkspaceInviteMutation: () => ({
		mutate: mocks.cancelInviteMutate,
		isPending: false,
	}),
	useCreateWorkspaceMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		success: mocks.toastSuccess,
		error: mocks.toastError,
	}),
}));

vi.mock("@/stores/authStore", () => ({
	useUser: () => ({ id: "user-me" }),
}));

vi.mock("@/components/workspace/WorkspaceInviteDialog", () => ({
	WorkspaceInviteDialog: ({ open }: { open: boolean }) =>
		open ? <div data-testid="invite-dialog" /> : null,
}));

// The real confirm dialog animates through framer-motion and portals out of
// the tree; the panel only needs its open/confirm/close contract here.
vi.mock("@/components/common/AppConfirmDialog", () => ({
	AppConfirmDialog: ({
		open,
		title,
		message,
		confirmLabel = "Confirm",
		cancelLabel = "Cancel",
		onConfirm,
		onClose,
	}: {
		open: boolean;
		title: string;
		message?: ReactNode;
		confirmLabel?: string;
		cancelLabel?: string;
		onConfirm: () => void;
		onClose: () => void;
	}) =>
		open ? (
			<div role="dialog">
				<h2>{title}</h2>
				{message}
				<button type="button" onClick={onClose}>
					{cancelLabel}
				</button>
				<button type="button" onClick={onConfirm}>
					{confirmLabel}
				</button>
			</div>
		) : null,
}));

import { WorkspaceMembersPanel } from "./WorkspaceMembersPanel";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("WorkspaceMembersPanel", () => {
	it("changes a member's role through the row select", () => {
		render(<WorkspaceMembersPanel />);

		const select = screen.getByLabelText("Change role for Bob");
		fireEvent.change(select, { target: { value: "admin" } });

		expect(mocks.updateRoleMutate).toHaveBeenCalledTimes(1);
		expect(mocks.updateRoleMutate.mock.calls[0][0]).toEqual({
			userId: "user-bob",
			role: "admin",
		});
	});

	it("removes a member after the confirmation dialog", () => {
		render(<WorkspaceMembersPanel />);

		const removeButtons = screen.getAllByRole("button", { name: "Remove" });
		// Row order follows the members fixture: Alice, then Bob.
		fireEvent.click(removeButtons[1]);

		fireEvent.click(screen.getByRole("button", { name: "Remove member" }));

		expect(mocks.removeMemberMutate).toHaveBeenCalledTimes(1);
		expect(mocks.removeMemberMutate.mock.calls[0][0]).toBe("user-bob");
	});

	it("cancels a pending invitation", () => {
		render(<WorkspaceMembersPanel />);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Cancel invitation for dana@example.com",
			}),
		);

		expect(mocks.cancelInviteMutate).toHaveBeenCalledTimes(1);
		expect(mocks.cancelInviteMutate.mock.calls[0][0]).toBe("invite-1");
	});
});
