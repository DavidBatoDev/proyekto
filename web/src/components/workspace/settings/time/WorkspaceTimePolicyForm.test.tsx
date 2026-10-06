/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceEntitlements } from "@/lib/entitlements";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({
			children,
			to,
			params,
			className,
		}: {
			children?: ReactNode;
			to: string;
			params?: Record<string, string>;
			className?: string;
		}) => {
			let href = to;
			for (const [key, value] of Object.entries(params ?? {})) {
				href = href.replace(`$${key}`, value);
			}
			return (
				<a href={href} className={className}>
					{children}
				</a>
			);
		},
	};
});

const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));

const ents = vi.hoisted(() => ({
	features: {} as Record<string, boolean>,
	known: true,
}));
vi.mock("@/hooks/useEntitlements", () => ({
	useEntitlements: (): WorkspaceEntitlements =>
		({
			status: ents.known ? "ready" : "loading",
			usage: ents.known
				? { workspace_id: "w1", features: [] }
				: (null as never),
			plan: ents.known ? "free" : null,
			planName: null,
			planSource: null,
			isComplimentary: false,
			limits: null,
			upgradePlan: null,
			usedFor: () => null,
			meter: () => null,
			remaining: () => null,
			canCreate: () => true,
			hasFeature: (key: string) =>
				ents.known ? (ents.features[key] ?? true) : true,
		}) as unknown as WorkspaceEntitlements,
}));

import { buildEntitlements } from "@/lib/entitlements";
import { timeKeys } from "@/queries/time";
import { TimeApiError, timeService } from "@/services/time.service";
import type {
	ResolvedTimePolicy,
	WorkspacePolicyView,
} from "@/services/time.types";
import {
	appliesFromLine,
	draftFromPolicy,
	hoursOf,
	manualSummaryLine,
	POLICY_FORM_COPY,
	parseWeeklyLimitHours,
	parseWholeNumber,
	periodChanged,
	policyPatch,
	presetsLine,
	reminderSummary,
	roundingValueLine,
	shiftAnchor,
	showsDetectedTimezone,
	trackingDescription,
	trackingPlanInfo,
	WorkspaceTimePolicyForm,
} from "./WorkspaceTimePolicyForm";

const NOW = new Date("2026-10-06T03:00:00.000Z"); // Tue Oct 6 in Manila
const WORKSPACE = {
	id: "w1",
	name: "Acme",
	slug: "acme",
	my_role: "owner" as const,
};

function policy(over: Partial<ResolvedTimePolicy> = {}): ResolvedTimePolicy {
	return {
		tracking_enabled: true,
		period_kind: "weekly",
		week_start: 1,
		timezone: "Asia/Manila",
		period_anchor: null,
		approval_required: true,
		approver_scope: "workspace",
		allow_manual_entries: true,
		retroactive_days: 7,
		rounding_minutes: 0,
		weekly_limit_minutes: null,
		reminder_days: 1,
		hidden_presets: [],
		tracking_mode: null,
		sources: {},
		plan: { time_tracking: true, time_team_rules: false },
		policy_workspace_id: "w1",
		team_override_applied: false,
		member: null,
		client_hours_detail_level: null,
		...over,
	};
}

function view(over: Partial<WorkspacePolicyView> = {}): WorkspacePolicyView {
	return {
		workspace_id: "w1",
		policy: policy(),
		policy_unconfirmed: false,
		can_edit: true,
		...over,
	};
}

let client: QueryClient;

beforeEach(() => {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	ents.features = {};
	ents.known = true;
});

