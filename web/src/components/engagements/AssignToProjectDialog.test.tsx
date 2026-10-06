/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));
vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));

import type { Engagement } from "@/services/engagement.service";
import {
	type EngagementAssignment,
	engagementAssignmentsService,
} from "@/services/engagementAssignments.service";
import { type Project, projectService } from "@/services/project.service";
import { TimeApiError } from "@/services/time.service";
import { useAuthStore } from "@/stores/authStore";
import {
	AssignToProjectDialog,
	clientChoiceLabels,
} from "./AssignToProjectDialog";
import {
	isAlreadyAssigned,
	linkedProjects,
	placeableProjects,
} from "./useEngagementAssignments";

const ME = "consultant-1";
const TALENT = "talent-1";

function link(id: string, title: string, status = "active") {
	return {
		id: `link-${id}`,
		project_id: id,
		project_title_snapshot: title,
		basis: "contract_scope",
		status,
		linked_at: "2026-08-01T00:00:00Z",
		ended_at: null,
	};
}

function engagement(over: Partial<Engagement> = {}): Engagement {
	return {
		id: "eng-1",
		kind: "talent_services",
		scope_mode: "project_specific",
		status: "active",
		origin: "contract",
		activated_by_contract_id: "contract-1",
		started_at: "2026-08-01T00:00:00Z",
		ended_at: null,
		cancelled_at: null,
		status_reason: null,
		viewer_position: "hirer",
		viewer_capacity: "consultant",
		counterparty: {
			position: "provider",
			user_id: TALENT,
			capacity: "talent",
			display_name_snapshot: "Leo Cruz",
			email_snapshot: "leo@example.com",
		},
		project_links: [link("p1", "Acme Website"), link("p2", "Acme App")],
		current_settings: null,
		current_rates: [],
		...over,
	};
}

function row(over: Partial<EngagementAssignment> = {}): EngagementAssignment {
	return {
		id: "a1",
		engagement_id: "eng-1",
		project_id: "p1",
		project_title_snapshot: "Acme Website",
		worker_user_id: TALENT,
		worker_label: "Leo Cruz",
		client_engagement_id: null,
		talent_engagement_id: "eng-1",
		team_id: null,
		role_title: null,
		status: "active",
		started_at: "2026-10-01T01:00:00.000Z",
		ended_at: null,
		...over,
	};
}

function project(
	id: string,
	title: string,
	role: string,
	over: Partial<Project> = {},
): Project {
	return {
		id,
		title,
		status: "active",
		owner_id: "someone",
		members: [
			{ id: `m-${id}`, project_id: id, user_id: ME, role: role as never },
		],
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
		...over,
	};
}

function renderDialog(
	props: Partial<Parameters<typeof AssignToProjectDialog>[0]> = {},
) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const onClose = vi.fn();
	const onAssigned = vi.fn();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	render(
		<AssignToProjectDialog
			engagement={engagement()}
			assignments={[]}
			onClose={onClose}
			onAssigned={onAssigned}
			{...props}
		/>,
		{ wrapper },
	);
	return { client, onClose, onAssigned };
}

function dialog() {
	return screen.getByRole("dialog");
}

function projectTrigger() {
	return within(dialog()).getByRole("button", { name: "Project" });
}

function assignButton() {
	return within(dialog()).getByRole("button", { name: "Assign" });
}

function clientError(choices: Array<{ id: string; label: string }>) {
	return new TimeApiError({
		status: 422,
		code: "ASSIGNMENT_CLIENT_ENGAGEMENT_REQUIRED",
		message: "Choose the client agreement this work belongs to.",
		extras: { client_engagements: choices },
	});
}

beforeEach(() => {
	useAuthStore.setState({ user: { id: ME } as never });
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	for (const fn of Object.values(toast)) fn.mockReset();
	useAuthStore.setState({ user: null });
});

