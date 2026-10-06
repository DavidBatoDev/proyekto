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
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		params,
		className,
	}: {
		children: ReactNode;
		to: string;
		params?: Record<string, string>;
		className?: string;
	}) => (
		<a
			className={className}
			href={to.replace("$projectId", params?.projectId ?? "")}
		>
			{children}
		</a>
	),
}));

import type { Engagement } from "@/services/engagement.service";
import {
	type EngagementAssignment,
	engagementAssignmentsService,
} from "@/services/engagementAssignments.service";
import { TimeApiError } from "@/services/time.service";
import { useAuthStore } from "@/stores/authStore";
import { EngagementAssignmentsCard } from "./EngagementAssignmentsCard";

const NOW = new Date("2026-10-06T04:00:00.000Z");
const HIRER = "consultant-1";
const TALENT = "talent-1";

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
		project_links: [
			{
				id: "link-1",
				project_id: "p1",
				project_title_snapshot: "Acme Website",
				basis: "contract_scope",
				status: "active",
				linked_at: "2026-08-01T00:00:00Z",
				ended_at: null,
			},
			{
				id: "link-2",
				project_id: "p2",
				project_title_snapshot: "Acme App",
				basis: "contract_scope",
				status: "active",
				linked_at: "2026-08-01T00:00:00Z",
				ended_at: null,
			},
		],
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
		role_title: "Frontend developer",
		status: "active",
		started_at: "2026-10-01T01:00:00.000Z",
		ended_at: null,
		...over,
	};
}

function renderCard(eng: Engagement = engagement()) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	render(<EngagementAssignmentsCard engagement={eng} now={NOW} />, {
		wrapper,
	});
	return { client };
}

beforeEach(() => {
	useAuthStore.setState({ user: { id: HIRER } as never });
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	for (const fn of Object.values(toast)) fn.mockReset();
	useAuthStore.setState({ user: null });
});