afterEach(() => {
	cleanup();
	client.clear();
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

function renderForm(
	v: WorkspacePolicyView,
	options: { browserTimeZone?: string | null } = {},
) {
	return render(
		<QueryClientProvider client={client}>
			<WorkspaceTimePolicyForm
				workspace={WORKSPACE}
				view={v}
				browserTimeZone={options.browserTimeZone ?? "Asia/Manila"}
				now={NOW}
			/>
		</QueryClientProvider>,
	);
}

function saveButton() {
	return screen.getByRole("button", { name: POLICY_FORM_COPY.save });
}

// ── Pure helpers ────────────────────────────────────────────────────────────

describe("draft model", () => {
	it("reads the policy into the form's values", () => {
		const draft = draftFromPolicy(
			policy({
				retroactive_days: null,
				hidden_presets: ["admin"],
				weekly_limit_minutes: 2400,
			}),
		);
		expect(draft.retroactive_days).toBe(0);
		expect(draft.shown_presets).toEqual(["meeting", "review", "other"]);
		expect(draft.weekly_limit_minutes).toBe(2400);
	});

	it("sends only what changed", () => {
		const p = policy();
		const draft = { ...draftFromPolicy(p), rounding_minutes: 15 };
		expect(policyPatch(draft, p, { planOk: true })).toEqual({
			rounding_minutes: 15,
		});
		expect(policyPatch(draftFromPolicy(p), p, { planOk: true })).toEqual({});
	});

	it("writes no limit as null and hidden presets as the inverse of the ticks", () => {
		const p = policy({ retroactive_days: 7, weekly_limit_minutes: 2400 });
		const draft = {
			...draftFromPolicy(p),
			retroactive_days: 0,
			weekly_limit_minutes: null,
			shown_presets: ["meeting", "other"] as const,
		};
		expect(
			policyPatch({ ...draft, shown_presets: [...draft.shown_presets] }, p, {
				planOk: true,
			}),
		).toEqual({
			retroactive_days: null,
			weekly_limit_minutes: null,
			hidden_presets: ["review", "admin"],
		});
	});

	it("moves a stored biweekly anchor onto a new week start", () => {
		// 2026-10-05 is a Monday; Sunday of that week is Oct 11.
		expect(shiftAnchor("2026-10-05", 7)).toBe("2026-10-11");
		expect(shiftAnchor("2026-10-05", 1)).toBe("2026-10-05");
		expect(shiftAnchor("2026-10-07", 1)).toBe("2026-10-12");
		const p = policy({ period_kind: "biweekly", period_anchor: "2026-10-05" });
		expect(
			policyPatch({ ...draftFromPolicy(p), week_start: 7 }, p, {
				planOk: true,
			}),
		).toEqual({ week_start: 7, period_anchor: "2026-10-11" });
	});

	it("without the plan sends only the timezone and the week start", () => {
		const p = policy({
			plan: { time_tracking: false, time_team_rules: false },
		});
		const draft = {
			...draftFromPolicy(p),
			timezone: "UTC",
			week_start: 7,
			rounding_minutes: 15,
			tracking_enabled: false,
		};
		expect(policyPatch(draft, p, { planOk: false })).toEqual({
			timezone: "UTC",
			week_start: 7,
		});
	});

	it("knows when the period boundaries move", () => {
		const p = policy();
		const base = draftFromPolicy(p);
		expect(periodChanged(base, p)).toBe(false);
		expect(periodChanged({ ...base, period_kind: "monthly" }, p)).toBe(true);
		expect(periodChanged({ ...base, timezone: "UTC" }, p)).toBe(true);
		expect(periodChanged({ ...base, week_start: 7 }, p)).toBe(true);
		const monthly = policy({ period_kind: "monthly" });
		expect(
			periodChanged({ ...draftFromPolicy(monthly), week_start: 7 }, monthly),
		).toBe(false);
	});

	it("says when a change applies (L40)", () => {
		expect(appliesFromLine(policy(), NOW)).toBe(
			"Applies from Mon Oct 12. Open timesheets keep their dates.",
		);
	});

	it("parses typed numbers without jumping on half-typed values", () => {
		expect(parseWholeNumber("3", 1, 14, undefined)).toBe(3);
		expect(parseWholeNumber("", 1, 14, undefined)).toBeUndefined();
		expect(parseWholeNumber("", 0, 3650, 0)).toBe(0);
		expect(parseWholeNumber("15", 1, 14, undefined)).toBeUndefined();
		expect(parseWholeNumber("2.5", 1, 14, undefined)).toBeUndefined();
		expect(parseWeeklyLimitHours("40")).toBe(2400);
		expect(parseWeeklyLimitHours("37.5")).toBe(2250);
		expect(parseWeeklyLimitHours("")).toBeNull();
		expect(parseWeeklyLimitHours("0")).toBeUndefined();
		expect(parseWeeklyLimitHours("200")).toBeUndefined();
		expect(hoursOf(2250)).toBe("37.5");
		expect(hoursOf(null)).toBe("");
	});

	it("writes the read-only values", () => {
		expect(trackingDescription("Acme", true)).toBe(
			"People on Acme projects who aren't on a team log for “Acme”.",
		);
		expect(trackingDescription("Acme", false)).toBe(
			"People who aren't on a team can only track time for themselves.",
		);
		expect(reminderSummary(1)).toBe("1 day after a period ends");
		expect(reminderSummary(3)).toBe("3 days after a period ends");
		expect(manualSummaryLine(true, 7)).toBe("Allowed · up to 7 days back");
		expect(manualSummaryLine(true, null)).toBe("Allowed · no limit");
		expect(manualSummaryLine(false, 7)).toBe("Off");
		expect(roundingValueLine(15)).toBe("15 min · nearest, ties round up");
		expect(roundingValueLine(0)).toBe("None");
		expect(presetsLine(["meeting", "admin"])).toBe("Meeting, Admin");
		expect(presetsLine([])).toBe("None");
	});

	it("shows Detected only on an unconfirmed policy in the editor's own zone", () => {
		const unconfirmed = { policy_unconfirmed: true, can_edit: true };
		expect(
			showsDetectedTimezone(unconfirmed, "Asia/Manila", "Asia/Manila"),
		).toBe(true);
		expect(showsDetectedTimezone(unconfirmed, "UTC", "Asia/Manila")).toBe(
			false,
		);
		expect(
			showsDetectedTimezone(
				{ policy_unconfirmed: false, can_edit: true },
				"Asia/Manila",
				"Asia/Manila",
			),
		).toBe(false);
		expect(showsDetectedTimezone(unconfirmed, "Asia/Manila", null)).toBe(false);
	});

	it("builds a Pro plan notice when usage is unknown, and none with the plan", () => {
		const unknown = buildEntitlements(null, "unavailable");
		expect(trackingPlanInfo(unknown, true)).toBeNull();
		const info = trackingPlanInfo(unknown, false);
		expect(info?.limitKey).toBe("time_tracking");
		expect(info?.upgradePlan).toBe("pro");
	});
});

// ── Editor ──────────────────────────────────────────────────────────────────

describe("WorkspaceTimePolicyForm (owners and admins)", () => {
	it("shows every row with its value and no save bar until something changes", () => {
		renderForm(
			view({
				policy: policy({ rounding_minutes: 15, weekly_limit_minutes: 2400 }),
			}),
		);
		expect(
			screen
				.getByRole("switch", { name: POLICY_FORM_COPY.tracking })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(
			screen.getByText(
				"People on Acme projects who aren't on a team log for “Acme”.",
			),
		).toBeTruthy();
		const period = screen.getByRole("radiogroup", {
			name: POLICY_FORM_COPY.period,
		});
		expect(
			(within(period).getByLabelText("Weekly") as HTMLInputElement).checked,
		).toBe(true);
		expect(
			within(period).getByLabelText("Twice a month (1–15, 16–end)"),
		).toBeTruthy();
		expect(
			(
				screen.getByLabelText(
					POLICY_FORM_COPY.weekStartsOn,
				) as HTMLSelectElement
			).value,
		).toBe("1");
		expect(
			(screen.getByLabelText(POLICY_FORM_COPY.timezone) as HTMLSelectElement)
				.value,
		).toBe("Asia/Manila");
		expect(
			(screen.getByLabelText(POLICY_FORM_COPY.rounding) as HTMLSelectElement)
				.value,
		).toBe("15");
		expect(
			(screen.getByLabelText(POLICY_FORM_COPY.weeklyLimit) as HTMLInputElement)
				.value,
		).toBe("40");
		expect(
			(screen.getByLabelText(POLICY_FORM_COPY.manualWindow) as HTMLInputElement)
				.value,
		).toBe("7");
		expect(screen.getByText(POLICY_FORM_COPY.approvers)).toBeTruthy();
		expect(screen.getByText("Custom approval chains: Enterprise")).toBeTruthy();
		for (const label of ["Meeting", "Review", "Admin", "Other"]) {
			expect((screen.getByLabelText(label) as HTMLInputElement).checked).toBe(
				true,
			);
		}
		expect(screen.queryByTestId("time-policy-save-bar")).toBeNull();
		// Confirmed policy: no "Detected from your browser".
		expect(screen.queryByText(/Detected from your browser/)).toBeNull();
	});

	it("saves only the changed field, writes the answer to the cache and confirms", async () => {
		const saved = view({ policy: policy({ rounding_minutes: 15 }) });
		const put = vi
			.spyOn(timeService, "updateWorkspacePolicy")
			.mockResolvedValue(saved);
		renderForm(view());
		fireEvent.change(screen.getByLabelText(POLICY_FORM_COPY.rounding), {
			target: { value: "15" },
		});
		expect(screen.getByTestId("time-policy-save-bar")).toBeTruthy();
		fireEvent.click(saveButton());
		await waitFor(() =>
			expect(put).toHaveBeenCalledWith("w1", { rounding_minutes: 15 }),
		);
		await waitFor(() =>
			expect(toast.success).toHaveBeenCalledWith(POLICY_FORM_COPY.saved),
		);
		expect(client.getQueryData(timeKeys.workspacePolicy("w1"))).toEqual(saved);
		// The save bar is gone; keyboard focus stays in the form.
		await waitFor(() =>
			expect(screen.queryByTestId("time-policy-save-bar")).toBeNull(),
		);
		expect(document.activeElement).toBe(screen.getByTestId("time-policy-form"));
	});

	it("shows when a new period applies, and Cancel puts the values back", () => {
		renderForm(view());
		expect(screen.queryByTestId("time-policy-applies-from")).toBeNull();
		fireEvent.click(screen.getByLabelText("Monthly"));
		expect(screen.getByTestId("time-policy-applies-from").textContent).toBe(
			"Applies from Mon Oct 12. Open timesheets keep their dates.",
		);
		const cancel = screen.getByRole("button", {
			name: POLICY_FORM_COPY.cancel,
		});
		cancel.focus();
		fireEvent.click(cancel);
		expect((screen.getByLabelText("Weekly") as HTMLInputElement).checked).toBe(
			true,
		);
		expect(screen.queryByTestId("time-policy-applies-from")).toBeNull();
		expect(screen.queryByTestId("time-policy-save-bar")).toBeNull();
		// The bar (and Cancel with it) is gone; keyboard focus stays in the form.
		expect(document.activeElement).toBe(screen.getByTestId("time-policy-form"));
	});

	it("keeps focus in the form when Cancel leaves only the confirm bar", () => {
		renderForm(view({ policy_unconfirmed: true }));
		fireEvent.click(screen.getByLabelText("Monthly"));
		const cancel = screen.getByRole("button", {
			name: POLICY_FORM_COPY.cancel,
		});
		cancel.focus();
		fireEvent.click(cancel);
		// The confirm-only bar stays, without Cancel.
		expect(screen.getByTestId("time-policy-save-bar")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: POLICY_FORM_COPY.cancel }),
		).toBeNull();
		expect(document.activeElement).toBe(screen.getByTestId("time-policy-form"));
	});

	it("turns switches, presets and number fields into one body", async () => {
		const put = vi
			.spyOn(timeService, "updateWorkspacePolicy")
			.mockResolvedValue(view());
		renderForm(view());
		fireEvent.click(
			screen.getByRole("switch", { name: POLICY_FORM_COPY.approval }),
		);
		fireEvent.click(screen.getByLabelText("Admin"));
		fireEvent.change(screen.getByLabelText(POLICY_FORM_COPY.weeklyLimit), {
			target: { value: "40" },
		});
		fireEvent.change(screen.getByLabelText(POLICY_FORM_COPY.reminder), {
			target: { value: "3" },
		});
		fireEvent.change(screen.getByLabelText(POLICY_FORM_COPY.manualWindow), {
			target: { value: "0" },
		});
		fireEvent.click(saveButton());
		await waitFor(() =>
			expect(put).toHaveBeenCalledWith("w1", {
				approval_required: false,
				retroactive_days: null,
				weekly_limit_minutes: 2400,
				reminder_days: 3,
				hidden_presets: ["admin"],
			}),
		);
	});

	it("keeps a half-typed reminder on screen and restores the value on blur", () => {
		renderForm(view());
		const reminder = screen.getByLabelText(
			POLICY_FORM_COPY.reminder,
		) as HTMLInputElement;
		fireEvent.change(reminder, { target: { value: "" } });
		expect(reminder.value).toBe("");
		// Nothing valid was typed, so nothing changed.
		expect(screen.queryByTestId("time-policy-save-bar")).toBeNull();
		fireEvent.blur(reminder);
		expect(reminder.value).toBe("1");
	});

	it("locks the window field while manual time is off", () => {
		renderForm(view());
		fireEvent.click(
			screen.getByRole("switch", { name: POLICY_FORM_COPY.manual }),
		);
		expect(
			(screen.getByLabelText(POLICY_FORM_COPY.manualWindow) as HTMLInputElement)
				.disabled,
		).toBe(true);
	});

	it("an unconfirmed policy can be saved as it stands, naming the detected zone", async () => {
		const put = vi
			.spyOn(timeService, "updateWorkspacePolicy")
			.mockResolvedValue(view());
		renderForm(view({ policy_unconfirmed: true }));
		expect(
			screen.getByText(
				`${POLICY_FORM_COPY.detectedBrowser} · ${POLICY_FORM_COPY.timezoneHint}`,
			),
		).toBeTruthy();
		expect(screen.getByText(POLICY_FORM_COPY.unconfirmed)).toBeTruthy();
		// Nothing changed, so there is nothing to cancel.
		expect(
			screen.queryByRole("button", { name: POLICY_FORM_COPY.cancel }),
		).toBeNull();
		fireEvent.click(saveButton());
		await waitFor(() =>
			expect(put).toHaveBeenCalledWith("w1", { confirm: true }),
		);
	});

	it("a stored zone that isn't the editor's is not called detected", () => {
		renderForm(view({ policy_unconfirmed: true }), {
			browserTimeZone: "Europe/Berlin",
		});
		expect(screen.queryByText(/Detected from/)).toBeNull();
		expect(screen.getByText(POLICY_FORM_COPY.timezoneHint)).toBeTruthy();
		// The editor's own zone is offered in the list.
		const zone = screen.getByLabelText(
			POLICY_FORM_COPY.timezone,
		) as HTMLSelectElement;
		expect(
			Array.from(zone.options).some((o) => o.value === "Europe/Berlin"),
		).toBe(true);
	});

	it("shows a refused save inline in plain words", async () => {
		vi.spyOn(timeService, "updateWorkspacePolicy").mockRejectedValue(
			new TimeApiError({
				status: 422,
				code: "TIME_POLICY_INVALID",
				message: "period_anchor must fall on week_start",
				extras: { fields: ["timezone"] },
			}),
		);
		renderForm(view());
		fireEvent.change(screen.getByLabelText(POLICY_FORM_COPY.timezone), {
			target: { value: "UTC" },
		});
		fireEvent.click(saveButton());
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toMatch(/^Those time settings aren't valid\./);
		expect(alert.textContent).not.toMatch(/period_anchor/);
		expect(toast.success).not.toHaveBeenCalled();
		// Editing again clears the error.
		fireEvent.change(screen.getByLabelText(POLICY_FORM_COPY.rounding), {
			target: { value: "5" },
		});
		expect(screen.queryByRole("alert")).toBeNull();
	});
});

describe("WorkspaceTimePolicyForm without timesheets (Free)", () => {
	const free = () =>
		view({
			policy: policy({
				plan: { time_tracking: false, time_team_rules: false },
			}),
		});

	it("puts the controls behind the plan notice but keeps timezone and week start", async () => {
		ents.features = { time_tracking: false };
		const put = vi
			.spyOn(timeService, "updateWorkspacePolicy")
			.mockResolvedValue(free());
		renderForm(free());
		expect(
			screen.getByText(
				"Timesheets and approvals are part of Pro. Upgrade Acme to send time for approval.",
			),
		).toBeTruthy();
		expect(
			screen.getByText("Everyone can still track time just for themselves."),
		).toBeTruthy();
		// Workspace time is off in effect, whatever the stored switch says.
		const tracking = screen.getByRole("switch", {
			name: POLICY_FORM_COPY.tracking,
		}) as HTMLButtonElement;
		expect(tracking.getAttribute("aria-checked")).toBe("false");
		expect(tracking.disabled).toBe(true);
		expect(
			(
				screen.getByRole("switch", {
					name: POLICY_FORM_COPY.approval,
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		expect(
			(screen.getByLabelText(POLICY_FORM_COPY.rounding) as HTMLSelectElement)
				.disabled,
		).toBe(true);
		expect(
			(screen.getByLabelText("Monthly") as HTMLInputElement).disabled,
		).toBe(true);
		const weekStart = screen.getByLabelText(
			POLICY_FORM_COPY.weekStartsOn,
		) as HTMLSelectElement;
		expect(weekStart.disabled).toBe(false);
		fireEvent.change(weekStart, { target: { value: "7" } });
		fireEvent.click(saveButton());
		await waitFor(() =>
			expect(put).toHaveBeenCalledWith("w1", { week_start: 7 }),
		);
	});

	it("never asks a Free workspace to confirm", () => {
		ents.features = { time_tracking: false };
		renderForm(
			view({
				policy_unconfirmed: true,
				policy: policy({
					plan: { time_tracking: false, time_team_rules: false },
				}),
			}),
		);
		expect(screen.queryByTestId("time-policy-save-bar")).toBeNull();
	});
});

describe("WorkspaceTimePolicyForm for members (A4)", () => {
	it("reads the policy without a single control", () => {
		renderForm(
			view({
				can_edit: false,
				policy: policy({
					retroactive_days: null,
					rounding_minutes: 15,
					weekly_limit_minutes: 2400,
					hidden_presets: ["review"],
				}),
			}),
		);
		expect(screen.getByTestId("time-policy-readonly")).toBeTruthy();
		expect(screen.getByText(POLICY_FORM_COPY.readOnly)).toBeTruthy();
		expect(screen.queryByRole("switch")).toBeNull();
		expect(screen.queryByRole("combobox")).toBeNull();
		expect(screen.queryByRole("spinbutton")).toBeNull();
		expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
		for (const text of [
			"On",
			"Weekly",
			"Monday",
			"Asia/Manila",
			"1 day after a period ends",
			"Required",
			"Allowed · no limit",
			"15 min · nearest, ties round up",
			"40h",
			"Meeting, Admin, Other",
		]) {
			expect(screen.getByText(text)).toBeTruthy();
		}
	});
});
