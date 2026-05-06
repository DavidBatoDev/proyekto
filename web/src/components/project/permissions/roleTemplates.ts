// Frontend mirror of backend ROLE_DEFAULTS for the per-member permissions
// editor. The matrix UI uses these as preset buttons (Admin / Editor /
// Viewer / Custom) so admins can snap a row to a known baseline before
// fine-tuning. Keep in sync with
// `backend/src/modules/projects/permissions/project-permissions.ts`'s
// `buildRoleDefault` — both sides describe the same coarse role
// hierarchy (viewer < commenter < editor < admin).

import type { ProjectPermissions } from "@/services/project.service";
import {
	PERMISSION_SECTIONS,
	type PermissionMeta,
} from "./permissionCatalog";

export type RolePresetKey = "admin" | "editor" | "viewer";

function emptyPermissions(): ProjectPermissions {
	const p: Record<string, Record<string, boolean>> = {};
	for (const section of PERMISSION_SECTIONS) {
		p[section.key] = {};
		for (const perm of section.permissions) {
			p[section.key][perm.field] = false;
		}
	}
	return p as unknown as ProjectPermissions;
}

function applyPaths(
	p: ProjectPermissions,
	overrides: Record<string, boolean>,
): ProjectPermissions {
	const out = p as unknown as Record<string, Record<string, boolean>>;
	for (const [path, value] of Object.entries(overrides)) {
		const [section, field] = path.split(".");
		if (out[section]) out[section][field] = value;
	}
	return out as unknown as ProjectPermissions;
}

function buildViewer(): ProjectPermissions {
	return applyPaths(emptyPermissions(), {
		"access.roadmap": true,
		"access.work_items": true,
		"access.team": true,
		"access.chat": true,
		"access.resources": true,
		"access.project_settings": false,
		"roadmap.view": true,
		"roadmap.export": true,
		"members.view": true,
		"chat.view_channels": true,
		"resources.view": true,
		"logs.view": true,
		"chat.message_clients": true,
		"chat.message_consultants": true,
	});
}

function buildEditor(): ProjectPermissions {
	const p = buildViewer();
	// Editor inherits commenter additions then editor additions; we collapse
	// both into one delta since the catalog gates everything via dependencies.
	return applyPaths(p, {
		// commenter additions
		"roadmap.comment": true,
		"chat.send_messages": true,
		"chat.mention_members": true,
		"chat.start_dm": true,
		"chat.send_dm": true,
		// editor additions
		"roadmap.edit": true,
		"roadmap.assign": true,
		"roadmap.edit_metadata": true,
		"roadmap.create_tasks": true,
		"roadmap.edit_tasks": true,
		"roadmap.share": true,
		"chat.share_files": true,
		"resources.upload": true,
	});
}

function buildAdmin(): ProjectPermissions {
	return applyPaths(buildEditor(), {
		"access.project_settings": true,
		"roadmap.promote": true,
		"roadmap.view_internal": true,
		"roadmap.dev_mode": true,
		"members.manage": true,
		"members.edit_permissions": true,
		"members.edit_position": true,
		"project.settings": true,
		"project.edit_content": true,
		"project.view_internal_content": true,
		"chat.create_channels": true,
		"chat.manage_channels": true,
		"chat.view_internal_channels": true,
		"resources.delete": true,
		"logs.view_sensitive": true,
	});
}

export const ROLE_PRESETS: Record<RolePresetKey, ProjectPermissions> = {
	admin: buildAdmin(),
	editor: buildEditor(),
	viewer: buildViewer(),
};

export const ROLE_PRESET_LABELS: Record<RolePresetKey, string> = {
	admin: "Admin",
	editor: "Editor",
	viewer: "Viewer",
};

export const ROLE_PRESET_DESCRIPTIONS: Record<RolePresetKey, string> = {
	admin: "Full management of members, channels, financials, and settings.",
	editor: "Edit roadmap and content, log time, send messages.",
	viewer: "Read-only access to roadmap, work items, time, and chat.",
};

/**
 * Deep-compare two permission objects across every catalog path. Returns
 * true if they match exactly. Used to detect which preset the current
 * state matches (or "custom" if none).
 */
export function permissionsEqual(
	a: ProjectPermissions,
	b: ProjectPermissions,
): boolean {
	for (const section of PERMISSION_SECTIONS) {
		for (const perm of section.permissions) {
			if (readPath(a, perm) !== readPath(b, perm)) return false;
		}
	}
	return true;
}

function readPath(p: ProjectPermissions, perm: PermissionMeta): boolean {
	/* eslint-disable @typescript-eslint/no-explicit-any */
	return (p as any)[perm.section]?.[perm.field] === true;
	/* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * Returns the preset key that the given permission state matches
 * exactly, or null when the state is "custom".
 */
export function detectPreset(
	current: ProjectPermissions,
): RolePresetKey | null {
	for (const key of Object.keys(ROLE_PRESETS) as RolePresetKey[]) {
		if (permissionsEqual(current, ROLE_PRESETS[key])) return key;
	}
	return null;
}
