/* @vitest-environment jsdom */

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildEntitlements,
	normalizeWorkspaceUsage,
	type WorkspaceEntitlements,
} from "@/lib/entitlements";
import { PlanLimitError } from "@/lib/planLimitErrors";
import type { WorkspaceInvite } from "@/services/workspaces.service";

const mocks = vi.hoisted(() => ({
	mutateAsync: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
	toastWarning: vi.fn(),
	entitlements: null as WorkspaceEntitlements | null,
	invitesQuery: { data: [], isSuccess: true } as {
		data: WorkspaceInvite[] | undefined;
		isSuccess: boolean;
	},
}));

vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useWorkspaceInviteMutation: () => ({ mutateAsync: mocks.mutateAsync }),
	useWorkspaceInvitesQuery: () => mocks.invitesQuery,
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		success: mocks.toastSuccess,
		error: mocks.toastError,
		warning: mocks.toastWarning,
	}),
}));

vi.mock("@/hooks/useEntitlements", () => ({
	useEntitlements: () => mocks.entitlements,
}));

// Reads the billing summary; the dialog's seat copy is not under test here.
vi.mock("@/components/billing/SeatChangeNotice", () => ({
	SeatChangeNotice: () => null,
}));

// The real dialog portals and animates; only its slots matter here.
vi.mock("@/components/common/AppDialog", () => ({
	AppDialog: ({
		title,
		children,
		footer,
	}: {
		title: string;
		children: ReactNode;
		footer: ReactNode;
	}) => (
		<div role="dialog" aria-label={title}>
			{children}
			{footer}
		</div>
	),
}));

import { WorkspaceInviteDialog } from "./WorkspaceInviteDialog";

const unknownUsage = () => buildEntitlements(null, "unavailable");

const usageWith = (members: number, pending: number) =>
	buildEntitlements(
		normalizeWorkspaceUsage(
			{
				workspace_id: "ws-1",
				plan: { effective: "free", source: "default", complimentary: null },
				usage: { members, pending_invites: pending, projects: 0, teams: 0 },
				counts_pending_invites: true,
			},
			"ws-1",
		),
		"ready",
	);

const pendingInvite = (
	email: string,
	status: WorkspaceInvite["status"] = "pending",
): WorkspaceInvite => ({
	id: `invite-${email}`,
	workspace_id: "ws-1",
	invited_by: "user-me",
	invitee_id: null,
	invitee_email: email,
	role: "member",
	status,
	message: null,
	responded_at: null,
	created_at: "2026-03-01T00:00:00Z",
	updated_at: "2026-03-01T00:00:00Z",
});

const withPending = (...emails: string[]) => {
	mocks.invitesQuery = {
		data: emails.map((email) => pendingInvite(email)),
		isSuccess: true,
	};
};

const memberCapError = () =>
	new PlanLimitError({
		limitKey: "members",
		kind: "count",
		label: "Members",
		limit: 10,
		used: 10,
		plan: "free",
		upgradePlan: "pro",
		workspaceId: "ws-1",
		workspaceSlug: "acme",
		context: "invite",
		message: "Your Free plan includes 10 members and this workspace has 10.",
	});

function fillRows(emails: string[]) {
	for (let i = 1; i < emails.length; i++) {
		fireEvent.click(screen.getByRole("button", { name: /Add another/ }));
	}
	const inputs = screen.getAllByLabelText("Email address");
	emails.forEach((email, i) => {
		fireEvent.change(inputs[i], { target: { value: email } });
	});
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	mocks.entitlements = null;
	mocks.invitesQuery = { data: [], isSuccess: true };
});

