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
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({
		success: vi.fn(),
		error: vi.fn(),
		warning: vi.fn(),
		info: vi.fn(),
	}),
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(async () => {}),
	Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock("@/services/teams.service", () => ({ getTeam: vi.fn() }));
const api = vi.hoisted(() => ({
	getMemberPermissions: vi.fn(),
	getMembers: vi.fn(),
	updateMemberPermissions: vi.fn(),
}));
vi.mock("@/services/project.service", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/services/project.service")>()),
	projectService: api,
}));

import { ROLE_PRESETS } from "@/components/project/permissions/roleTemplates";
import { projectKeys } from "@/queries/project";
import { ProjectPermissionsEditor } from "./ProjectPermissions";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("ProjectPermissionsEditor › saving", () => {
	it("refreshes who can log here, the For options and the saver's own permissions", async () => {
		api.getMemberPermissions.mockResolvedValue(
			structuredClone(ROLE_PRESETS.editor),
		);
		api.getMembers.mockResolvedValue([
			{
				id: "m1",
				role: "editor",
				origin: "direct",
				user_id: "u1",
				user: { display_name: "Maria Santos" },
			},
		]);
		api.updateMemberPermissions.mockImplementation(
			async (_p: string, _m: string, perms: unknown) => perms,
		);
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const invalidate = vi.spyOn(client, "invalidateQueries");
		render(
			<QueryClientProvider client={client}>
				<ProjectPermissionsEditor projectId="p1" memberId="m1" />
			</QueryClientProvider>,
		);

		const logTime = await screen.findByRole("checkbox", { name: /Log time/ });
		expect((logTime as HTMLInputElement).checked).toBe(true);
		fireEvent.click(logTime);
		fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

		await waitFor(() =>
			expect(api.updateMemberPermissions).toHaveBeenCalledTimes(1),
		);
		const saved = api.updateMemberPermissions.mock.calls[0][2] as {
			time: { log: boolean };
		};
		expect(saved.time.log).toBe(false);
		await waitFor(() =>
			expect(invalidate).toHaveBeenCalledWith({
				queryKey: ["time", "loggers"],
			}),
		);
		for (const queryKey of [
			["time", "logging-for"],
			["time", "me", "projects"],
			projectKeys.myPermissions("p1"),
		]) {
			expect(invalidate).toHaveBeenCalledWith({ queryKey });
		}
	});
});
