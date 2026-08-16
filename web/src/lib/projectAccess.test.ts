import { describe, expect, it } from "vitest";
import { isPersonalWorkspace } from "./projectAccess";

describe("isPersonalWorkspace", () => {
	it("classifies a workspace from its project access origin", () => {
		expect(
			isPersonalWorkspace({
				members: [
					{
						user_id: "user-1",
						role: "owner",
						origin: "personal_workspace",
					},
				],
			}),
		).toBe(true);
	});

	it("does not classify ordinary projects as personal workspaces", () => {
		expect(
			isPersonalWorkspace({
				members: [{ user_id: "user-1", role: "owner", origin: "client" }],
			}),
		).toBe(false);
	});
});
