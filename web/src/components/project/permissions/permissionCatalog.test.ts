import { describe, expect, it } from "vitest";
import { describeAccess } from "@/components/project/people/accessLanguage";
import { enforceDeps } from "@/components/project/people/ProjectPermissions";
import { getPermissionLabel } from "@/lib/permissionErrors";
import type { ProjectPermissions } from "@/services/project.service";
import { PERMISSION_SECTIONS } from "./permissionCatalog";
import { detectPreset, ROLE_PRESETS } from "./roleTemplates";

const find = (path: string) =>
	PERMISSION_SECTIONS.flatMap((s) => s.permissions).find(
		(p) => p.path === path,
	);

describe("time permissions in the catalog (ux.md › Project Surfaces)", () => {
	it("adds time.log, which requires Open Time", () => {
		const log = find("time.log");
		expect(log).toMatchObject({
			label: "Log time",
			description: "Start timers and add time on this project.",
			requires: ["access.time"],
		});
	});

	it("rewords access.time and time.view_team_logs", () => {
		expect(find("access.time")?.description).toBe("See time on this project.");
		expect(find("time.view_team_logs")?.description).toBe(
			"See everyone's time on this project, not just your own.",
		);
	});

	it("lists time.log before seeing everyone's time", () => {
		const time = PERMISSION_SECTIONS.find((s) => s.key === "time");
		expect(time?.permissions.map((p) => p.path)).toEqual([
			"time.log",
			"time.view_team_logs",
		]);
	});

	it("labels a time.log refusal by its catalog name", () => {
		expect(getPermissionLabel("time.log")).toBe("Log time");
	});
});

describe("role presets mirror the backend ladder for time", () => {
	const time = (preset: keyof typeof ROLE_PRESETS) => ROLE_PRESETS[preset].time;

	it("grants time.log from editor up, never to a viewer", () => {
		expect(time("viewer").log).toBe(false);
		expect(time("editor").log).toBe(true);
		expect(time("admin").log).toBe(true);
	});

	it("keeps seeing everyone's time at admin", () => {
		expect(time("editor").view_team_logs).toBe(false);
		expect(time("admin").view_team_logs).toBe(true);
	});

	it("still detects each preset exactly", () => {
		for (const key of ["admin", "editor", "viewer"] as const) {
			expect(detectPreset(structuredClone(ROLE_PRESETS[key]))).toBe(key);
		}
	});
});

describe("the matrix editor's dependency cascade", () => {
	it("turns time.log off with Open Time", () => {
		const perms = structuredClone(ROLE_PRESETS.editor);
		perms.access.time = false;
		const next = enforceDeps(perms);
		expect(next.time.log).toBe(false);
		expect(next.time.view_team_logs).toBe(false);
	});

	it("leaves time.log alone while Open Time is on", () => {
		expect(enforceDeps(structuredClone(ROLE_PRESETS.editor)).time.log).toBe(
			true,
		);
	});
});

describe("describeAccess", () => {
	it("names logging time among what a person can change", () => {
		const sentences = describeAccess(
			structuredClone(ROLE_PRESETS.editor) as ProjectPermissions,
		);
		expect(sentences.canChange).toContain("Log time");
		expect(sentences.canChange).not.toContain("See everyone's time");
	});

	it("names seeing everyone's time for an admin", () => {
		expect(
			describeAccess(structuredClone(ROLE_PRESETS.admin)).canChange,
		).toContain("See everyone's time");
	});
});