describe("EngagementAssignmentsCard", () => {
	it("lists the talent's active assignments for the hirer, with Assign and End", async () => {
		vi.spyOn(engagementAssignmentsService, "list").mockResolvedValue([
			row(),
			row({
				id: "a0",
				project_id: "p2",
				project_title_snapshot: "Acme App",
				status: "ended",
				role_title: null,
				started_at: "2026-09-01T01:00:00.000Z",
				ended_at: "2026-09-20T01:00:00.000Z",
			}),
		]);
		renderCard();

		expect(await screen.findByText("Acme Website")).toBeTruthy();
		expect(
			screen.getByText("The projects Leo Cruz works on under this agreement."),
		).toBeTruthy();
		expect(
			screen.getByText("Leo Cruz · Frontend developer · Since Oct 1"),
		).toBeTruthy();
		expect(screen.getByText("Acme Website").getAttribute("href")).toBe(
			"/project/p1/overview",
		);
		expect(
			screen.getByRole("button", { name: "Assign to project" }),
		).toBeTruthy();
		// Each row's End names its project for screen readers.
		expect(
			screen.getAllByRole("button", { name: /^End assignment/ }),
		).toHaveLength(1);
		expect(
			screen.getByRole("button", { name: "End assignment: Acme Website" })
				.textContent,
		).toBe("End assignment");

		// Ended rows wait behind a toggle and have no actions.
		expect(screen.queryByText("Acme App")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Show ended (1)" }));
		expect(screen.getByText("Acme App")).toBeTruthy();
		expect(screen.getByText("Leo Cruz · Sep 1 – Sep 20")).toBeTruthy();
		expect(
			screen.getAllByRole("button", { name: /^End assignment/ }),
		).toHaveLength(1);
		expect(screen.getByText("Ended")).toBeTruthy();
	});

	it("shows the client hirer masked rows and no actions (L22)", async () => {
		vi.spyOn(engagementAssignmentsService, "list").mockResolvedValue([
			row({
				worker_user_id: null,
				worker_label: "Delivery team",
				talent_engagement_id: null,
				client_engagement_id: "eng-1",
				role_title: null,
			}),
		]);
		renderCard(
			engagement({ kind: "client_services", viewer_position: "hirer" }),
		);

		expect(await screen.findByText("Delivery team · Since Oct 1")).toBeTruthy();
		expect(screen.queryByText(/Leo/)).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Assign to project" }),
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: /^End assignment/ }),
		).toBeNull();
	});

	it("reads the consultant's own row as You", async () => {
		vi.spyOn(engagementAssignmentsService, "list").mockResolvedValue([
			row({
				worker_user_id: HIRER,
				worker_label: "Ana Reyes",
				client_engagement_id: "eng-1",
				talent_engagement_id: null,
				role_title: null,
			}),
		]);
		renderCard(
			engagement({ kind: "client_services", viewer_position: "provider" }),
		);
		expect(await screen.findByText("You · Since Oct 1")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "End assignment: Acme Website" }),
		).toBeTruthy();
	});

	it("says what to do when nothing is assigned", async () => {
		vi.spyOn(engagementAssignmentsService, "list").mockResolvedValue([]);
		renderCard();
		expect(
			await screen.findByText(
				"Assign Leo Cruz to a project so they can log time under this agreement.",
			),
		).toBeTruthy();
	});

	it("offers no Assign on an ended engagement", async () => {
		vi.spyOn(engagementAssignmentsService, "list").mockResolvedValue([]);
		renderCard(engagement({ status: "ended" }));
		expect(
			await screen.findByText(
				"No one is assigned to a project under this agreement yet.",
			),
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Assign to project" }),
		).toBeNull();
	});

	it("reads a failed list as people copy, never the server text", async () => {
		vi.spyOn(engagementAssignmentsService, "list").mockRejectedValue(
			new TimeApiError({
				status: 404,
				code: "HTTP_404" as never,
				message: "Engagement not found",
			}),
		);
		renderCard();
		expect(
			await screen.findByText(
				"This engagement doesn't exist or you can't open it.",
			),
		).toBeTruthy();
	});

	it("keeps 'Ask a project admin to add Leo Cruz.' after an assignment that needs access (L25)", async () => {
		const list = vi
			.spyOn(engagementAssignmentsService, "list")
			.mockResolvedValue([]);
		const create = vi
			.spyOn(engagementAssignmentsService, "create")
			.mockResolvedValue({ ...row(), access_needed: true });
		renderCard();

		fireEvent.click(
			await screen.findByRole("button", { name: "Assign to project" }),
		);
		const dialog = await screen.findByRole("dialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Assign" }));

		await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
		expect(create.mock.calls[0]).toEqual([
			"eng-1",
			expect.objectContaining({ project_id: "p1" }),
		]);
		const status = await screen.findByRole("status");
		expect(status.textContent).toContain(
			"Leo Cruz is assigned to Acme Website.",
		);
		expect(status.textContent).toContain(
			"Ask a project admin to add Leo Cruz.",
		);
		expect(toast.success).toHaveBeenCalledWith(
			"Leo Cruz is assigned to Acme Website.",
		);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		// The list is refetched after the write.
		await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(1));

		fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
		expect(screen.queryByRole("status")).toBeNull();
	});

	it("shows no access notice when the worker already has access", async () => {
		vi.spyOn(engagementAssignmentsService, "list").mockResolvedValue([]);
		vi.spyOn(engagementAssignmentsService, "create").mockResolvedValue({
			...row(),
			access_needed: false,
		});
		renderCard();
		fireEvent.click(
			await screen.findByRole("button", { name: "Assign to project" }),
		);
		const dialog = await screen.findByRole("dialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Assign" }));
		await waitFor(() => expect(toast.success).toHaveBeenCalled());
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(screen.queryByRole("status")).toBeNull();
	});

	it("ends an assignment after the running-timer warning (L37)", async () => {
		vi.spyOn(engagementAssignmentsService, "list").mockResolvedValue([row()]);
		const end = vi
			.spyOn(engagementAssignmentsService, "end")
			.mockResolvedValue(
				row({ status: "ended", ended_at: "2026-10-06T04:00:00.000Z" }),
			);
		renderCard();

		fireEvent.click(
			await screen.findByRole("button", {
				name: "End assignment: Acme Website",
			}),
		);
		const dialog = await screen.findByRole("dialog");
		expect(
			within(dialog).getByText(
				"Ending this stops Leo Cruz's running timer at the end time.",
			),
		).toBeTruthy();
		fireEvent.click(
			within(dialog).getByRole("button", { name: "End assignment" }),
		);

		await waitFor(() => expect(end).toHaveBeenCalledTimes(1));
		expect(end.mock.calls[0]).toEqual([
			"eng-1",
			"a1",
			{ ended_at: undefined, reason: "" },
		]);
		await waitFor(() =>
			expect(toast.success).toHaveBeenCalledWith(
				"The assignment to Acme Website has ended.",
			),
		);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});
});
