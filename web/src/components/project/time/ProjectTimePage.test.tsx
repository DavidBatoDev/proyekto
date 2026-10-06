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
vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		success: vi.fn(),
		error: vi.fn(),
		warning: vi.fn(),
		info: vi.fn(),
	}),
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
			search,
			hash,
			className,
			...rest
		}: {
			children?: ReactNode;
			to: string;
			params?: Record<string, string>;
			search?: Record<string, string>;
			hash?: string;
			className?: string;
			"aria-label"?: string;
		}) => {
			let href = to;
			for (const [key, value] of Object.entries(params ?? {})) {
				href = href.replace(`$${key}`, value);
			}
			const query = new URLSearchParams(search ?? {}).toString();
			if (query) href += `?${query}`;
			if (hash) href += `#${hash}`;
			return (
				<a href={href} className={className} aria-label={rest["aria-label"]}>
					{children}
				</a>
			);
		},
	};
});
vi.mock("@/hooks/useEntitlements", () => ({
	useEntitlements: (workspaceId?: string | null) => ({
		status: workspaceId ? "ready" : "unavailable",
		usage: null,
		plan: "business",
		upgradePlan: null,
		isComplimentary: false,
		hasFeature: () => true,
	}),
}));

const state = vi.hoisted(() => ({
	perms: null as null | Record<string, unknown>,
	permsError: null as unknown,
	project: {
		id: "",
		title: "Acme Website",
		workspace_id: "ws1",
	} as Record<string, unknown>,
	money: {
		isApprover: true,
		canPay: true,
		hasRates: false,
		slug: "acme",
	},
}));
vi.mock("@/hooks/useProjectQueries", () => ({
	useProjectMyPermissionsQuery: () =>
		state.permsError
			? {
					data: undefined,
					isPending: false,
					isError: true,
					error: state.permsError,
					refetch: vi.fn(),
				}
			: {
					data: state.perms ?? undefined,
					isPending: state.perms === null,
					isError: false,
					error: null,
					refetch: vi.fn(),
				},
	useProjectDetailQuery: () => ({ data: state.project, isPending: false }),
}));
vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useMyWorkspacesQuery: () => ({
		data: [{ id: "ws1", name: "Acme", slug: "acme", my_role: "owner" }],
	}),
}));
vi.mock("@/components/team-time/useTeamMoneyAccess", () => ({
	useTeamMoneyAccess: (teamId: string) => ({
		isApprover: state.money.isApprover,
		canPay: state.money.canPay,
		hasRates: state.money.hasRates,
		planWorkspace: { slug: state.money.slug },
		team: { id: teamId, name: "Design" },
	}),
}));
vi.mock("@/stores/authStore", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/stores/authStore")>()),
	useUser: () => ({ id: "me" }),
}));
const teams = vi.hoisted(() => ({
	attached: [] as Array<Record<string, unknown>>,
	mine: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/services/teams.service", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/services/teams.service")>()),
	listProjectTeams: () => Promise.resolve(teams.attached),
	listMyTeams: () => Promise.resolve(teams.mine),
}));
const engagements = vi.hoisted(() => ({
	list: vi.fn(),
}));
vi.mock("@/services/engagement.service", () => ({
	engagementService: { list: engagements.list },
}));

import {
	ENGAGEMENT_ID,
	entry,
	maskedAgreementEntry,
	NOW,
	PROJECT_ID,
	summary,
} from "@/components/time/report/__fixtures__/reportFixtures";
import { ApiError } from "@/lib/apiErrors";
import { timeService } from "@/services/time.service";
import type { ReportQuery } from "@/services/time.types";
import { ProjectTimePage, type ProjectTimePageProps } from "./ProjectTimePage";
import type { ProjectTimeSearch } from "./projectTimeModel";

function perms(over: {
	log?: boolean;
	view_team_logs?: boolean;
	access_time?: boolean;
	level?: "none" | "summary" | "detailed";
}) {
	return {
		access: { time: over.access_time ?? true },
		time: {
			log: over.log ?? false,
			view_team_logs: over.view_team_logs ?? false,
		},
		time_client_hours_level: over.level ?? "none",
	};
}

function renderPage(
	search: ProjectTimeSearch = {},
	over: Partial<ProjectTimePageProps> = {},
) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const props: ProjectTimePageProps = {
		projectId: PROJECT_ID,
		search,
		onSearchChange: vi.fn(),
		onRedirectMine: vi.fn(),
		now: NOW,
		...over,
	};
	const utils = render(
		<QueryClientProvider client={client}>
			<ProjectTimePage {...props} />
		</QueryClientProvider>,
	);
	return { ...utils, props };
}

