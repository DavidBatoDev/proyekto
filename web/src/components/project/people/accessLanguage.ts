import type { ProjectPermissions } from "@/services/project.service";

/**
 * Turns the 48-permission matrix into sentences a non-technical person can read.
 *
 * The permissions UI is precise and completely opaque unless you already know
 * the model. This answers the three questions people actually ask — what can
 * they see, what can they change, and why do they have access at all — and
 * leaves the matrix for when someone genuinely needs a single checkbox.
 */

/** The ten page-level gates, in the order the sidebar shows them. */
const SECTION_LABELS: Array<{ field: string; label: string }> = [
	{ field: "roadmap", label: "Roadmap" },
	{ field: "work_items", label: "Board" },
	{ field: "team", label: "People" },
	{ field: "chat", label: "Chat" },
	{ field: "resources", label: "Resources" },
	{ field: "time", label: "Time" },
	{ field: "project_settings", label: "Project settings" },
];

/**
 * Write capabilities worth naming. Deliberately a curated subset — listing all
 * 38 non-access permissions would just be the matrix again in prose.
 */
const WRITE_LABELS: Array<{ path: string; label: string }> = [
	{ path: "roadmap.edit", label: "Edit the roadmap" },
	{ path: "roadmap.create_tasks", label: "Create tasks" },
	{ path: "roadmap.assign", label: "Assign work" },
	{ path: "roadmap.promote", label: "Promote roadmap items" },
	{ path: "roadmap.share", label: "Share the roadmap publicly" },
	{ path: "project.edit_content", label: "Edit project content" },
	{ path: "project.settings", label: "Change project settings" },
	{ path: "members.manage", label: "Add and remove people" },
	{ path: "members.edit_permissions", label: "Change what others can do" },
	{ path: "teams.manage", label: "Attach and detach teams" },
	{ path: "resources.upload", label: "Add resources" },
	{ path: "resources.delete", label: "Delete resources" },
	{ path: "chat.create_channels", label: "Create chat channels" },
	{ path: "chat.send_messages", label: "Post in chat" },
	{ path: "time.view_team_logs", label: "See the whole team's time" },
];

export interface AccessSentences {
	canSee: string[];
	cannotSee: string[];
	canChange: string[];
	/** Set when the person can see things but change nothing. */
	readOnlyNote: string | null;
}

function at(perms: ProjectPermissions, path: string): boolean {
	const [section, field] = path.split(".");
	const record = (perms as unknown as Record<string, Record<string, boolean>>)[
		section
	];
	return Boolean(record?.[field]);
}

export function describeAccess(perms: ProjectPermissions): AccessSentences {
	const canSee: string[] = [];
	const cannotSee: string[] = [];
	for (const { field, label } of SECTION_LABELS) {
		if (at(perms, `access.${field}`)) canSee.push(label);
		else cannotSee.push(label);
	}

	const canChange = WRITE_LABELS.filter(({ path }) => at(perms, path)).map(
		({ label }) => label,
	);

	return {
		canSee,
		cannotSee,
		canChange,
		readOnlyNote:
			canChange.length === 0 && canSee.length > 0
				? "This person can look, but can't change anything."
				: null,
	};
}
