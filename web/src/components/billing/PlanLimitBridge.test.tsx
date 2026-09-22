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
	native: false,
}));

vi.mock("@/lib/platform", () => ({
	isNativeApp: () => mocks.native,
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
	mocks.native = false;
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

	describe("in the installed app", () => {
		// Billing and Usage are not in the app, so the toast must not offer to
		// open either of them — the refusal still shows, it just has nowhere to
		// send anyone.
		it("gives an owner no upgrade button", () => {
			mocks.native = true;
			mocks.workspaces = [workspace("owner")];
			render(<PlanLimitBridge />);

			notifyPlanLimit(info());

			const toast = lastToast();
			expect(toast.action).toBeUndefined();
			expect(mocks.navigate).not.toHaveBeenCalled();
			expect(toast.message).toContain("Plan changes aren't available");
			expect(toast.message).not.toMatch(/upgrade to/i);
		});

		it("gives a member no usage button", () => {
			mocks.native = true;
			mocks.workspaces = [workspace("member")];
			render(<PlanLimitBridge />);

			notifyPlanLimit(info());

			expect(lastToast().action).toBeUndefined();
		});

		it("ignores the server's message, which it does not control", () => {
			// The backend authors PlanLimitException's message. One "Upgrade to
			// Pro" written there would walk past every guard on this side.
			mocks.native = true;
			mocks.workspaces = [workspace("owner")];
			render(<PlanLimitBridge />);

			notifyPlanLimit(info({ message: "Upgrade to Pro for $10/user/month." }));

			const toast = lastToast();
			expect(toast.message).not.toContain("$10");
			expect(toast.message).toContain("Plan changes aren't available");
		});

		it("still refreshes usage so meters catch up", () => {
			mocks.native = true;
			mocks.workspaces = [workspace("owner")];
			render(<PlanLimitBridge />);

			notifyPlanLimit(info());

			expect(mocks.invalidateQueries).toHaveBeenCalledWith({
				queryKey: ["workspaces", "usage", "ws-1"],
			});
		});
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
