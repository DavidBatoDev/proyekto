/* @vitest-environment jsdom */

/**
 * TeamGroupCard (W3-review-b #2): the logging-context resolver tries curated
 * teams primary first, so "Make primary" can change which team a person on
 * two attached teams logs for. Who can log and the For options refresh.
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
vi.mock("@/components/team/TeamAvatar", () => ({ TeamAvatar: () => null }));
vi.mock("@/services/teams.service", () => ({ updateProjectTeam: vi.fn() }));

import { updateProjectTeam } from "@/services/teams.service";
import { TeamGroupCard } from "./TeamGroupCard";
import type { PeopleTeamGroup } from "./useProjectPeople";

const group: PeopleTeamGroup = {
	attachment: {
		project_id: "p1",
		team_id: "t2",
		is_primary: false,
		attached_by: null,
		attached_at: "2026-09-01T00:00:00.000Z",
	},
	team: { id: "t2", name: "Design", avatar_url: null } as never,
	people: [],
};

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function renderCard() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const invalidate = vi.spyOn(client, "invalidateQueries");
	render(
		<QueryClientProvider client={client}>
			<TeamGroupCard
				projectId="p1"
				group={group}
				allPeople={[]}
				curatedTeamIdsByUserId={new Map()}
				teamNameById={{}}
				canManageTeams
				canManageMembers={false}
				defaultOpen={false}
				onOpenPerson={vi.fn()}
				onAddMember={vi.fn()}
			/>
		</QueryClientProvider>,
	);
	return { invalidate };
}

describe("TeamGroupCard › Make primary", () => {
	it("refreshes who can log here and the For options", async () => {
		vi.mocked(updateProjectTeam).mockResolvedValue({} as never);
		const { invalidate } = renderCard();
		fireEvent.click(screen.getByRole("button", { name: "Make primary" }));
		await waitFor(() =>
			expect(toast.success).toHaveBeenCalledWith(
				"Design is now the primary team",
			),
		);
		expect(updateProjectTeam).toHaveBeenCalledWith("p1", "t2", {
			is_primary: true,
		});
		for (const queryKey of [
			["time", "loggers"],
			["time", "logging-for"],
		]) {
			expect(invalidate).toHaveBeenCalledWith({ queryKey });
		}
	});

	it("refreshes nothing time-related when it fails", async () => {
		vi.mocked(updateProjectTeam).mockRejectedValue(new Error("Nope"));
		const { invalidate } = renderCard();
		fireEvent.click(screen.getByRole("button", { name: "Make primary" }));
		await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nope"));
		expect(invalidate).not.toHaveBeenCalledWith({
			queryKey: ["time", "loggers"],
		});
	});
});
