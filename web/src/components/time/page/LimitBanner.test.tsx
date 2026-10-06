/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const entitlements = vi.hoisted(() => ({
	current: null as null | Record<string, unknown>,
}));
vi.mock("@/hooks/useEntitlements", () => ({
	useEntitlements: () => entitlements.current,
}));

import type { ResolvedTimePolicy } from "@/services/time.types";
import {
	LimitBanner,
	type LimitReading,
	limitLine,
	limitReadingsFromPolicy,
	limitReadingsFromWarnings,
	limitTone,
	planDowngradeApplies,
	TIME_PLAN_NOTICE_STORAGE_PREFIX,
	TimePlanBanner,
} from "./LimitBanner";

const H = 3600;

function reading(over: Partial<LimitReading> = {}): LimitReading {
	return {
		source: "policy",
		window: "weekly",
		label: "Prodigitality",
		limitMinutes: 2400,
		loggedSeconds: 38 * H + 15 * 60,
		...over,
	};
}

function freeEntitlements(hasTracking = false) {
	return {
		status: "ready",
		usage: { workspace_id: "w1", features: [] },
		plan: "free",
		upgradePlan: "pro",
		isComplimentary: false,
		hasFeature: (key: string) => (key === "time_tracking" ? hasTracking : true),
	};
}

const workspace = {
	id: "w1",
	name: "Acme",
	slug: "acme",
	my_role: "owner" as const,
};

