import { describe, expect, it } from "vitest";
import type { ProjectPermissions } from "@/services/project.service";
import {
	canOpenProjectTime,
	hasNavGate,
	projectTimeAccess,
} from "./projectPermissions";

function perms(over: Record<string, unknown> = {}): ProjectPermissions {
	return {
		access: { time: true, roadmap: true },
		logs: { view: true },
		time: { log: false, view_team_logs: false },
		...over,
	} as unknown as ProjectPermissions;
}

describe("projectTimeAccess", () => {
	it("reads each time grant", () => {
		expect(
			projectTimeAccess(
				perms({
					time: { log: true, view_team_logs: true },
					time_client_hours_level: "detailed",
				}),
			),
		).toEqual({
			canLog: true,
			ownTime: true,
			everyone: true,
			clientLevel: "detailed",
			client: true,
		});
	});

	it("treats a missing or unknown client level as none", () => {
		expect(projectTimeAccess(perms()).clientLevel).toBe("none");
		expect(
			projectTimeAccess(perms({ time_client_hours_level: "weird" }))
				.clientLevel,
		).toBe("none");
		expect(projectTimeAccess(perms()).client).toBe(false);
	});

	it("reads an older payload without time.log as not logging", () => {
		const old = perms({ time: { view_team_logs: false } });
		expect(projectTimeAccess(old).canLog).toBe(false);
	});

	it("is all-no without permissions", () => {
		expect(projectTimeAccess(undefined)).toEqual({
			canLog: false,
			ownTime: false,
			everyone: false,
			clientLevel: "none",
			client: false,
		});
	});
});

describe("canOpenProjectTime", () => {
	it.each([
		[{ time: { log: true, view_team_logs: false } }, true],
		[{ time: { log: false, view_team_logs: true } }, true],
		[{ time_client_hours_level: "summary" }, true],
		[{ time_client_hours_level: "none" }, false],
		[{}, false],
	])("%j → %s", (over, expected) => {
		expect(canOpenProjectTime(perms(over))).toBe(expected);
	});
});

describe("hasNavGate", () => {
	it("still resolves plain dotted gates", () => {
		expect(hasNavGate(perms(), "access.time")).toBe(true);
		expect(hasNavGate(perms(), "logs.view")).toBe(true);
		expect(hasNavGate(perms(), "access.roadmap")).toBe(true);
		expect(hasNavGate(perms(), "access.chat")).toBe(false);
	});

	it("resolves the time composite", () => {
		expect(hasNavGate(perms(), "time.page")).toBe(false);
		expect(
			hasNavGate(perms({ time_client_hours_level: "summary" }), "time.page"),
		).toBe(true);
	});
});
