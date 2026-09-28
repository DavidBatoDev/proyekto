/* @vitest-environment jsdom */

import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	notifyPlanLimit,
	type PlanLimitInfo,
	resetPlanLimitNotifications,
	setPlanLimitNotifier,
} from "@/lib/planLimitErrors";

// The provider registers its error toast as the axios 403 handler. Stubbed so
// this suite does not build the real axios client (and a Supabase client).
vi.mock("@/api/axios", () => ({ setPermissionToastHandler: vi.fn() }));

import { type ToastOptions, ToastProvider, useToast } from "./ToastContext";

const planLimit: PlanLimitInfo = {
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
	message: "Your Free plan includes 2 projects.",
};

function Trigger({ options }: { options: ToastOptions }) {
	const { showToast } = useToast();
	return (
		<button type="button" onClick={() => showToast(options)}>
			fire {options.severity ?? "info"}
		</button>
	);
}

afterEach(() => {
	cleanup();
	resetPlanLimitNotifications();
	vi.useRealTimers();
});

describe("toast actions", () => {
	it("renders the action as a button that runs it and dismisses the toast", () => {
		vi.useFakeTimers();
		const onClick = vi.fn();
		render(
			<ToastProvider>
				<Trigger
					options={{
						message: "Project limit reached",
						severity: "warning",
						action: { label: "Upgrade", onClick },
					}}
				/>
			</ToastProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "fire warning" }));
		fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));

		expect(onClick).toHaveBeenCalledTimes(1);
		act(() => {
			vi.advanceTimersByTime(350);
		});
		expect(screen.queryByText("Project limit reached")).toBeNull();
	});

	it("renders no action button when the toast has none", () => {
		render(
			<ToastProvider>
				<Trigger options={{ message: "Saved", severity: "success" }} />
			</ToastProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "fire success" }));

		expect(screen.getByText("Saved")).toBeTruthy();
		// Only the trigger and the dismiss button.
		expect(screen.getAllByRole("button")).toHaveLength(2);
	});
});

describe("plan-limit duplicate suppression", () => {
	const renderTriggers = () =>
		render(
			<ToastProvider>
				<Trigger options={{ message: "Create failed", severity: "error" }} />
				<Trigger options={{ message: "Heads up", severity: "warning" }} />
			</ToastProvider>,
		);

	it("drops an error toast fired right after a plan-limit prompt", () => {
		setPlanLimitNotifier(() => {});
		notifyPlanLimit(planLimit);
		renderTriggers();

		fireEvent.click(screen.getByRole("button", { name: "fire error" }));

		expect(screen.queryByText("Create failed")).toBeNull();
	});

	it("never drops a warning, which is what the prompt itself is", () => {
		setPlanLimitNotifier(() => {});
		notifyPlanLimit(planLimit);
		renderTriggers();

		fireEvent.click(screen.getByRole("button", { name: "fire warning" }));

		expect(screen.getByText("Heads up")).toBeTruthy();
	});

	it("shows error toasts again once the window has passed", () => {
		setPlanLimitNotifier(() => {});
		notifyPlanLimit(planLimit, Date.now() - 5000);
		renderTriggers();

		fireEvent.click(screen.getByRole("button", { name: "fire error" }));

		expect(screen.getByText("Create failed")).toBeTruthy();
	});

	it("shows error toasts when no plan limit was raised at all", () => {
		renderTriggers();

		fireEvent.click(screen.getByRole("button", { name: "fire error" }));

		expect(screen.getByText("Create failed")).toBeTruthy();
	});
});