beforeEach(() => {
	window.localStorage.clear();
	entitlements.current = freeEntitlements();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("limit readings", () => {
	it("tone: amber from 85%, over past the limit", () => {
		expect(limitTone(reading({ loggedSeconds: 30 * H }))).toBe("neutral");
		expect(limitTone(reading({ loggedSeconds: 34 * H }))).toBe("near");
		expect(limitTone(reading({ loggedSeconds: 40 * H }))).toBe("near");
		expect(limitTone(reading({ loggedSeconds: 40 * H + 60 }))).toBe("over");
	});

	it("lines: policy and agreement as on the review screen; member caps as yours", () => {
		expect(limitLine(reading())).toBe(
			"Weekly limit 40h (Prodigitality) · 38:15 logged · within limit",
		);
		expect(
			limitLine(
				reading({
					source: "agreement",
					label: "Acme Corp",
					loggedSeconds: 43 * H + 30 * 60,
				}),
			),
		).toBe(
			"Weekly limit 40h in the agreement with Acme Corp · 43:30 logged · 3:30 over",
		);
		expect(
			limitLine(
				reading({
					source: "member",
					window: "monthly",
					label: "Design",
					limitMinutes: 160 * 60,
					loggedSeconds: 150 * H,
				}),
			),
		).toBe("Your monthly limit 160h (Design) · 150:00 logged · within limit");
	});

	it("a policy line never says hours are cut (D65)", () => {
		const text = limitLine(reading({ loggedSeconds: 50 * H }));
		expect(text).toBe(
			"Weekly limit 40h (Prodigitality) · 50:00 logged · 10:00 over",
		);
		expect(text).not.toMatch(/\b(cut|unpaid|paid|won't count)\b/i);
	});

	it("from a policy: the agreement limit, a policy limit, member caps", () => {
		const base = {
			weekly_limit_minutes: 2400,
			sources: { weekly_limit_minutes: "contract" },
			member: null,
		} as unknown as ResolvedTimePolicy;
		expect(
			limitReadingsFromPolicy(base, {
				label: "Acme Corp",
				weekLoggedSeconds: 10 * H,
			}),
		).toEqual([
			{
				source: "agreement",
				window: "weekly",
				label: "Acme Corp",
				limitMinutes: 2400,
				loggedSeconds: 10 * H,
			},
		]);
		const team = {
			weekly_limit_minutes: 2400,
			sources: { weekly_limit_minutes: "workspace" },
			member: {
				weekly_limit_hours: 35,
				monthly_limit_hours: 140,
				overtime_requires_approval: true,
			},
		} as unknown as ResolvedTimePolicy;
		expect(
			limitReadingsFromPolicy(team, {
				label: "Design",
				weekLoggedSeconds: 10 * H,
			}).map((r) => [r.source, r.window, r.limitMinutes]),
		).toEqual([
			["policy", "weekly", 2400],
			["member", "weekly", 2100],
		]);
		expect(
			limitReadingsFromPolicy(team, {
				label: "Design",
				weekLoggedSeconds: 10 * H,
				monthLoggedSeconds: 50 * H,
			}).map((r) => [r.source, r.window, r.loggedSeconds]),
		).toEqual([
			["policy", "weekly", 10 * H],
			["member", "weekly", 10 * H],
			["member", "monthly", 50 * H],
		]);
		expect(
			limitReadingsFromPolicy(
				{ weekly_limit_minutes: null, sources: {} },
				{ weekLoggedSeconds: 0 },
			),
		).toEqual([]);
	});

	it("from write warnings: POLICY_WEEKLY_LIMIT and CONTRACT_WEEKLY_LIMIT", () => {
		expect(
			limitReadingsFromWarnings(
				[
					{ code: "OVERLAP", entry_ids: ["e1"] },
					{
						code: "POLICY_WEEKLY_LIMIT",
						limit_minutes: 2400,
						logged_minutes: 2460,
						label: "Prodigitality",
					},
					{
						code: "CONTRACT_WEEKLY_LIMIT",
						limit_minutes: 1200,
						logged_minutes: 1300,
					},
				],
				{ agreementLabel: "Acme Corp" },
			),
		).toEqual([
			{
				source: "policy",
				window: "weekly",
				label: "Prodigitality",
				limitMinutes: 2400,
				loggedSeconds: 2460 * 60,
			},
			{
				source: "agreement",
				window: "weekly",
				label: "Acme Corp",
				limitMinutes: 1200,
				loggedSeconds: 1300 * 60,
			},
		]);
	});
});

describe("LimitBanner", () => {
	it("renders nothing without a limit", () => {
		const { container } = render(
			<LimitBanner readings={[reading({ limitMinutes: 0 })]} />,
		);
		expect(container.innerHTML).toBe("");
	});

	it("a policy over its limit stays amber; an agreement over its limit turns red", () => {
		render(
			<LimitBanner
				readings={[
					reading({ loggedSeconds: 41 * H }),
					reading({
						source: "agreement",
						label: "Acme Corp",
						loggedSeconds: 41 * H,
					}),
				]}
			/>,
		);
		const lines = Array.from(
			screen.getByTestId("time-limit-banner").querySelectorAll("p"),
		);
		expect(lines.map((p) => p.getAttribute("data-tone"))).toEqual([
			"over",
			"over_cut",
		]);
		expect(lines[0].textContent).toBe(
			"Weekly limit 40h (Prodigitality) · 41:00 logged · 1:00 over",
		);
		expect(lines[1].className).toContain("text-destructive");
		expect(lines[0].className).not.toContain("destructive");
	});
});

describe("planDowngradeApplies", () => {
	it("is true while the person has undecided sheets under the workspace", () => {
		expect(
			planDowngradeApplies(
				[
					{ policy_workspace_id: "w1", status: "approved" },
					{ policy_workspace_id: "w2", status: "open" },
				],
				"w1",
			),
		).toBe(false);
		expect(
			planDowngradeApplies(
				[{ policy_workspace_id: "w1", status: "submitted" }],
				"w1",
			),
		).toBe(true);
		expect(planDowngradeApplies(null, "w1")).toBe(false);
		expect(planDowngradeApplies([], null)).toBe(false);
	});
});

describe("TimePlanBanner", () => {
	const UPGRADE =
		"Timesheets and approvals are part of Pro. Upgrade Acme to send time for approval.";
	const DOWNGRADE =
		"Acme's plan no longer includes timesheets. Your existing time is safe, and open timesheets can still be decided.";

	it("an owner without timesheets sees the Pro notice with the upgrade link", () => {
		render(<TimePlanBanner workspace={workspace} />);
		const banner = screen.getByTestId("time-plan-banner");
		expect(banner.textContent).toContain(UPGRADE);
		expect(
			screen.getByRole("link", { name: /Upgrade to Pro/ }).getAttribute("href"),
		).toBe("/w/acme/settings/billing");
	});

	it("is owner-only", () => {
		const { container } = render(
			<TimePlanBanner workspace={{ ...workspace, my_role: "admin" }} />,
		);
		expect(container.innerHTML).toBe("");
	});

	it("shows nothing when the plan has timesheets or is unknown", () => {
		entitlements.current = freeEntitlements(true);
		const { container, rerender } = render(
			<TimePlanBanner workspace={workspace} />,
		);
		expect(container.innerHTML).toBe("");
		entitlements.current = {
			...freeEntitlements(),
			usage: null,
			plan: null,
		};
		rerender(<TimePlanBanner workspace={workspace} />);
		expect(container.innerHTML).toBe("");
	});

	it("after a downgrade everyone with open sheets reads the downgrade line", () => {
		render(
			<TimePlanBanner
				workspace={{ ...workspace, my_role: "member" }}
				downgraded
			/>,
		);
		expect(screen.getByTestId("time-plan-banner").textContent).toContain(
			DOWNGRADE,
		);
	});

	it("dismissing is remembered per workspace", () => {
		const { container, unmount } = render(
			<TimePlanBanner workspace={workspace} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
		expect(container.innerHTML).toBe("");
		expect(
			window.localStorage.getItem(
				`${TIME_PLAN_NOTICE_STORAGE_PREFIX}upgrade:w1`,
			),
		).toBe("1");
		unmount();
		const again = render(<TimePlanBanner workspace={workspace} />);
		expect(again.container.innerHTML).toBe("");
		const other = render(
			<TimePlanBanner workspace={{ ...workspace, id: "w2", slug: "w2" }} />,
		);
		expect(other.getByTestId("time-plan-banner")).toBeTruthy();
	});

	it("without storage the notice still dismisses for now and shows again later", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		const { container, unmount } = render(
			<TimePlanBanner workspace={workspace} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
		expect(container.innerHTML).toBe("");
		unmount();
		render(<TimePlanBanner workspace={workspace} />);
		expect(screen.getByTestId("time-plan-banner")).toBeTruthy();
	});
});
