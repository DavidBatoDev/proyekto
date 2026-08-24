import { describe, expect, it } from "vitest";
import type {
	Engagement,
	EngagementProjectLink,
	EngagementTimeSettings,
} from "@/services/engagement.service";
import { describeScope, describeTimePolicy } from "./engagementCopy";

function link(
	overrides: Partial<EngagementProjectLink> = {},
): EngagementProjectLink {
	return {
		id: "link-1",
		project_id: "project-1",
		project_title_snapshot: "Test Project",
		basis: "contract_scope",
		status: "active",
		linked_at: "2026-08-01T00:00:00Z",
		ended_at: null,
		...overrides,
	};
}

function engagement(
	scope: Engagement["scope_mode"],
	links: EngagementProjectLink[],
): Engagement {
	return {
		scope_mode: scope,
		project_links: links,
	} as Engagement;
}

function settings(
	overrides: Partial<EngagementTimeSettings> = {},
): EngagementTimeSettings {
	return {
		id: "settings-1",
		tracking_mode: "required",
		approval_mode: "provider_submit_hirer_approve",
		allow_manual_entries: true,
		rounding_minutes: 0,
		weekly_limit_minutes: null,
		client_hours_detail_level: "summary",
		effective_from: "2026-08-01",
		effective_until: null,
		...overrides,
	};
}

describe("describeScope", () => {
	it("distinguishes an unplaced flexible engagement from a severed one", () => {
		expect(describeScope(engagement("flexible", []))).toBe(
			"Flexible · no projects placed yet",
		);
		expect(describeScope(engagement("project_specific", []))).toBe(
			"No linked project",
		);
	});

	it("names the single project it covers", () => {
		expect(describeScope(engagement("project_specific", [link()]))).toBe(
			"Test Project",
		);
	});

	it("ignores links that have ended", () => {
		expect(
			describeScope(
				engagement("project_specific", [
					link(),
					link({ id: "link-2", status: "ended", ended_at: "2026-08-05" }),
				]),
			),
		).toBe("Test Project");
	});

	it("counts rather than lists once there are several", () => {
		expect(
			describeScope(engagement("flexible", [link(), link({ id: "link-2" })])),
		).toBe("2 projects");
	});
});

describe("describeTimePolicy", () => {
	it("reads the four signed columns as sentences", () => {
		expect(describeTimePolicy(settings())).toEqual([
			"Time tracking required",
			"Provider submits, hirer approves",
			"Client sees summarised hours",
			"Manual entries allowed",
		]);
	});

	it("mentions rounding and a weekly cap only when they are set", () => {
		expect(
			describeTimePolicy(
				settings({
					rounding_minutes: 15,
					weekly_limit_minutes: 2400,
					allow_manual_entries: false,
				}),
			),
		).toEqual([
			"Time tracking required",
			"Provider submits, hirer approves",
			"Client sees summarised hours",
			"Rounded to 15 min",
			"Capped at 40 h/week",
			"Timer entries only",
		]);
	});

	it("falls back to the raw value for a mode it does not know", () => {
		expect(
			describeTimePolicy(settings({ tracking_mode: "future_mode" }))[0],
		).toBe("future_mode");
	});
});