/** The one-row probe answers `total`; the sections walk answers `items`. */
function mockEntries(total: number, items = [entry()]) {
	return vi
		.spyOn(timeService, "getReportEntries")
		.mockImplementation(async (q: ReportQuery) =>
			q.limit === 1
				? { items: items.slice(0, total ? 1 : 0), total, page: 1, limit: 1 }
				: { items, total: items.length, page: 1, limit: 200 },
		);
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
	state.perms = null;
	state.permsError = null;
	state.money = {
		isApprover: true,
		canPay: true,
		hasRates: false,
		slug: "acme",
	};
	teams.attached = [];
	teams.mine = [];
	engagements.list.mockReset();
	engagements.list.mockResolvedValue([]);
	vi.spyOn(timeService, "getReportSummary").mockResolvedValue(
		summary({ scope: { kind: "project", id: PROJECT_ID } }),
	);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("ProjectTimePage › Everyone", () => {
	it("shows the project's time in sections, with the view switch and the link to your own time", async () => {
		state.perms = perms({ log: true, view_team_logs: true, level: "summary" });
		mockEntries(2, [
			entry(),
			maskedAgreementEntry({ id: "mk", context_ref: "as2" }),
		]);
		renderPage();

		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
			"Time · Acme Website",
		);
		const yours = screen.getByRole("link", {
			name: "Your time on this project",
		});
		expect(yours.getAttribute("href")).toBe(`/time?project=${PROJECT_ID}`);

		const views = screen.getByRole("group", { name: "Time view" });
		expect(
			screen
				.getByRole("button", { name: "Everyone" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(views.textContent).toContain("Client hours");

		expect(
			await screen.findByRole("region", { name: "Design · team" }),
		).toBeTruthy();
		expect(
			screen.getByRole("region", {
				name: "Delivery team · agreement with Acme Corp",
			}),
		).toBeTruthy();
	});

	it("asks the report for the project scope, in sections", async () => {
		state.perms = perms({ view_team_logs: true });
		const spy = mockEntries(1);
		renderPage({ person: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
		await screen.findByRole("region", { name: "Design · team" });
		const scopes = spy.mock.calls.map(([q]) => q.scope);
		expect(
			scopes.every((s) => s.kind === "project" && s.id === PROJECT_ID),
		).toBe(true);
		// The walk keeps the person filter; the one-row probe is about the project.
		expect(spy.mock.calls.some(([q]) => q.member_user_id)).toBe(true);
		expect(
			spy.mock.calls.find(([q]) => q.limit === 1)?.[0].member_user_id,
		).toBeUndefined();
		// No switch with only one view.
		expect(screen.queryByRole("group", { name: "Time view" })).toBeNull();
		// No time.log: no link to your own time.
		expect(
			screen.queryByRole("link", { name: "Your time on this project" }),
		).toBeNull();
	});

	it("says no time yet, linking to who can log, when nobody ever logged here", async () => {
		state.perms = perms({ view_team_logs: true });
		mockEntries(0, []);
		renderPage();
		expect(
			await screen.findByText("No time on this project yet."),
		).toBeTruthy();
		expect(
			screen.getByText("Editors and above can track time here."),
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Who can log time here" })
				.getAttribute("href"),
		).toBe(`/project/${PROJECT_ID}/settings/time#who-can-log`);
	});

	it("links each team the caller manages to its payouts through the workspace path", async () => {
		state.perms = perms({ view_team_logs: true });
		teams.attached = [
			{ team_id: "t1", team: { id: "t1", name: "Design", avatar_url: null } },
			{ team_id: "t9", team: { id: "t9", name: "Not mine", avatar_url: null } },
		];
		teams.mine = [{ id: "t1", name: "Design" }];
		mockEntries(1);
		renderPage();
		const link = await screen.findByRole("link", { name: "Payouts: Design" });
		expect(link.getAttribute("href")).toBe("/w/acme/teams/t1/time/payouts");
		expect(screen.queryByText("Not mine")).toBeNull();
	});

	it("hides the money links from someone who doesn't manage the team", async () => {
		state.perms = perms({ view_team_logs: true });
		state.money.isApprover = false;
		teams.attached = [
			{ team_id: "t1", team: { id: "t1", name: "Design", avatar_url: null } },
		];
		teams.mine = [{ id: "t1", name: "Design" }];
		mockEntries(1);
		renderPage();
		await screen.findByRole("region", { name: "Design · team" });
		expect(screen.queryByRole("link", { name: /Payouts/ })).toBeNull();
	});

	it("keeps entry rows read-only: the entry read doesn't follow time.view_team_logs", async () => {
		state.perms = perms({ view_team_logs: true });
		mockEntries(1);
		renderPage();
		const work = await screen.findByText("Fix login bug");
		expect(work.closest("button")).toBeNull();
		expect(screen.queryByRole("button", { name: "Fix login bug" })).toBeNull();
	});

	it("switches views through the URL", async () => {
		state.perms = perms({ view_team_logs: true, level: "summary" });
		mockEntries(1);
		const { props } = renderPage();
		fireEvent.click(screen.getByRole("button", { name: "Client hours" }));
		expect(props.onSearchChange).toHaveBeenCalledWith({ view: "client" });
	});
});

describe("ProjectTimePage › Client hours", () => {
	it("shows approved hours per agreement at its level, with no names", async () => {
		state.perms = perms({ level: "summary" });
		engagements.list.mockResolvedValue([
			{
				id: ENGAGEMENT_ID,
				kind: "client_services",
				status: "active",
				viewer_position: "hirer",
				counterparty: {
					display_name_snapshot: "Ana Reyes",
					team_name_snapshot: "Pixel Studio",
				},
				project_links: [{ project_id: PROJECT_ID, status: "active" }],
				current_settings: { client_hours_detail_level: "summary" },
			},
		]);
		const summarySpy = vi
			.spyOn(timeService, "getReportSummary")
			.mockResolvedValue(
				summary({
					scope: { kind: "engagement", id: ENGAGEMENT_ID },
					total_seconds: 3600,
					payable_seconds: 3600,
					groups: [
						{
							key: "2026-09-21",
							label: "Sep 21–27",
							total_seconds: 3600,
							payable_seconds: 3600,
						},
					],
				}),
			);
		renderPage();
		expect(
			await screen.findByRole("region", { name: "Pixel Studio · agreement" }),
		).toBeTruthy();
		await waitFor(() =>
			expect(document.body.textContent).toContain("Sep 21–27"),
		);
		expect(engagements.list).toHaveBeenCalledWith({
			kind: "client_services",
			status: "active",
			project_id: PROJECT_ID,
		});
		expect(summarySpy.mock.calls[0][0]).toMatchObject({
			scope: { kind: "engagement", id: ENGAGEMENT_ID },
			group_by: "week",
		});
		expect(document.body.textContent).not.toContain("Ana Reyes");
		expect(screen.queryByRole("group", { name: "Time view" })).toBeNull();
	});

	it("says so, with Try again, when the agreements can't load", async () => {
		state.perms = perms({ level: "detailed" });
		engagements.list.mockRejectedValue(new Error("boom"));
		renderPage();
		// The agreements read retries once before it gives up.
		expect(
			await screen.findByText(
				"Proyekto couldn't load your client agreements.",
				undefined,
				{ timeout: 5000 },
			),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
	});
});

describe("ProjectTimePage › who lands where (L22, L55)", () => {
	it("sends someone who only logs here to their own Time page", async () => {
		state.perms = perms({ log: true });
		const { props } = renderPage();
		await waitFor(() => expect(props.onRedirectMine).toHaveBeenCalledTimes(1));
		// Meanwhile, the link card says where it lives.
		expect(
			screen.getByText("Your time on this project lives in Time."),
		).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Open" }).getAttribute("href"),
		).toBe(`/time?project=${PROJECT_ID}`);
	});

	it("shows the link card, without moving them, when they asked for a view they can't open", () => {
		state.perms = perms({ log: true });
		const { props } = renderPage({ view: "everyone" });
		expect(
			screen.getByText("Your time on this project lives in Time."),
		).toBeTruthy();
		expect(props.onRedirectMine).not.toHaveBeenCalled();
	});

	it("refuses with a reason card, never an empty page", () => {
		state.perms = perms({ access_time: false });
		renderPage();
		expect(
			screen.getByText("Time on this project isn't open to you."),
		).toBeTruthy();
	});

	it("refuses a viewer who only reads time here, rather than sending them to Time (P10)", () => {
		state.perms = perms({ access_time: true });
		const { props } = renderPage();
		expect(
			screen.getByText("Time on this project isn't open to you."),
		).toBeTruthy();
		expect(props.onRedirectMine).not.toHaveBeenCalled();
		expect(
			screen.queryByText("Your time on this project lives in Time."),
		).toBeNull();
	});

	it.each([403, 404])(
		"reads a refused permissions read (%i) as no access",
		(status) => {
			// The shape project.service's getMyPermissions really throws.
			state.permsError = new ApiError("No access", status);
			renderPage();
			expect(
				screen.getByText("Time on this project isn't open to you."),
			).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
		},
	);

	it.each([
		["a server error", new ApiError("Server error", 500)],
		["a dropped connection", new TypeError("Failed to fetch")],
	])(
		"offers Try again when the permissions read fails (%s)",
		(_label, error) => {
			state.permsError = error;
			renderPage();
			expect(
				screen.getByText(
					"Proyekto couldn't check your access to this project.",
				),
			).toBeTruthy();
			expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
		},
	);

	it("waits for permissions before deciding anything", () => {
		state.perms = null;
		const { container, props } = renderPage();
		expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
		expect(props.onRedirectMine).not.toHaveBeenCalled();
	});
});
