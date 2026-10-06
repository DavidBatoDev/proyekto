/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({ ...toasts, warning: vi.fn(), info: vi.fn() }),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({
			children,
			to,
			params,
			className,
			...rest
		}: {
			children?: ReactNode;
			to: string;
			params?: Record<string, string>;
			className?: string;
			"aria-label"?: string;
		}) => {
			let href = to;
			for (const [key, value] of Object.entries(params ?? {})) {
				href = href.replace(`$${key}`, value);
			}
			return (
				<a href={href} className={className} aria-label={rest["aria-label"]}>
					{children}
				</a>
			);
		},
	};
});
vi.mock("@/components/team-time/RateBudgetCalculator", () => ({
	RateBudgetCalculator: () => <div data-testid="rate-calculator" />,
}));
const state = vi.hoisted(() => ({
	perms: { time: { log: true, view_team_logs: true } } as Record<
		string,
		unknown
	> | null,
}));
vi.mock("@/hooks/useProjectQueries", () => ({
	useProjectMyPermissionsQuery: () => ({
		data: state.perms ?? undefined,
		isPending: state.perms === null,
	}),
}));
vi.mock("@/stores/authStore", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/stores/authStore")>()),
	useUser: () => ({ id: ME }),
}));
const engagements = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/services/engagement.service", () => ({
	engagementService: { list: engagements.list },
}));
const teamsApi = vi.hoisted(() => ({
	attached: [] as Array<Record<string, unknown>>,
	members: [] as Array<Record<string, unknown>>,
	curated: [] as Array<Record<string, unknown>>,
	rates: [] as Array<Record<string, unknown>>,
	update: vi.fn(),
}));
vi.mock("@/services/teams.service", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/services/teams.service")>()),
	listProjectTeams: () => Promise.resolve(teamsApi.attached),
	listTeamMembers: () => Promise.resolve(teamsApi.members),
	listCuratedMembers: () => Promise.resolve(teamsApi.curated),
	getTeam: (id: string) =>
		Promise.resolve({ id, name: "Design", member_rates_enabled: true }),
	listMemberRates: () => Promise.resolve(teamsApi.rates),
	updateMemberRate: teamsApi.update,
}));

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ENGAGEMENT_ID = "44444444-4444-4444-8444-444444444444";

import { TimeApiError, timeService } from "@/services/time.service";
import { ProjectTimeSettings } from "./ProjectTimeSettings";

function renderSettings() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<ProjectTimeSettings projectId={PROJECT_ID} />
		</QueryClientProvider>,
	);
}

function apiError(status: number, code: string) {
	return new TimeApiError({ status, code, message: "nope" });
}

