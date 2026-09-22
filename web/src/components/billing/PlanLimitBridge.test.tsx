/* @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToastOptions } from "@/contexts/ToastContext";
import {
	notifyPlanLimit,
	type PlanLimitInfo,
	resetPlanLimitNotifications,
} from "@/lib/planLimitErrors";
import type { Workspace } from "@/services/workspaces.service";

const mocks = vi.hoisted(() => ({
	showToast: vi.fn(),
	navigate: vi.fn(),
	invalidateQueries: vi.fn(),
	workspaces: [] as Workspace[],
}));

vi.mock("@/hooks/useToast", () => ({
	useToast: () => ({ showToast: mocks.showToast }),
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => mocks.navigate,
}));
vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useCurrentWorkspace: () => ({
		workspace: mocks.workspaces[0] ?? null,
		workspaces: mocks.workspaces,
		isLoading: false,
	}),
}));

import { PlanLimitBridge } from "./PlanLimitBridge";

const workspace = (role: Workspace["my_role"]): Workspace => ({
	id: "ws-1",
	name: "Acme",
	slug: "acme",
	previous_slugs: [],
	description: null,
	avatar_url: null,
	created_by: null,
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
	my_role: role,
});

const info = (overrides: Partial<PlanLimitInfo> = {}): PlanLimitInfo => ({
	limitKey: "projects",
	kind: "count",
	label: "Projects",
	limit: 2,
	used: 2,
	plan: "free",
	upgradePlan: "pro",
	workspaceId: "ws-1",
	workspaceSlug: "acme",
	context: "create",
	message: "Your Free plan includes 2 projects and this workspace has 2.",
	...overrides,
});

const lastToast = (): ToastOptions =>
	mocks.showToast.mock.calls.at(-1)?.[0] as ToastOptions;

afterEach(() => {
	cleanup();
	resetPlanLimitNotifications();
	vi.clearAllMocks();
	mocks.workspaces = [];
});

describe("PlanLimitBridge", () => {
	it("prompts an owner to upgrade, linking to that workspace's billing", () => {
		mocks.workspaces = [workspace("owner")];
		render(<PlanLimitBridge />);

		notifyPlanLimit(info());

		const toast = lastToast();
		expect(toast.severity).toBe("warning");
		expect(toast.duration).toBe(8000);
		expect(toast.message).toBe(
			"Your Free plan includes 2 projects and this workspace has 2.",
		);
		expect(toast.action?.label).toBe("Upgrade");
		toast.action?.onClick();
		expect(mocks.navigate).toHaveBeenCalledWith({
			to: "/w/$workspaceSlug/settings/billing",
			params: { workspaceSlug: "acme" },
		});
	});

	it("sends any other member to the usage page", () => {
		mocks.workspaces = [workspace("member")];
		render(<PlanLimitBridge />);

		notifyPlanLimit(info());

		const toast = lastToast();
		expect(toast.action?.label).toBe("View usage");
		toast.action?.onClick();
		expect(mocks.navigate).toHaveBeenCalledWith({
			to: "/w/$workspaceSlug/settings/usage",
			params: { workspaceSlug: "acme" },
		});
	});

	it("gives a non-member no action, only the message", () => {
		render(<PlanLimitBridge />);

		notifyPlanLimit(info({ context: "accept", message: "" }));

		const toast = lastToast();
		expect(toast.action).toBeUndefined();
		expect(toast.message).toContain("Ask a workspace owner to upgrade");
	});

	it("refreshes the blocked workspace's usage", () => {
		mocks.workspaces = [workspace("owner")];
		render(<PlanLimitBridge />);

		notifyPlanLimit(info());

		expect(mocks.invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["workspaces", "usage", "ws-1"],
		});
	});

	it("unregisters on unmount", () => {
		const { unmount } = render(<PlanLimitBridge />);
		unmount();

		notifyPlanLimit(info());

		expect(mocks.showToast).not.toHaveBeenCalled();
	});
});
