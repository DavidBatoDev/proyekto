/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ native: false }));
vi.mock("@/lib/platform", () => ({ isNativeApp: () => platform.native }));
vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		success: vi.fn(),
		error: vi.fn(),
		warning: vi.fn(),
		info: vi.fn(),
	}),
}));
vi.mock("@/hooks/useProjectQueries", () => ({
	useProjectMembersQuery: () => ({ data: [], isPending: false }),
}));
vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useMyWorkspacesQuery: () => ({
		data: [{ id: "ws-prod", name: "Prodigitality Workspace", slug: "prod" }],
		isPending: false,
	}),
}));
const teams = vi.hoisted(() => ({
	mine: [] as Array<Record<string, unknown>>,
	attached: [] as Array<Record<string, unknown>>,
}));
vi.mock("@/services/teams.service", () => ({
	listMyTeams: () => Promise.resolve(teams.mine),
	listProjectTeams: () => Promise.resolve(teams.attached),
	listTeamMembers: () => Promise.resolve([]),
	attachTeam: vi.fn(),
}));

import { attachTeam } from "@/services/teams.service";
import { ATTACH_TEAM_COPY, AttachTeamDialog } from "./AttachTeamDialog";

const BANNED = /\b(contracts?|rates?|payouts?|invoices?|invoicing)\b/i;

function team(id: string, name: string, workspaceId: string | null) {
	return {
		id,
		name,
		workspace_id: workspaceId,
		avatar_url: null,
		owner_id: "o",
		description: null,
		is_personal: false,
		time_tracking_enabled: true,
	};
}

function renderDialog() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const utils = render(
		<QueryClientProvider client={client}>
			<AttachTeamDialog projectId="p1" currentUserId="me" onClose={() => {}} />
		</QueryClientProvider>,
	);
	return { ...utils, client };
}

beforeEach(() => {
	platform.native = false;
	teams.mine = [
		team("t1", "Prodigitality Services Inc. Team", "ws-prod"),
		team("t2", "Hidden Home Team", "ws-unknown"),
	];
	teams.attached = [];
});

afterEach(() => {
	cleanup();
	vi.mocked(attachTeam).mockReset();
});

describe("AttachTeamDialog › time consent (ux.md › Project Surfaces, L21)", () => {
	it("names the team's workspace once a team is picked", async () => {
		renderDialog();
		fireEvent.click(
			await screen.findByRole("button", {
				name: /Prodigitality Services Inc\. Team/,
			}),
		);
		expect(
			(await screen.findByTestId("attach-team-time-consent")).textContent,
		).toBe(
			"Time this team logs here is approved in Prodigitality Workspace. Approvers who can't open this project see hours only.",
		);
	});

	it("falls back to the team's workspace when the caller can't see it", async () => {
		renderDialog();
		fireEvent.click(
			await screen.findByRole("button", { name: /Hidden Home Team/ }),
		);
		expect(
			(await screen.findByTestId("attach-team-time-consent")).textContent,
		).toContain("approved in the team's workspace.");
	});

	it("says nothing about time before a team is picked", async () => {
		renderDialog();
		await screen.findByRole("button", { name: /Hidden Home Team/ });
		expect(screen.queryByTestId("attach-team-time-consent")).toBeNull();
	});

	it("builds the sentence from any workspace name", () => {
		expect(ATTACH_TEAM_COPY.timeConsent("Acme")).toBe(
			"Time this team logs here is approved in Acme. Approvers who can't open this project see hours only.",
		);
		expect(ATTACH_TEAM_COPY.timeConsent("  ")).toContain(
			"the team's workspace",
		);
	});
});

describe("AttachTeamDialog › after attaching", () => {
	it("refreshes who can log here and the For options", async () => {
		vi.mocked(attachTeam).mockResolvedValue(
			undefined as unknown as Awaited<ReturnType<typeof attachTeam>>,
		);
		const { client } = renderDialog();
		const invalidate = vi.spyOn(client, "invalidateQueries");
		fireEvent.click(
			await screen.findByRole("button", {
				name: /Prodigitality Services Inc\. Team/,
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: "Attach team" }));
		await waitFor(() => expect(attachTeam).toHaveBeenCalledTimes(1));
		await waitFor(() =>
			expect(invalidate).toHaveBeenCalledWith({
				queryKey: ["time", "loggers"],
			}),
		);
		for (const queryKey of [
			["time", "logging-for"],
			["time", "me", "projects"],
		]) {
			expect(invalidate).toHaveBeenCalledWith({ queryKey });
		}
	});
});

describe("AttachTeamDialog on native (ux.md › Mobile)", () => {
	it("never says contract, rate, payout or invoice", async () => {
		platform.native = true;
		renderDialog();
		fireEvent.click(
			await screen.findByRole("button", {
				name: /Prodigitality Services Inc\. Team/,
			}),
		);
		await screen.findByTestId("attach-team-time-consent");
		await waitFor(() =>
			expect(document.body.textContent ?? "").toContain("primary one"),
		);
		expect(document.body.textContent ?? "").not.toMatch(BANNED);
		expect(document.body.querySelector('a[href*="/engagements"]')).toBeNull();
	});

	it("keeps both primary-team lines free of the banned words", () => {
		expect(ATTACH_TEAM_COPY.primaryHint(true)).not.toMatch(BANNED);
		expect(ATTACH_TEAM_COPY.firstTeam(true)).not.toMatch(BANNED);
		// The web keeps its precise wording.
		expect(ATTACH_TEAM_COPY.primaryHint(false)).toMatch(/contracts/);
	});
});