describe("WorkspaceInviteDialog at the member cap", () => {
	it("stops the batch at the first plan-limit refusal and labels the rest", async () => {
		mocks.entitlements = unknownUsage();
		mocks.mutateAsync
			.mockResolvedValueOnce({ id: "i-1", email_delivery: { sent: true } })
			.mockRejectedValueOnce(memberCapError())
			.mockResolvedValue({ id: "never" });

		render(<WorkspaceInviteDialog workspaceId="ws-1" open onClose={vi.fn()} />);
		fillRows(["ana@example.com", "ben@example.com", "cy@example.com"]);
		fireEvent.click(screen.getByRole("button", { name: "Send 3 invitations" }));

		await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());

		// The third row is never tried: it would be refused the same way.
		expect(mocks.mutateAsync).toHaveBeenCalledTimes(2);
		// The sent row is gone; the refused one and the untried one remain.
		const inputs = screen.getAllByLabelText(
			"Email address",
		) as HTMLInputElement[];
		expect(inputs.map((input) => input.value)).toEqual([
			"ben@example.com",
			"cy@example.com",
		]);
		expect(screen.getAllByText(/Free has no member spots left/)).toHaveLength(
			2,
		);
		// The upgrade prompt explains it; no batch error on top.
		expect(mocks.toastError).not.toHaveBeenCalled();
		expect(mocks.toastSuccess).toHaveBeenCalledWith("Invitation sent");
	});

	it("keeps reporting unrelated failures row by row", async () => {
		mocks.entitlements = unknownUsage();
		mocks.mutateAsync
			.mockRejectedValueOnce(new Error("Already a member"))
			.mockResolvedValueOnce({ id: "i-2", email_delivery: { sent: true } });

		render(<WorkspaceInviteDialog workspaceId="ws-1" open onClose={vi.fn()} />);
		fillRows(["ana@example.com", "ben@example.com"]);
		fireEvent.click(screen.getByRole("button", { name: "Send 2 invitations" }));

		await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
		expect(mocks.mutateAsync).toHaveBeenCalledTimes(2);
		expect(screen.getByText("Already a member")).toBeTruthy();
	});

	it("shows the room left and disables Send when the rows exceed it", () => {
		mocks.entitlements = usageWith(8, 1);

		render(<WorkspaceInviteDialog workspaceId="ws-1" open onClose={vi.fn()} />);

		expect(screen.getByText(/Free has room for 1 more member/)).toBeTruthy();

		fillRows(["ana@example.com", "ben@example.com"]);
		const send = screen.getByRole("button", {
			name: "Send 2 invitations",
		}) as HTMLButtonElement;
		expect(send.disabled).toBe(true);

		fireEvent.click(send);
		expect(mocks.mutateAsync).not.toHaveBeenCalled();
	});

	it("leaves Send enabled while usage is unknown (fails open)", () => {
		mocks.entitlements = unknownUsage();

		render(<WorkspaceInviteDialog workspaceId="ws-1" open onClose={vi.fn()} />);
		fillRows(["ana@example.com", "ben@example.com"]);

		const send = screen.getByRole("button", {
			name: "Send 2 invitations",
		}) as HTMLButtonElement;
		expect(send.disabled).toBe(false);
		expect(screen.queryByText(/member spots|more member/)).toBeNull();
	});
});

