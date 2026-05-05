// Shared permission catalogue used by:
//   - /settings/team (read-only AWS-style reference)
//   - /settings/permissions?memberId=... (per-member edit)
//
// Mirrors backend `PERMISSION_PATHS` + `PERMISSION_DEPENDENCIES` in
// `backend/src/modules/projects/permissions/project-permissions.ts`. Keep
// in sync by hand — schema is small enough that codegen overhead isn't
// worth the round-trip.

import type { ProjectPermissions } from "@/services/project.service";

export type SectionKey = keyof ProjectPermissions;

export interface PermissionMeta {
	path: string;
	field: string;
	section: SectionKey;
	label: string;
	description: string;
	requires?: string[];
}

export interface PermissionSectionMeta {
	key: SectionKey;
	label: string;
	description: string;
	permissions: PermissionMeta[];
}

function p(
	section: SectionKey,
	field: string,
	label: string,
	description: string,
	requires?: string[],
): PermissionMeta {
	return {
		path: `${section}.${field}`,
		section,
		field,
		label,
		description,
		requires,
	};
}

export const PERMISSION_SECTIONS: PermissionSectionMeta[] = [
	{
		key: "access",
		label: "Access",
		description: "Page-level visibility gates. Disable to hide entire surfaces.",
		permissions: [
			p("access", "roadmap", "Open Roadmap", "View the roadmap canvas in this project."),
			p("access", "work_items", "Open Work Items", "View the per-roadmap work-items list."),
			p("access", "team", "Open Team", "Open the project's Team page."),
			p("access", "time", "Open Time", "Open the time-tracking surface."),
			p("access", "chat", "Open Chat", "Open project chat (#general + DMs)."),
			p("access", "resources", "Open Resources", "Open the project resources library."),
			p("access", "project_settings", "Open Project Settings", "Open the per-project settings pages."),
		],
	},
	{
		key: "roadmap",
		label: "Roadmap",
		description: "Read, edit, and promote roadmap content.",
		permissions: [
			p("roadmap", "view", "View roadmap", "Read roadmap epics, features, and tasks."),
			p("roadmap", "edit", "Edit roadmap", "Modify epics, features, tasks, and structure.", ["roadmap.view", "access.roadmap"]),
			p("roadmap", "comment", "Comment", "Leave comments on roadmap items.", ["roadmap.view"]),
			p("roadmap", "promote", "Promote drafts", "Promote draft roadmap items to active.", ["roadmap.edit"]),
			p("roadmap", "assign", "Assign tasks", "Assign tasks to project members.", ["roadmap.edit"]),
			p("roadmap", "edit_metadata", "Edit metadata", "Edit titles, descriptions, statuses.", ["roadmap.edit"]),
			p("roadmap", "view_internal", "View internal notes", "See notes hidden from the client view.", ["roadmap.view"]),
			p("roadmap", "create_tasks", "Create tasks", "Create new tasks under features.", ["roadmap.edit"]),
			p("roadmap", "edit_tasks", "Edit tasks", "Edit task fields, status, and ordering.", ["roadmap.edit"]),
			p("roadmap", "share", "Share roadmap", "Generate share links and invite viewers.", ["roadmap.edit"]),
			p("roadmap", "export", "Export roadmap", "Export the roadmap snapshot to a file.", ["roadmap.view"]),
			p("roadmap", "dev_mode", "Dev mode", "Use developer-mode tooling on the canvas.", ["roadmap.edit"]),
		],
	},
	{
		key: "members",
		label: "Members",
		description: "View and manage who's on the project.",
		permissions: [
			p("members", "view", "View members", "See the project member list."),
			p("members", "manage", "Manage members", "Invite, remove, and change member roles.", ["members.view"]),
			p("members", "edit_permissions", "Edit permissions", "Override per-member capability flags.", ["members.manage"]),
			p("members", "edit_position", "Edit positions", "Set or change other members' position labels.", ["members.view"]),
		],
	},
	{
		key: "project",
		label: "Project",
		description: "Project-level settings and content.",
		permissions: [
			p("project", "settings", "Project settings", "Edit project-wide settings.", ["access.project_settings"]),
			p("project", "edit_content", "Edit project content", "Edit project descriptions and content.", ["access.project_settings"]),
			p("project", "view_internal_content", "View internal content", "See internal-only project content.", ["access.project_settings"]),
		],
	},
	{
		key: "time",
		label: "Time",
		description: "Track and approve hours, and view financials.",
		permissions: [
			p("time", "view", "View time", "See time entries on this project."),
			p("time", "view_financial", "View financials", "See rates and billable amounts."),
			p("time", "log", "Log time", "Submit your own time entries.", ["time.view"]),
			p("time", "edit_own", "Edit own entries", "Modify your submitted time entries.", ["time.log"]),
			p("time", "edit_team", "Edit team entries", "Modify other members' time entries.", ["time.view"]),
			p("time", "approve", "Approve time", "Approve or reject submitted time.", ["time.view", "time.view_financial"]),
			p("time", "manage_rates", "Manage rates", "Set hourly rates and billing config.", ["time.view_financial"]),
			p("time", "delete_logs", "Delete entries", "Permanently delete time entries.", ["time.view"]),
		],
	},
	{
		key: "chat",
		label: "Chat",
		description: "Send messages, create channels, and manage DMs.",
		permissions: [
			p("chat", "view_channels", "View channels", "Read project chat channels."),
			p("chat", "send_messages", "Send messages", "Post messages in channels.", ["chat.view_channels"]),
			p("chat", "create_channels", "Create channels", "Create new channels in this project.", ["chat.view_channels"]),
			p("chat", "manage_channels", "Manage channels", "Edit, archive, and delete channels.", ["chat.create_channels"]),
			p("chat", "view_internal_channels", "View internal channels", "Read internal-only channels.", ["chat.view_channels"]),
			p("chat", "mention_members", "Mention members", "@-mention other members.", ["chat.view_channels"]),
			p("chat", "share_files", "Share files", "Attach files to messages.", ["chat.send_messages"]),
			p("chat", "start_dm", "Start DMs", "Open a new direct-message thread."),
			p("chat", "send_dm", "Send DMs", "Send messages in DMs.", ["chat.start_dm"]),
			p("chat", "message_clients", "Message clients", "DM project clients."),
			p("chat", "message_consultants", "Message consultants", "DM project consultants."),
			p("chat", "message_freelancers", "Message freelancers", "DM project freelancers."),
		],
	},
	{
		key: "resources",
		label: "Resources",
		description: "Browse and contribute to the resources library.",
		permissions: [
			p("resources", "view", "View resources", "Browse the project resources library."),
			p("resources", "upload", "Upload resources", "Add new files and links.", ["resources.view"]),
			p("resources", "delete", "Delete resources", "Remove files and links.", ["resources.upload"]),
		],
	},
	{
		key: "logs",
		label: "Logs",
		description: "Audit trail and sensitive event history.",
		permissions: [
			p("logs", "view", "View logs", "See the project activity log."),
			p("logs", "view_sensitive", "View sensitive logs", "See entries flagged sensitive.", ["logs.view"]),
		],
	},
];
