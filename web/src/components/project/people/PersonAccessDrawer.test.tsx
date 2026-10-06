/* @vitest-environment jsdom */

/**
 * PersonAccessDrawer (W3-1b): removing someone from the project changes who
 * can log time on it, so the time keys that depend on it are refreshed.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		success: vi.fn(),
		error: vi.fn(),
		warning: vi.fn(),
		info: vi.fn(),
	}),
}));
vi.mock("@/hooks/useConfirm", () => ({
	useConfirm: () => () => Promise.resolve(true),
}));
vi.mock("@/components/common/Avatar", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	Avatar: () => null,
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("@/services/project.service", () => ({
	projectService: {
		removeMember: vi.fn(),
		getMemberPermissions: () => new Promise(() => {}),
		updateMemberPosition: vi.fn(),
	},
}));

import { projectService } from "@/services/project.service";
import { PersonAccessDrawer } from "./PersonAccessDrawer";
import type { PersonAccess } from "./useProjectPeople";

const person: PersonAccess = {
	key: "u1",
	userId: "u1",
	memberId: "row-1",
	rows: [],
	user: null,
	role: "editor",
	position: null,
	isExternal: false,
	isSelf: false,
	likelyCanEdit: true,
	canEditPermissions: false,
	canEditPosition: false,
	canRemove: true,
	sources: [],
	teamIds: [],
};

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("PersonAccessDrawer › Remove from project", () => {
	it("refreshes who can log here, the For options, the loggable projects and the overview", async () => {
		vi.mocked(projectService.removeMember).mockResolvedValue(
			undefined as never,
		);
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const invalidate = vi.spyOn(client, "invalidateQueries");
		const onClose = vi.fn();
		render(
			<QueryClientProvider client={client}>
				<PersonAccessDrawer projectId="p1" person={person} onClose={onClose} />
			</QueryClientProvider>,
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Remove from project" }),
		);
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(projectService.removeMember).toHaveBeenCalledWith("p1", "row-1");
		for (const queryKey of [
			["time", "loggers"],
			["time", "logging-for"],
			["time", "me", "projects"],
			["time", "me", "overview"],
		]) {
			expect(invalidate).toHaveBeenCalledWith({ queryKey });
		}
	});
});
