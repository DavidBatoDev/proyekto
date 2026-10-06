import { describe, expect, it } from "vitest";
import type { ProjectTimeAccess } from "@/lib/projectPermissions";
import type { Engagement } from "@/services/engagement.service";
import type { ProjectLogger } from "@/services/time.types";
import {
	availableProjectTimeViews,
	CLIENT_LEVEL_COPY,
	clientAgreementRows,
	clientHoursAgreements,
	counterpartyLabel,
	loggerLine,
	PROJECT_TIME_COPY,
	PROJECT_TIME_SETTINGS_COPY,
	probeEndDate,
	projectTimeRedirect,
	resolveProjectTimeView,
	validateProjectTimeSearch,
} from "./projectTimeModel";

const P = "22222222-2222-4222-8222-222222222222";
const U = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function access(over: Partial<ProjectTimeAccess> = {}): ProjectTimeAccess {
	return {
		canLog: false,
		ownTime: false,
		everyone: false,
		clientLevel: "none",
		client: false,
		...over,
	};
}

describe("validateProjectTimeSearch", () => {
	it("keeps the view and the report filters", () => {
		expect(
			validateProjectTimeSearch({
				view: "client",
				person: U,
				for: "team",
				status: "approved",
				from: "2026-09-01",
				to: "2026-09-30",
			}),
		).toEqual({
			view: "client",
			person: U,
			for: "team",
			status: "approved",
			from: "2026-09-01",
			to: "2026-09-30",
		});
	});

	it("keeps the legacy views so the route can redirect them", () => {
		expect(validateProjectTimeSearch({ view: "team" }).view).toBe("team");
		expect(validateProjectTimeSearch({ view: "mine" }).view).toBe("mine");
	});

	it("drops unknown views, the project and group params, and old period params", () => {
		expect(
			validateProjectTimeSearch({
				view: "calendar",
				project: P,
				group: "task",
				preset: "this_week",
				from: "2026-09-01T00:00:00.000Z",
				cutoff_month: "2026-09",
			}),
		).toEqual({});
	});
});

describe("projectTimeRedirect (ux.md › Routes and Redirects)", () => {
	it("sends ?view=team to ?view=everyone, keeping the filters", () => {
		expect(
			projectTimeRedirect({ view: "team", person: U, from: "2026-09-01" }, P),
		).toEqual({
			kind: "view",
			search: { view: "everyone", person: U, from: "2026-09-01" },
		});
	});

	it("sends ?view=mine to /time?project=", () => {
		expect(projectTimeRedirect({ view: "mine" }, P)).toEqual({
			kind: "mine",
			project: P,
		});
	});

	it("drops a project id that isn't a uuid from the Time link", () => {
		expect(projectTimeRedirect({ view: "mine" }, "not-a-uuid")).toEqual({
			kind: "mine",
			project: undefined,
		});
	});

	it("leaves every other URL alone", () => {
		expect(projectTimeRedirect({}, P)).toBeNull();
		expect(projectTimeRedirect({ view: "everyone" }, P)).toBeNull();
		expect(projectTimeRedirect({ view: "client" }, P)).toBeNull();
	});
});

describe("resolveProjectTimeView (L22, L55)", () => {
	it("defaults to Everyone, then Client hours", () => {
		expect(
			resolveProjectTimeView(
				access({ everyone: true, client: true, clientLevel: "summary" }),
				undefined,
			),
		).toEqual({
			kind: "view",
			view: "everyone",
			views: ["everyone", "client"],
		});
		expect(
			resolveProjectTimeView(
				access({ client: true, clientLevel: "detailed" }),
				undefined,
			),
		).toEqual({ kind: "view", view: "client", views: ["client"] });
	});

	it("honours an available view and falls back from an unavailable one", () => {
		const both = access({
			everyone: true,
			client: true,
			clientLevel: "summary",
		});
		expect(resolveProjectTimeView(both, "client")).toMatchObject({
			view: "client",
		});
		expect(
			resolveProjectTimeView(access({ everyone: true }), "client"),
		).toMatchObject({ kind: "view", view: "everyone" });
	});

	it("sends someone who only logs here to their own Time page", () => {
		expect(resolveProjectTimeView(access({ canLog: true }), undefined)).toEqual(
			{ kind: "redirect_mine" },
		);
	});

	it("refuses someone who only reads time here (viewer, commenter: the route gate is the nav composite)", () => {
		expect(
			resolveProjectTimeView(access({ ownTime: true }), undefined),
		).toEqual({ kind: "denied" });
		expect(
			resolveProjectTimeView(access({ ownTime: true }), "everyone"),
		).toEqual({ kind: "denied" });
	});

	it("shows the link card when they asked for a view they can't open", () => {
		expect(
			resolveProjectTimeView(access({ canLog: true }), "everyone"),
		).toEqual({ kind: "link_card" });
	});

	it("refuses someone with no time here at all", () => {
		expect(resolveProjectTimeView(access(), undefined)).toEqual({
			kind: "denied",
		});
		expect(resolveProjectTimeView(access(), "client")).toEqual({
			kind: "denied",
		});
	});

	it("lists views Everyone first", () => {
		expect(
			availableProjectTimeViews(
				access({ client: true, everyone: true, clientLevel: "summary" }),
			),
		).toEqual(["everyone", "client"]);
	});
});

