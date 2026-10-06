/* @vitest-environment jsdom */

/**
 * The time rebuild's part of account deletion (ux.md › Project Surfaces, D70):
 * the open-timesheets sentence, the preflight's open-time blockers and
 * decisions, and the refusal when time comes open after the preflight. The
 * rest of the flow is covered where its pieces live (accountTeardown,
 * accountDeletionCopy).
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type {
	DeletionDecision,
	DeletionFailure,
	DeletionPreflight,
} from "@/services/accountDeletion.service";

const mocks = vi.hoisted(() => ({
	native: false,
	getPreflight: vi.fn(),
	deleteAccount: vi.fn(),
	tearDown: vi.fn(),
	leave: vi.fn(),
}));

vi.mock("@/lib/platform", () => ({ isNativeApp: () => mocks.native }));

vi.mock("@/services/accountDeletion.service", () => ({
	getDeletionPreflight: mocks.getPreflight,
	deleteAccount: mocks.deleteAccount,
	requestDeletionCode: vi.fn(),
	// The tests reject with a ready-made failure.
	toDeletionFailure: (error: unknown) => error as DeletionFailure,
}));

vi.mock("@/components/settings/delete-account/accountTeardown", () => ({
	tearDownDeletedAccount: mocks.tearDown,
	leaveForGoodbye: mocks.leave,
}));

vi.mock("@/stores/authStore", () => ({
	useUser: () => ({ id: "user-1" }),
}));

// Partial: createFileRoute needs the real router internals.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	Link: ({ to, children }: { to: string; children?: ReactNode }) => (
		<a href={to}>{children}</a>
	),
}));

import { Route } from "./delete-account";

// The router plugin code-splits the page, so `component` is a lazy wrapper:
// load its chunk once up front rather than inside the first test's timeout.
beforeAll(async () => {
	const component = Route.options.component as unknown as {
		preload?: () => Promise<void>;
	};
	await component.preload?.();
}, 30_000);

const OPEN_TIMESHEETS =
	"Your open timesheets will be sent for approval when you delete your account.";
const TEAM_OPEN =
	"This team has time waiting for approval or payment. Hand it to another member instead of deleting it.";
const WORKSPACE_OPEN =
	"This workspace has time waiting for approval or payment. Hand it to another member instead of deleting it.";

/** ux.md › Mobile: never these words in the app, nor an /engagements link. */
const FORBIDDEN =
	/\b(?:contracts?|rates?|payouts?|invoices?|invoic(?:ed|ing))\b/i;

type PreflightWithTime = DeletionPreflight & {
	blockers?: unknown[];
	decisions: (DeletionDecision & { has_open_time?: boolean })[];
};

function preflight(
	overrides: Partial<PreflightWithTime> = {},
): PreflightWithTime {
	return {
		user_id: "user-1",
		generated_at: "2026-10-06T00:00:00Z",
		decisions: [],
		blockers: [],
		will_be_deleted: {
			workspaces: [],
			teams: [],
			projects: 0,
			standalone_roadmaps: 0,
			devices: 0,
			api_tokens: 0,
			identity_documents: 0,
		},
		will_transfer: { projects: [], workspaces_left: [], teams_left: [] },
		// Financial counts stay 0: the "records we must keep" bullet is the
		// deletion flow's own copy, not the time copy under test.
		will_be_kept: {
			attribution: "Deleted user",
			archived_teams: 0,
			chat_messages: 0,
			comments: 0,
			decisions: 0,
			deliverables: 0,
			change_requests: 0,
			risks: 0,
			activity_entries: 0,
			contracts: 0,
			invoices: 0,
			payouts: 0,
		},
		auth: { has_password: true, providers: ["email"] },
		warnings: [],
		preflight_token: "t",
		...overrides,
	};
}

function decision(
	overrides: Partial<DeletionDecision & { has_open_time?: boolean }> = {},
): DeletionDecision & { has_open_time?: boolean } {
	return {
		kind: "team",
		id: "team-1",
		name: "Prodigitality Services Inc. Team",
		workspace_id: "ws-1",
		member_count: 3,
		can_delete: true,
		is_paid: false,
		candidates: [
			{
				user_id: "user-2",
				display_name: "Ana Reyes",
				email: null,
				avatar_url: null,
				role: "admin",
				joined_at: "2026-01-01T00:00:00Z",
			},
		],
		...overrides,
	};
}

function renderPage() {
	const Page = Route.options.component as ComponentType;
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<Page />
		</QueryClientProvider>,
	);
}

const continueButton = () =>
	screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;

beforeEach(() => {
	mocks.native = false;
	mocks.getPreflight.mockReset();
	mocks.deleteAccount.mockReset();
});

afterEach(cleanup);