describe("WorkspaceInviteDialog re-sending a pending invite", () => {
	it("lets a re-send through at the cap: it adds nobody", async () => {
		// 8 members + 2 pending = Free's 10, so remaining is 0.
		mocks.entitlements = usageWith(8, 2);
		withPending("dana@example.com", "eve@example.com");
		mocks.mutateAsync.mockResolvedValue({
			id: "invite-dana",
			email_delivery: { sent: true },
		});
		const onClose = vi.fn();

		render(<WorkspaceInviteDialog workspaceId="ws-1" open onClose={onClose} />);
		expect(
			screen.getByText(/re-sending an invitation that's already pending/i),
		).toBeTruthy();

		// Matched case-insensitively, as the server matches it.
		fillRows([" Dana@Example.com "]);
		expect(screen.getByText(/Already invited/)).toBeTruthy();
		const send = screen.getByRole("button", {
			name: "Send invitation",
		}) as HTMLButtonElement;
		expect(send.disabled).toBe(false);

		fireEvent.click(send);
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(mocks.mutateAsync).toHaveBeenCalledWith({
			email: "Dana@Example.com",
			role: "member",
		});
	});

	it("still refuses a brand-new email at the cap", () => {
		mocks.entitlements = usageWith(8, 2);
		withPending("dana@example.com", "eve@example.com");

		render(<WorkspaceInviteDialog workspaceId="ws-1" open onClose={vi.fn()} />);
		fillRows(["dana@example.com", "new@example.com"]);

		const send = screen.getByRole("button", {
			name: "Send 2 invitations",
		}) as HTMLButtonElement;
		expect(send.disabled).toBe(true);
		fireEvent.click(send);
		expect(mocks.mutateAsync).not.toHaveBeenCalled();
	});

	it("counts only new emails against the room left", () => {
		// 8 members + 1 pending: room for one more.
		mocks.entitlements = usageWith(8, 1);
		withPending("dana@example.com");

		render(<WorkspaceInviteDialog workspaceId="ws-1" open onClose={vi.fn()} />);
		// One new email (entered twice, so still one spot) plus one re-send.
		fillRows(["new@example.com", "dana@example.com", "NEW@example.com"]);

		const send = screen.getByRole("button", {
			name: "Send 3 invitations",
		}) as HTMLButtonElement;
		expect(send.disabled).toBe(false);
	});

	it("ignores invites that are no longer pending", () => {
		mocks.entitlements = usageWith(8, 2);
		mocks.invitesQuery = {
			data: [pendingInvite("dana@example.com", "cancelled")],
			isSuccess: true,
		};

		render(<WorkspaceInviteDialog workspaceId="ws-1" open onClose={vi.fn()} />);
		fillRows(["dana@example.com"]);

		const send = screen.getByRole("button", {
			name: "Send invitation",
		}) as HTMLButtonElement;
		expect(send.disabled).toBe(true);
		expect(screen.queryByText(/Already invited/)).toBeNull();
	});

	it("fails open at the cap while the pending list is still loading", () => {
		mocks.entitlements = usageWith(8, 2);
		mocks.invitesQuery = { data: undefined, isSuccess: false };

		render(<WorkspaceInviteDialog workspaceId="ws-1" open onClose={vi.fn()} />);
		fillRows(["dana@example.com"]);

		const send = screen.getByRole("button", {
			name: "Send invitation",
		}) as HTMLButtonElement;
		expect(send.disabled).toBe(false);
	});

	it("keeps sending re-sends after a cap refusal but not new invites", async () => {
		mocks.entitlements = unknownUsage();
		withPending("dana@example.com");
		mocks.mutateAsync
			.mockRejectedValueOnce(memberCapError())
			.mockResolvedValueOnce({
				id: "invite-dana",
				email_delivery: { sent: true },
			})
			.mockResolvedValue({ id: "never" });

		render(<WorkspaceInviteDialog workspaceId="ws-1" open onClose={vi.fn()} />);
		fillRows(["ana@example.com", "dana@example.com", "cy@example.com"]);
		fireEvent.click(screen.getByRole("button", { name: "Send 3 invitations" }));

		await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());

		// ana is refused, dana's re-send still goes out, cy is never tried.
		expect(mocks.mutateAsync).toHaveBeenCalledTimes(2);
		expect(mocks.mutateAsync.mock.calls[1][0]).toEqual({
			email: "dana@example.com",
			role: "member",
		});
		const inputs = screen.getAllByLabelText(
			"Email address",
		) as HTMLInputElement[];
		expect(inputs.map((input) => input.value)).toEqual([
			"ana@example.com",
			"cy@example.com",
		]);
		expect(screen.getAllByText(/Free has no member spots left/)).toHaveLength(
			2,
		);
		expect(mocks.toastError).not.toHaveBeenCalled();
		expect(mocks.toastSuccess).toHaveBeenCalledWith("Invitation sent");
	});
});
