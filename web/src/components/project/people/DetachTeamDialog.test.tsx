/* @vitest-environment jsdom */

/**
 * DetachTeamDialog (W3-1b): detaching a team changes who can log time on the
 * project, so the time keys that depend on it are refreshed.
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
vi.mock("@/services/teams.service", () => ({ detachTeam: vi.fn() }));

import { detachTeam, type ProjectTeam } from "@/services/teams.service";
import { DetachTeamDialog } from "./DetachTeamDialog";

const WHO_CAN_LOG_KEYS = [
	["time", "loggers"],
	["time", "logging-for"],
	["time", "me", "projects"],
	["time", "me", "overview"],
];

const attachment: ProjectTeam = {
	project_id: "p1",
	team_id: "t1",
	is_primary: false,
	attached_by: null,
	attached_at: "2026-09-01T00:00:00.000Z",
};

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function renderDialog(onClose = vi.fn()) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<DetachTeamDialog
				projectId="p1"
				attachment={attachment}
				team={{ id: "t1", name: "Prodigitality Services Inc. Team" } as never}
				people={[]}
				curatedTeamIdsByUserId={new Map()}
				teamNameById={{}}
				onClose={onClose}
			/>
		</QueryClientProvider>,
	);
	return { client, onClose };
}

describe("DetachTeamDialog › after detaching", () => {
	it("refreshes who can log here, the For options, the loggable projects and the overview", async () => {
		vi.mocked(detachTeam).mockResolvedValue(undefined as never);
		const { client, onClose } = renderDialog();
		const invalidate = vi.spyOn(client, "invalidateQueries");
		fireEvent.click(screen.getByRole("button", { name: "Detach team" }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(detachTeam).toHaveBeenCalledWith("p1", "t1", { members: "remove" });
		for (const queryKey of WHO_CAN_LOG_KEYS) {
			expect(invalidate).toHaveBeenCalledWith({ queryKey });
		}
	});

	it("refreshes nothing time-related when the detach fails", async () => {
		vi.mocked(detachTeam).mockRejectedValue(new Error("Nope"));
		const { client, onClose } = renderDialog();
		const invalidate = vi.spyOn(client, "invalidateQueries");
		fireEvent.click(screen.getByRole("button", { name: "Detach team" }));
		await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nope"));
		expect(onClose).not.toHaveBeenCalled();
		expect(invalidate).not.toHaveBeenCalledWith({
			queryKey: ["time", "loggers"],
		});
	});
});
