import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock("@/api", () => ({ apiClient: api }));

import { completeOnboarding } from "./auth-api";

describe("completeOnboarding", () => {
	it("returns the completed profile inside the backend response envelope", async () => {
		const result = {
			profile: {
				id: "new-user",
				first_name: "August",
				has_completed_onboarding: true,
			},
			personal_project_id: null,
			personal_team_id: null,
			workspace_id: "new-workspace",
		};
		api.patch.mockResolvedValue({ data: { data: result } });

		const completed = await completeOnboarding();

		expect(completed.profile).toEqual(result.profile);
		expect(completed.workspace_id).toBe("new-workspace");
	});
});
