/* @vitest-environment jsdom */

import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace, WorkspaceMember } from "@/services/workspaces.service";
import { WorkspaceGeneralSettings } from "./WorkspaceGeneralSettings";

const state = vi.hoisted(() => ({
	role: "owner" as "owner" | "admin" | "member",
	description: null as string | null,
	members: [] as WorkspaceMember[],
	membersLoading: false,
	mutate: vi.fn(),
	navigate: vi.fn(),
}));

function workspace(): Workspace {
	return {
		id: "ws-1",
		name: "Acme",
		slug: "acme",
		previous_slugs: [],
		description: state.description,
		avatar_url: null,
		created_by: "user-me",
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
		my_role: state.role,
	};
}

function member(
	id: string,
	role: WorkspaceMember["role"],
	user: Partial<NonNullable<WorkspaceMember["user"]>>,
): WorkspaceMember {
	return {
		id,
		workspace_id: "ws-1",
		user_id: `user-${id}`,
		role,
		joined_at: "2026-01-01T00:00:00Z",
		user: {
			id: `user-${id}`,
			display_name: null,
			avatar_url: null,
			email: null,
			...user,
		} as NonNullable<WorkspaceMember["user"]>,
	};
}

vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useCurrentWorkspace: () => ({
		workspace: workspace(),
		workspaces: [workspace()],
		isLoading: false,
	}),
	useUpdateWorkspaceMutation: () => ({
		mutate: state.mutate,
		isPending: false,
	}),
	useWorkspaceMembersQuery: () => ({
		data: state.membersLoading ? undefined : state.members,
		isLoading: state.membersLoading,
	}),
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/stores/authStore", () => ({
	useUser: () => ({ id: "user-me" }),
}));

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ setQueryData: vi.fn() }),
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => state.navigate,
}));

beforeEach(() => {
	state.role = "owner";
	state.description = null;
	state.members = [
		member("1", "owner", {
			display_name: "Jane Doe",
			email: "jane@acme.test",
		}),
		member("2", "member", { display_name: "Not An Owner" }),
	];
	state.membersLoading = false;
	state.mutate.mockReset();
	state.navigate.mockReset();
});

afterEach(() => {
	cleanup();
});

describe("WorkspaceGeneralSettings", () => {
	it("lays the page out as titled sections, without card chrome", () => {
		const { container } = render(<WorkspaceGeneralSettings />);

		expect(
			screen.getByRole("heading", { level: 1, name: "General" }),
		).toBeTruthy();
		expect(
			screen.getByRole("region", { name: "Workspace details" }),
		).toBeTruthy();
		expect(screen.getByRole("region", { name: "Owners" })).toBeTruthy();
		expect(container.querySelector('[class*="bg-card"]')).toBeNull();
		expect(container.querySelector('[class*="shadow"]')).toBeNull();
	});

	it("keeps Save disabled until something changes, then submits the edit", () => {
		render(<WorkspaceGeneralSettings />);
		const save = screen.getByRole("button", { name: "Save changes" });
		expect((save as HTMLButtonElement).disabled).toBe(true);

		fireEvent.change(screen.getByLabelText("Workspace name"), {
			target: { value: "  Acme Studio  " },
		});
		fireEvent.change(screen.getByLabelText(/Description/), {
			target: { value: "Client work" },
		});
		expect((save as HTMLButtonElement).disabled).toBe(false);

		fireEvent.click(save);
		expect(state.mutate).toHaveBeenCalledTimes(1);
		expect(state.mutate.mock.calls[0]?.[0]).toEqual({
			name: "Acme Studio",
			description: "Client work",
		});
	});

	it("lets an owner edit the URL handle and blocks an invalid one", () => {
		render(<WorkspaceGeneralSettings />);
		const slug = screen.getByLabelText("URL handle") as HTMLInputElement;
		expect(slug.value).toBe("acme");
		expect(screen.getByText("/w/")).toBeTruthy();

		fireEvent.change(slug, { target: { value: "ab" } });
		expect(slug.getAttribute("aria-invalid")).toBe("true");
		expect(
			screen.getByText(
				"Use 3 to 60 lowercase letters, numbers, and single hyphens.",
			),
		).toBeTruthy();
		expect(
			(
				screen.getByRole("button", {
					name: "Save changes",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);

		fireEvent.change(slug, { target: { value: "Acme Studio" } });
		expect(slug.value).toBe("acme-studio");
		expect(
			screen.getByText(
				"Old links keep working: they redirect to the new handle.",
			),
		).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		expect(state.mutate.mock.calls[0]?.[0]).toEqual({
			name: "Acme",
			description: "",
			slug: "acme-studio",
		});
	});

	it("shows an admin the URL handle read-only", () => {
		state.role = "admin";
		render(<WorkspaceGeneralSettings />);

		expect(screen.getByLabelText("Workspace name")).toBeTruthy();
		expect(screen.queryByRole("textbox", { name: "URL handle" })).toBeNull();
		expect(
			screen.getByText("Only the workspace owner can change the URL handle."),
		).toBeTruthy();
	});

	it("shows a plain member the details read-only", () => {
		state.role = "member";
		state.description = "Where Acme ships client work";
		render(<WorkspaceGeneralSettings />);

		expect(screen.queryByRole("textbox")).toBeNull();
		expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
		const details = screen.getByRole("region", { name: "Workspace details" });
		expect(within(details).getByText("Acme")).toBeTruthy();
		expect(
			within(details).getByText("Where Acme ships client work"),
		).toBeTruthy();
		expect(
			within(details).getByText(
				"Only workspace owners and admins can change these details.",
			),
		).toBeTruthy();
	});

	it("says so when a member's workspace has no description", () => {
		state.role = "member";
		render(<WorkspaceGeneralSettings />);
		expect(screen.getByText("No description yet.")).toBeTruthy();
	});

	it("lists only owners, with initials when there is no avatar", () => {
		render(<WorkspaceGeneralSettings />);
		const owners = screen.getByRole("region", { name: "Owners" });
		const items = within(owners).getAllByRole("listitem");

		expect(items).toHaveLength(1);
		expect(within(items[0] as HTMLElement).getByText("Jane Doe")).toBeTruthy();
		expect(
			within(items[0] as HTMLElement).getByText("jane@acme.test"),
		).toBeTruthy();
		expect(within(items[0] as HTMLElement).getByText("JD")).toBeTruthy();
		expect(within(owners).queryByText("Not An Owner")).toBeNull();
	});

	it("reports loading and empty owner lists", () => {
		state.membersLoading = true;
		const { rerender } = render(<WorkspaceGeneralSettings />);
		expect(screen.getByText("Loading owners…")).toBeTruthy();

		state.membersLoading = false;
		state.members = [];
		rerender(<WorkspaceGeneralSettings />);
		expect(
			screen.getByText(
				"The owners of this workspace could not be loaded right now.",
			),
		).toBeTruthy();
	});
});