describe("helpers", () => {
	it("lists active linked projects once", () => {
		expect(
			linkedProjects(
				engagement({
					project_links: [
						link("p1", "Acme Website"),
						link("p1", "Acme Website again"),
						link("p3", "Old", "ended"),
						{ ...link("p4", "Deleted"), project_id: null },
					],
				}),
			),
		).toEqual([{ id: "p1", title: "Acme Website", linked: true }]);
	});

	it("offers only admin, non-personal, unlinked projects for placing", () => {
		const projects = [
			project("p1", "Acme Website", "admin"),
			project("p5", "Zeta", "owner"),
			project("p6", "Beta", "admin"),
			project("p7", "Viewer only", "viewer"),
			project("p8", "Mine", "editor", { owner_id: ME }),
			project("p9", "Personal", "owner", {
				members: [
					{
						id: "m",
						project_id: "p9",
						user_id: ME,
						role: "owner",
						origin: "personal_project",
					},
				],
			}),
		];
		expect(placeableProjects(projects, ME, new Set(["p1"]))).toEqual([
			{ id: "p6", title: "Beta", linked: false },
			{ id: "p8", title: "Mine", linked: false },
			{ id: "p5", title: "Zeta", linked: false },
		]);
	});

	it("knows who is already assigned", () => {
		const rows = [
			row(),
			row({ id: "a2", project_id: "p2", status: "ended" }),
			row({ id: "a3", project_id: "p3", worker_user_id: "someone" }),
		];
		expect(isAlreadyAssigned(rows, "p1", { self: false, viewerId: ME })).toBe(
			true,
		);
		expect(isAlreadyAssigned(rows, "p2", { self: false, viewerId: ME })).toBe(
			false,
		);
		// On a client engagement only the viewer's own rows count.
		expect(isAlreadyAssigned(rows, "p3", { self: true, viewerId: ME })).toBe(
			false,
		);
	});

	it("tells repeated client names apart", () => {
		expect(
			clientChoiceLabels([
				{ id: "c1", label: "Acme Corp" },
				{ id: "c2", label: "Globex" },
				{ id: "c3", label: "Acme Corp" },
			]),
		).toEqual(["Acme Corp", "Globex", "Acme Corp · 2"]);
	});
});