beforeEach(() => {
	state.perms = { time: { log: true, view_team_logs: true } };
	engagements.list.mockReset();
	engagements.list.mockResolvedValue([]);
	teamsApi.attached = [];
	teamsApi.members = [];
	teamsApi.curated = [];
	teamsApi.rates = [];
	teamsApi.update.mockReset();
	toasts.success.mockReset();
	toasts.error.mockReset();
	vi.spyOn(timeService, "getProjectLoggers").mockResolvedValue({ people: [] });
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("Project settings › Time › Who can log time here (A11)", () => {
	it("gives each person where their time goes, and ends with viewers and commenters", async () => {
		vi.spyOn(timeService, "getProjectLoggers").mockResolvedValue({
			people: [
				{
					user_id: "u-maria",
					display_name: "Maria Santos",
					role: "editor",
					reason: "team",
					label: "Prodigitality Services Inc. Team",
					options: 1,
				},
				{
					user_id: ME,
					display_name: "Me Myself",
					role: "editor",
					reason: "personal",
					label: "just you",
					options: 1,
				},
				{
					user_id: "masked:row-9",
					display_name: "Delivery team member",
					role: "editor",
					reason: "workspace",
					label: "Acme",
					options: 1,
				},
			],
		});
		renderSettings();
		const section = await screen.findByRole("region", {
			name: "Who can log time here",
		});
		await waitFor(() =>
			expect(section.textContent).toContain(
				"Maria Santos(Prodigitality Services Inc. Team)",
			),
		);
		expect(section.textContent).toContain("You(editor · just you)");
		expect(section.textContent).toContain("Delivery team member(Acme)");
		expect(section.textContent).not.toContain("Me Myself");
		expect(section.textContent).toContain(
			"Viewers and commenters can't log time.",
		);
		expect(section.id).toBe("who-can-log");
		expect(section.querySelectorAll("[data-masked-person]").length).toBe(1);
	});

	it("isn't shown to someone the server won't answer (not a project admin)", async () => {
		vi.spyOn(timeService, "getProjectLoggers").mockRejectedValue(
			apiError(404, "HTTP_404"),
		);
		renderSettings();
		await screen.findByRole("region", { name: "Hour limits" });
		await waitFor(() =>
			expect(
				screen.queryByRole("region", { name: "Who can log time here" }),
			).toBeNull(),
		);
	});

	it(
		"says it couldn't load, with Try again, on any other failure",
		{
			timeout: 15000,
		},
		async () => {
			const spy = vi
				.spyOn(timeService, "getProjectLoggers")
				.mockRejectedValue(apiError(500, "TIME_INTERNAL"));
			renderSettings();
			const section = await screen.findByRole("region", {
				name: "Who can log time here",
			});
			// A 5xx is retried twice (retryTimeQuery) before it shows.
			await waitFor(
				() => expect(section.querySelector('[role="alert"]')).not.toBeNull(),
				{ timeout: 8000 },
			);
			spy.mockResolvedValue({ people: [] });
			fireEvent.click(
				screen.getAllByRole("button", { name: "Try again" })[0] as HTMLElement,
			);
			await waitFor(() =>
				expect(section.textContent).toContain(
					"Nobody can log time here yet. Editors and above can.",
				),
			);
		},
	);

	it("notes a list cut at 200 people", async () => {
		vi.spyOn(timeService, "getProjectLoggers").mockResolvedValue({
			people: [
				{
					user_id: "u1",
					display_name: "A",
					role: "editor",
					reason: "team",
					label: "Design",
				},
			],
			truncated: true,
		});
		renderSettings();
		expect(
			await screen.findByText(
				"More than 200 people can log time here. The first 200 are listed.",
			),
		).toBeTruthy();
	});
});

describe("Project settings › Time › Client sees (read-only)", () => {
	it("shows each client agreement's level, with View terms on the web", async () => {
		engagements.list.mockResolvedValue([
			{
				id: ENGAGEMENT_ID,
				kind: "client_services",
				status: "active",
				viewer_position: "provider",
				counterparty: {
					display_name_snapshot: "Carla Client",
					team_name_snapshot: "Acme Corp",
				},
				project_links: [{ project_id: PROJECT_ID, status: "active" }],
				current_settings: { client_hours_detail_level: "detailed" },
			},
		]);
		renderSettings();
		const section = await screen.findByRole("region", { name: "Client sees" });
		await waitFor(() =>
			expect(section.textContent).toContain("Acme Corp · agreement"),
		);
		expect(section.textContent).toContain("Each entry's date, task and hours");
		expect(section.textContent).toContain("These come from the signed terms.");
		expect(
			screen
				.getByRole("link", { name: "View terms: Acme Corp" })
				.getAttribute("href"),
		).toBe(`/engagements/${ENGAGEMENT_ID}`);
		// Read-only: nothing to change here.
		expect(section.querySelector("input, select")).toBeNull();
	});

	it("says when no client agreement covers the project", async () => {
		renderSettings();
		expect(
			await screen.findByText(
				"None of the client agreements you're part of covers this project.",
			),
		).toBeTruthy();
	});
});

describe("Project settings › Time › Hour limits", () => {
	beforeEach(() => {
		teamsApi.attached = [{ team_id: "t1", is_primary: true }];
		teamsApi.members = [
			{
				id: "m1",
				user_id: "u-maria",
				position: "Designer",
				user: { display_name: "Maria Santos" },
			},
		];
		teamsApi.curated = [{ user_id: "u-maria" }];
	});

	it("relabels the switch and saves the limits", async () => {
		teamsApi.rates = [
			{
				id: "rate-1",
				end_date: null,
				weekly_limit_hours: 40,
				monthly_limit_hours: null,
				overtime_requires_approval: false,
			},
		];
		teamsApi.update.mockResolvedValue({});
		renderSettings();
		const block = await screen.findByRole("checkbox", {
			name: "Block time past a limit (otherwise people just get a warning)",
		});
		const weekly = screen.getByRole("spinbutton", {
			name: "Weekly hours: Maria Santos",
		}) as HTMLInputElement;
		expect(weekly.value).toBe("40");
		const save = screen.getByRole("button", { name: "Save: Maria Santos" });
		expect((save as HTMLButtonElement).disabled).toBe(true);

		fireEvent.click(block);
		fireEvent.change(weekly, { target: { value: "35" } });
		fireEvent.click(save);
		await waitFor(() =>
			expect(teamsApi.update).toHaveBeenCalledWith("t1", "u-maria", "rate-1", {
				weekly_limit_hours: 35,
				monthly_limit_hours: null,
				overtime_requires_approval: true,
			}),
		);
		await waitFor(() =>
			expect(toasts.success).toHaveBeenCalledWith("Hour limits saved"),
		);
		expect(screen.getByTestId("rate-calculator")).toBeTruthy();
	});

	it("explains a member with no rate yet (web)", async () => {
		renderSettings();
		expect(
			await screen.findByText(
				"No rate on this project yet. Add one in the team's Rates first.",
			),
		).toBeTruthy();
	});

	it("says no team is attached", async () => {
		teamsApi.attached = [];
		renderSettings();
		expect(
			await screen.findByText(
				"No team is attached to this project yet. Attach one under Settings › Teams to set hour limits.",
			),
		).toBeTruthy();
	});
});

describe("Project settings › Time › access", () => {
	it("shows a reason card without everyone's time", () => {
		state.perms = { time: { log: true, view_team_logs: false } };
		renderSettings();
		expect(screen.getByText("You don't have access")).toBeTruthy();
		expect(screen.queryByRole("region", { name: "Hour limits" })).toBeNull();
		expect(timeService.getProjectLoggers).not.toHaveBeenCalled();
	});
});