describe("delete account: open time", () => {
	it("says open timesheets are sent for approval", async () => {
		mocks.getPreflight.mockResolvedValue(preflight());
		renderPage();
		expect(await screen.findByText(OPEN_TIMESHEETS)).toBeTruthy();
		expect(continueButton().disabled).toBe(false);
	});

	it("names each workspace or team whose open time blocks deletion, and holds Continue", async () => {
		mocks.getPreflight.mockResolvedValue(
			preflight({
				blockers: [
					{
						kind: "workspace",
						id: "ws-9",
						name: "Acme",
						code: "WORKSPACE_HAS_OPEN_TIME",
					},
					{
						kind: "team",
						id: "t-9",
						name: "Design",
						code: "TEAM_HAS_OPEN_TIME",
					},
				],
			}),
		);
		renderPage();
		expect(await screen.findByText("Acme")).toBeTruthy();
		expect(screen.getByText("Design")).toBeTruthy();
		expect(screen.getByText(WORKSPACE_OPEN)).toBeTruthy();
		expect(screen.getByText(TEAM_OPEN)).toBeTruthy();

		const button = continueButton();
		expect(button.disabled).toBe(true);
		const describedBy = button.getAttribute("aria-describedby");
		expect(describedBy).toBeTruthy();
		expect(
			document.getElementById(describedBy as string)?.textContent,
		).toContain(TEAM_OPEN);
	});

	it("reads a blocker without a known code by its kind, and skips malformed ones", async () => {
		mocks.getPreflight.mockResolvedValue(
			preflight({
				blockers: [
					{ kind: "team", id: "t-1", name: "Ops" },
					{ kind: "project", id: "p-1", name: "Nope" },
					null,
				],
			}),
		);
		renderPage();
		expect(await screen.findByText("Ops")).toBeTruthy();
		expect(screen.getByText(TEAM_OPEN)).toBeTruthy();
		expect(screen.queryByText("Nope")).toBeNull();
	});

	it("explains a decision whose open time rules out deleting it", async () => {
		mocks.getPreflight.mockResolvedValue(
			preflight({
				decisions: [
					decision({ can_delete: false, has_open_time: true }),
					decision({
						kind: "workspace",
						id: "ws-2",
						name: "Acme",
						has_open_time: false,
					}),
				],
			}),
		);
		renderPage();
		fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
		expect(await screen.findByText(TEAM_OPEN)).toBeTruthy();
		// Only the decision with open time gets the note.
		expect(screen.queryByText(WORKSPACE_OPEN)).toBeNull();
	});

	it("goes back to the summary when time came open after the preflight", async () => {
		mocks.getPreflight.mockResolvedValueOnce(preflight()).mockResolvedValueOnce(
			preflight({
				blockers: [
					{
						kind: "workspace",
						id: "ws-9",
						name: "Acme",
						code: "WORKSPACE_HAS_OPEN_TIME",
					},
				],
			}),
		);
		mocks.deleteAccount.mockRejectedValue({
			code: "workspace_has_open_time",
			message: WORKSPACE_OPEN,
			accountIntact: true,
			status: 409,
		} satisfies DeletionFailure);

		renderPage();
		fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
		fireEvent.change(await screen.findByLabelText(/to confirm/), {
			target: { value: "delete my account" },
		});
		fireEvent.change(screen.getByLabelText("Enter your password"), {
			target: { value: "hunter2" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));

		await waitFor(() => expect(mocks.getPreflight).toHaveBeenCalledTimes(2));
		expect(await screen.findByText("Nothing was deleted")).toBeTruthy();
		expect(screen.getByText("Acme")).toBeTruthy();
		expect(continueButton().disabled).toBe(true);
		expect(mocks.tearDown).not.toHaveBeenCalled();
	});
});

describe("delete account: open time in the installed app", () => {
	it("keeps the time copy free of money and agreement words and of /engagements links", async () => {
		mocks.native = true;
		mocks.getPreflight.mockResolvedValue(
			preflight({
				blockers: [
					{
						kind: "workspace",
						id: "ws-9",
						name: "Acme",
						code: "WORKSPACE_HAS_OPEN_TIME",
					},
					{
						kind: "team",
						id: "t-9",
						name: "Design",
						code: "TEAM_HAS_OPEN_TIME",
					},
				],
			}),
		);
		const { container } = renderPage();
		expect(await screen.findByText(OPEN_TIMESHEETS)).toBeTruthy();
		for (const line of [OPEN_TIMESHEETS, TEAM_OPEN, WORKSPACE_OPEN]) {
			expect(screen.getByText(line)).toBeTruthy();
			expect(line).not.toMatch(FORBIDDEN);
		}
		expect(container.textContent).not.toMatch(FORBIDDEN);
		expect(container.querySelector('a[href*="/engagements"]')).toBeNull();
	});
});