describe("AssignToProjectDialog", () => {
	it("preselects the first project the worker isn't on and sends the form", async () => {
		const create = vi
			.spyOn(engagementAssignmentsService, "create")
			.mockResolvedValue({
				...row({ project_id: "p2", project_title_snapshot: "Acme App" }),
				access_needed: false,
			});
		const { onAssigned } = renderDialog({ assignments: [row()] });

		expect(
			within(dialog()).getByText(
				"Pick the project Leo Cruz works on under this agreement.",
			),
		).toBeTruthy();
		expect(
			within(dialog()).getByText(
				"If you manage the project's people, Leo Cruz is added to it as an editor.",
			),
		).toBeTruthy();
		await waitFor(() => expect(projectTrigger().textContent).toBe("Acme App"));

		fireEvent.click(projectTrigger());
		expect(
			screen.getByRole("option", { name: "Acme Website · already assigned" }),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("option", { name: "Acme App" }));

		fireEvent.change(within(dialog()).getByLabelText("Role"), {
			target: { value: "Designer" },
		});
		fireEvent.change(within(dialog()).getByLabelText("Starts"), {
			target: { value: "2026-10-05T09:00" },
		});
		fireEvent.click(assignButton());

		await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
		expect(create).toHaveBeenCalledWith("eng-1", {
			project_id: "p2",
			role_title: "Designer",
			started_at: new Date("2026-10-05T09:00").toISOString(),
			client_engagement_id: undefined,
		});
		await waitFor(() => expect(onAssigned).toHaveBeenCalledTimes(1));
		expect(onAssigned.mock.calls[0][0]).toMatchObject({ access_needed: false });
		expect(toast.success).toHaveBeenCalledWith(
			"Leo Cruz is assigned to Acme App.",
		);
	});

	it("asks which client agreement when several qualify, then sends the choice (L8)", async () => {
		const create = vi
			.spyOn(engagementAssignmentsService, "create")
			.mockRejectedValueOnce(
				clientError([
					{ id: "c1", label: "Acme Corp" },
					{ id: "c2", label: "Globex" },
				]),
			)
			.mockResolvedValueOnce({
				...row({ client_engagement_id: "c2" }),
				access_needed: false,
			});
		const { onAssigned } = renderDialog();
		await waitFor(() =>
			expect(projectTrigger().textContent).toBe("Acme Website"),
		);

		fireEvent.click(assignButton());
		const question = await within(dialog()).findByRole("group", {
			name: "Which client agreement is this work for?",
		});
		expect(within(dialog()).queryByRole("alert")).toBeNull();
		expect(assignButton().hasAttribute("disabled")).toBe(true);

		fireEvent.click(within(question).getByLabelText("Globex"));
		expect(assignButton().hasAttribute("disabled")).toBe(false);
		fireEvent.click(assignButton());

		await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
		expect(create.mock.calls[1][1]).toMatchObject({
			project_id: "p1",
			client_engagement_id: "c2",
		});
		await waitFor(() => expect(onAssigned).toHaveBeenCalledTimes(1));
	});

	it("drops the question when the project changes", async () => {
		vi.spyOn(engagementAssignmentsService, "create").mockRejectedValueOnce(
			clientError([
				{ id: "c1", label: "Acme Corp" },
				{ id: "c2", label: "Globex" },
			]),
		);
		renderDialog();
		await waitFor(() =>
			expect(projectTrigger().textContent).toBe("Acme Website"),
		);
		fireEvent.click(assignButton());
		await within(dialog()).findByRole("group");

		fireEvent.click(projectTrigger());
		fireEvent.click(screen.getByRole("option", { name: "Acme App" }));
		expect(within(dialog()).queryByRole("group")).toBeNull();
		expect(assignButton().hasAttribute("disabled")).toBe(false);
	});

	it("names the worker when they are already assigned", async () => {
		vi.spyOn(engagementAssignmentsService, "create").mockRejectedValue(
			new TimeApiError({
				status: 409,
				code: "ASSIGNMENT_ALREADY_ACTIVE" as never,
				message:
					"This person is already assigned to this project under this agreement.",
			}),
		);
		const { onAssigned } = renderDialog();
		await waitFor(() =>
			expect(projectTrigger().textContent).toBe("Acme Website"),
		);
		fireEvent.click(assignButton());
		expect((await within(dialog()).findByRole("alert")).textContent).toBe(
			"Leo Cruz is already assigned to this project under this agreement.",
		);
		expect(onAssigned).not.toHaveBeenCalled();
	});

	it("shows the ux.md row for a hirer who doesn't deliver the client agreement", async () => {
		vi.spyOn(engagementAssignmentsService, "create").mockRejectedValue(
			new TimeApiError({
				status: 422,
				code: "ASSIGNMENT_HIRER_NOT_CLIENT_PROVIDER",
				message: "raw",
			}),
		);
		renderDialog();
		await waitFor(() =>
			expect(projectTrigger().textContent).toBe("Acme Website"),
		);
		fireEvent.click(assignButton());
		expect((await within(dialog()).findByRole("alert")).textContent).toBe(
			"This agreement's hirer doesn't deliver the client agreement on this project.",
		);
	});

	it("says there is nothing to assign to when a project-specific agreement has no project", () => {
		renderDialog({ engagement: engagement({ project_links: [] }) });
		expect(
			within(dialog()).getByText(
				"This agreement isn't on a project yet, so there's nothing to assign to.",
			),
		).toBeTruthy();
		expect(assignButton().hasAttribute("disabled")).toBe(true);
	});

	it("offers the projects a flexible agreement could go on, and says it gets added", async () => {
		const list = vi
			.spyOn(projectService, "list")
			.mockResolvedValue([
				project("p1", "Acme Website", "admin"),
				project("p6", "Beta", "admin"),
				project("p7", "Viewer only", "viewer"),
			]);
		const create = vi
			.spyOn(engagementAssignmentsService, "create")
			.mockResolvedValue({ ...row({ project_id: "p6" }), access_needed: true });
		renderDialog({
			engagement: engagement({
				scope_mode: "flexible",
				project_links: [link("p1", "Acme Website")],
			}),
			assignments: [row()],
		});

		await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
		await waitFor(() =>
			expect(projectTrigger().textContent).toBe(
				"Beta · not on this agreement yet",
			),
		);
		expect(
			within(dialog()).getByText(
				"This agreement isn't on that project yet. Assigning adds it.",
			),
		).toBeTruthy();
		fireEvent.click(projectTrigger());
		expect(screen.queryByRole("option", { name: /Viewer only/ })).toBeNull();
		fireEvent.click(
			screen.getByRole("option", { name: "Beta · not on this agreement yet" }),
		);

		fireEvent.click(assignButton());
		await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
		expect(create.mock.calls[0][1]).toMatchObject({ project_id: "p6" });
	});

	it("says so when a flexible agreement has nowhere to go", async () => {
		vi.spyOn(projectService, "list").mockResolvedValue([
			project("p7", "Viewer only", "viewer"),
		]);
		renderDialog({
			engagement: engagement({ scope_mode: "flexible", project_links: [] }),
		});
		expect(
			await within(dialog()).findByText(
				"There's no project to choose yet. Projects you manage show here.",
			),
		).toBeTruthy();
	});

	it("says so when the projects can't be loaded", async () => {
		// A 4xx-like failure, so the query does not retry first.
		vi.spyOn(projectService, "list").mockRejectedValue(
			Object.assign(new Error("Failed to fetch projects"), { status: 403 }),
		);
		renderDialog({
			engagement: engagement({ scope_mode: "flexible", project_links: [] }),
		});
		expect((await within(dialog()).findByRole("alert")).textContent).toBe(
			"Proyekto couldn't load your projects. Try again.",
		);
		expect(assignButton().hasAttribute("disabled")).toBe(true);
	});

	it("is the consultant's own assignment on a client agreement", async () => {
		vi.spyOn(engagementAssignmentsService, "create").mockResolvedValue({
			...row({
				worker_user_id: ME,
				worker_label: "Ana Reyes",
				client_engagement_id: "eng-1",
				talent_engagement_id: null,
			}),
			access_needed: false,
		});
		renderDialog({
			engagement: engagement({
				kind: "client_services",
				viewer_position: "provider",
				counterparty: {
					position: "hirer",
					user_id: "client-1",
					capacity: "client",
					display_name_snapshot: "Acme Corp",
					email_snapshot: null,
				},
			}),
		});
		expect(
			within(dialog()).getByText(
				"Pick the project you work on under this agreement.",
			),
		).toBeTruthy();
		expect(
			within(dialog()).getByText(
				"You need editor access on the project to log time there.",
			),
		).toBeTruthy();
		await waitFor(() =>
			expect(projectTrigger().textContent).toBe("Acme Website"),
		);
		fireEvent.click(assignButton());
		await waitFor(() =>
			expect(toast.success).toHaveBeenCalledWith(
				"You're assigned to Acme Website.",
			),
		);
	});

	it("refreshes the engagement, the project's people and the time caches", async () => {
		vi.spyOn(engagementAssignmentsService, "create").mockResolvedValue({
			...row(),
			access_needed: false,
		});
		const { client } = renderDialog();
		const invalidate = vi.spyOn(client, "invalidateQueries");
		await waitFor(() =>
			expect(projectTrigger().textContent).toBe("Acme Website"),
		);
		fireEvent.click(assignButton());
		await waitFor(() => expect(toast.success).toHaveBeenCalled());
		const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey);
		expect(keys).toEqual(
			expect.arrayContaining([
				["engagement", "eng-1"],
				["engagements"],
				["project", "members", "p1"],
				["project", "detail", "p1"],
				["time", "logging-for"],
				["time", "me", "running"],
			]),
		);
	});
});