function engagement(over: Partial<Engagement> = {}): Engagement {
	return {
		id: "e1",
		kind: "client_services",
		scope_mode: "project_specific",
		status: "active",
		origin: null,
		activated_by_contract_id: null,
		started_at: null,
		ended_at: null,
		cancelled_at: null,
		status_reason: null,
		viewer_position: "hirer",
		viewer_capacity: "individual",
		counterparty: {
			position: "provider",
			user_id: "x",
			capacity: "team",
			display_name_snapshot: "Ana Reyes",
			email_snapshot: null,
			team_name_snapshot: "Pixel Studio",
		},
		project_links: [
			{
				id: "l1",
				project_id: P,
				project_title_snapshot: "Acme Website",
				basis: "x",
				status: "active",
				linked_at: null,
				ended_at: null,
			},
		],
		current_settings: {
			id: "s",
			tracking_mode: "optional",
			approval_mode: "hirer",
			allow_manual_entries: true,
			rounding_minutes: 0,
			weekly_limit_minutes: null,
			client_hours_detail_level: "summary",
			effective_from: "2026-01-01",
			effective_until: null,
		},
		current_rates: [],
		...over,
	};
}

describe("client agreements", () => {
	it("names the counterparty's team, then the person", () => {
		expect(counterpartyLabel(engagement())).toBe("Pixel Studio");
		expect(
			counterpartyLabel(
				engagement({
					counterparty: {
						position: "provider",
						user_id: "x",
						capacity: "individual",
						display_name_snapshot: "Ana Reyes",
						email_snapshot: null,
						team_name_snapshot: null,
					},
				}),
			),
		).toBe("Ana Reyes");
	});

	it("lists active client agreements linked to this project with their level", () => {
		const rows = clientAgreementRows(
			[
				engagement(),
				engagement({ id: "talent", kind: "talent_services" }),
				engagement({ id: "ended", status: "ended" }),
				engagement({
					id: "elsewhere",
					project_links: [
						{
							id: "l2",
							project_id: "other",
							project_title_snapshot: "Other",
							basis: "x",
							status: "active",
							linked_at: null,
							ended_at: null,
						},
					],
				}),
				engagement({ id: "legacy", current_settings: null }),
			],
			P,
		);
		expect(rows.map((r) => [r.engagementId, r.level])).toEqual([
			["e1", "summary"],
			["legacy", "none"],
		]);
	});

	it("gives the client view only hirer seats above none", () => {
		const list = [
			engagement(),
			engagement({ id: "provider", viewer_position: "provider" }),
			engagement({ id: "off", current_settings: null }),
		];
		expect(clientHoursAgreements(list, P)).toEqual([
			{ engagementId: "e1", label: "Pixel Studio", level: "summary" },
		]);
		expect(clientHoursAgreements(undefined, P)).toEqual([]);
	});
});

function logger(over: Partial<ProjectLogger> = {}): ProjectLogger {
	return {
		user_id: U,
		display_name: "Maria Santos",
		role: "editor",
		reason: "team",
		label: "Prodigitality Services Inc. Team",
		options: 1,
		...over,
	};
}

describe("loggerLine (A11)", () => {
	it("reads Maria (Prodigitality Services Inc. Team)", () => {
		expect(loggerLine(logger())).toEqual({
			name: "Maria Santos",
			detail: "Prodigitality Services Inc. Team",
			self: false,
		});
	});

	it("reads You (editor · just you) for the viewer", () => {
		expect(
			loggerLine(logger({ reason: "personal", label: "just you" }), {
				selfId: U,
			}),
		).toEqual({ name: "You", detail: "editor · just you", self: true });
	});

	it("reads Leo (agreement with Pixel Studio)", () => {
		expect(
			loggerLine(
				logger({
					display_name: "Leo Cruz",
					reason: "agreement",
					label: "agreement with Pixel Studio",
				}),
			).detail,
		).toBe("agreement with Pixel Studio");
	});

	it("says when someone picks among several options", () => {
		expect(loggerLine(logger({ options: 2 })).detail).toBe(
			"Prodigitality Services Inc. Team · or 1 other choice",
		);
		expect(loggerLine(logger({ options: 3 })).detail).toContain(
			"or 2 other choices",
		);
	});

	it("explains a holder with no option right now", () => {
		expect(
			loggerLine(logger({ reason: "none", label: "", options: 0 })).detail,
		).toBe(PROJECT_TIME_SETTINGS_COPY.cannotLogNow);
	});
});

describe("copy", () => {
	const BANNED = /\b(contracts?|rates?|payouts?|invoices?|invoicing)\b/i;
	// These two only render on the web.
	const WEB_ONLY = new Set(["payouts", "rates", "noLimitRecordWeb"]);

	it("never says a native-banned word outside the web-only strings", () => {
		for (const table of [
			PROJECT_TIME_COPY,
			PROJECT_TIME_SETTINGS_COPY,
			CLIENT_LEVEL_COPY,
		]) {
			for (const [key, value] of Object.entries(table)) {
				if (WEB_ONLY.has(key)) continue;
				expect(value, key).not.toMatch(BANNED);
			}
		}
	});

	it("says Proyekto, never Prodigy", () => {
		const all = JSON.stringify([PROJECT_TIME_COPY, PROJECT_TIME_SETTINGS_COPY]);
		expect(all).not.toMatch(/Prodigy\b/);
		expect(all).toContain("Proyekto");
	});
});

describe("probeEndDate", () => {
	it("is tomorrow's local date", () => {
		expect(probeEndDate(new Date(2026, 9, 6, 12))).toBe("2026-10-07");
		expect(probeEndDate(new Date(2026, 11, 31, 12))).toBe("2027-01-01");
	});
});
