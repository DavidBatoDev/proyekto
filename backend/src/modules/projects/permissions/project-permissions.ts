// IAM-style fine-grained permissions for project_shares.
//
// Permissions are computed at every check via:
//
//   resolvePermissions(role, origin, capabilities)
//     = ROLE_DEFAULTS[role]
//     ⊕ ORIGIN_DELTAS[origin]
//     ⊕ capabilities          // flat path overrides win
//
// Capabilities are stored on `project_shares.capabilities` (JSONB) as a
// flat map of { 'roadmap.edit': true, 'members.edit_position': true } —
// only the *delta* from the (role, origin) baseline is persisted, so
// rows stay small and templates can evolve without backfill.

import type { ProjectShareOrigin } from '../authorization/project-authorization.service';

export type ProjectRole =
  | 'viewer'
  | 'commenter'
  | 'editor'
  | 'admin'
  | 'owner';

// ─── Permission paths ──────────────────────────────────────────────────────

export type ProjectPermissions = {
  access: {
    roadmap: boolean;
    work_items: boolean;
    team: boolean;
    chat: boolean;
    resources: boolean;
    project_settings: boolean;
  };
  roadmap: {
    view: boolean;
    edit: boolean;
    comment: boolean;
    promote: boolean;
    assign: boolean;
    edit_metadata: boolean;
    view_internal: boolean;
    create_tasks: boolean;
    edit_tasks: boolean;
    share: boolean;
    export: boolean;
    dev_mode: boolean;
  };
  members: {
    view: boolean;
    manage: boolean;
    edit_permissions: boolean;
    edit_position: boolean;
  };
  project: {
    settings: boolean;
    edit_content: boolean;
    view_internal_content: boolean;
  };
  chat: {
    view_channels: boolean;
    send_messages: boolean;
    create_channels: boolean;
    manage_channels: boolean;
    view_internal_channels: boolean;
    mention_members: boolean;
    share_files: boolean;
    start_dm: boolean;
    send_dm: boolean;
    message_clients: boolean;
    message_consultants: boolean;
    message_freelancers: boolean;
  };
  resources: {
    view: boolean;
    upload: boolean;
    delete: boolean;
  };
  logs: {
    view: boolean;
    view_sensitive: boolean;
  };
};

export type PermissionPath =
  | 'access.roadmap'
  | 'access.work_items'
  | 'access.team'
  | 'access.chat'
  | 'access.resources'
  | 'access.project_settings'
  | 'roadmap.view'
  | 'roadmap.edit'
  | 'roadmap.comment'
  | 'roadmap.promote'
  | 'roadmap.assign'
  | 'roadmap.edit_metadata'
  | 'roadmap.view_internal'
  | 'roadmap.create_tasks'
  | 'roadmap.edit_tasks'
  | 'roadmap.share'
  | 'roadmap.export'
  | 'roadmap.dev_mode'
  | 'members.view'
  | 'members.manage'
  | 'members.edit_permissions'
  | 'members.edit_position'
  | 'project.settings'
  | 'project.edit_content'
  | 'project.view_internal_content'
  | 'chat.view_channels'
  | 'chat.send_messages'
  | 'chat.create_channels'
  | 'chat.manage_channels'
  | 'chat.view_internal_channels'
  | 'chat.mention_members'
  | 'chat.share_files'
  | 'chat.start_dm'
  | 'chat.send_dm'
  | 'chat.message_clients'
  | 'chat.message_consultants'
  | 'chat.message_freelancers'
  | 'resources.view'
  | 'resources.upload'
  | 'resources.delete'
  | 'logs.view'
  | 'logs.view_sensitive';

// Runtime list — handy for iteration in dep validation and the UI.
export const PERMISSION_PATHS: readonly PermissionPath[] = [
  'access.roadmap', 'access.work_items', 'access.team',
  'access.chat', 'access.resources', 'access.project_settings',
  'roadmap.view', 'roadmap.edit', 'roadmap.comment', 'roadmap.promote',
  'roadmap.assign', 'roadmap.edit_metadata', 'roadmap.view_internal',
  'roadmap.create_tasks', 'roadmap.edit_tasks', 'roadmap.share',
  'roadmap.export', 'roadmap.dev_mode',
  'members.view', 'members.manage', 'members.edit_permissions',
  'members.edit_position',
  'project.settings', 'project.edit_content', 'project.view_internal_content',
  'chat.view_channels', 'chat.send_messages', 'chat.create_channels',
  'chat.manage_channels', 'chat.view_internal_channels',
  'chat.mention_members', 'chat.share_files', 'chat.start_dm', 'chat.send_dm',
  'chat.message_clients', 'chat.message_consultants', 'chat.message_freelancers',
  'resources.view', 'resources.upload', 'resources.delete',
  'logs.view', 'logs.view_sensitive',
] as const;

// ─── Path helpers ──────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
export function getPermission(
  perms: ProjectPermissions,
  path: PermissionPath,
): boolean {
  const [section, field] = path.split('.');
  return Boolean((perms as any)[section]?.[field]);
}

export function setPermission(
  perms: ProjectPermissions,
  path: PermissionPath,
  value: boolean,
): void {
  const [section, field] = path.split('.');
  (perms as any)[section][field] = value;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Baselines ─────────────────────────────────────────────────────────────

function allFalse(): ProjectPermissions {
  return {
    access: {
      roadmap: false, work_items: false, team: false,
      chat: false, resources: false, project_settings: false,
    },
    roadmap: {
      view: false, edit: false, comment: false, promote: false,
      assign: false, edit_metadata: false, view_internal: false,
      create_tasks: false, edit_tasks: false, share: false,
      export: false, dev_mode: false,
    },
    members: {
      view: false, manage: false, edit_permissions: false,
      edit_position: false,
    },
    project: {
      settings: false, edit_content: false, view_internal_content: false,
    },
    chat: {
      view_channels: false, send_messages: false, create_channels: false,
      manage_channels: false, view_internal_channels: false,
      mention_members: false, share_files: false, start_dm: false,
      send_dm: false, message_clients: false, message_consultants: false,
      message_freelancers: false,
    },
    resources: { view: false, upload: false, delete: false },
    logs: { view: false, view_sensitive: false },
  };
}

function allTrue(): ProjectPermissions {
  const p = allFalse();
  for (const path of PERMISSION_PATHS) setPermission(p, path, true);
  return p;
}

function applyPaths(
  base: ProjectPermissions,
  overrides: Partial<Record<PermissionPath, boolean>>,
): ProjectPermissions {
  for (const [path, value] of Object.entries(overrides)) {
    if (typeof value === 'boolean') {
      setPermission(base, path as PermissionPath, value);
    }
  }
  return base;
}

// Role baselines — coarse defaults; origin deltas + capabilities can elevate.
//
// viewer:     read everything they have access to
// commenter:  + comment/dm
// editor:     + edit work, log time, send messages
// admin:      + manage members, channels, financials
// owner:      everything
function buildRoleDefault(role: ProjectRole): ProjectPermissions {
  const p = allFalse();
  if (role === 'owner') return allTrue();

  // Base reads available from viewer up
  applyPaths(p, {
    'access.roadmap': true,
    'access.work_items': true,
    'access.team': true,
    'access.chat': true,
    'access.resources': true,
    'access.project_settings': false,
    'roadmap.view': true,
    'roadmap.export': true,
    'members.view': true,
    'chat.view_channels': true,
    'resources.view': true,
    'logs.view': true,
    'chat.message_clients': true,
    'chat.message_consultants': true,
  });

  if (role === 'viewer') return p;

  // Commenter adds: comment, send messages, mention, dm
  applyPaths(p, {
    'roadmap.comment': true,
    'chat.send_messages': true,
    'chat.mention_members': true,
    'chat.start_dm': true,
    'chat.send_dm': true,
  });

  if (role === 'commenter') return p;

  // Editor adds: edit roadmap, tasks, files, time logging, share files
  applyPaths(p, {
    'roadmap.edit': true,
    'roadmap.assign': true,
    'roadmap.edit_metadata': true,
    'roadmap.create_tasks': true,
    'roadmap.edit_tasks': true,
    'roadmap.share': true,
    'chat.share_files': true,
    'resources.upload': true,
  });

  if (role === 'editor') return p;

  // Admin adds: members, channels, financials, settings, internals
  applyPaths(p, {
    'access.project_settings': true,
    'roadmap.promote': true,
    'roadmap.view_internal': true,
    'roadmap.dev_mode': true,
    'members.manage': true,
    'members.edit_permissions': true,
    'members.edit_position': true,
    'project.settings': true,
    'project.edit_content': true,
    'project.view_internal_content': true,
    'chat.create_channels': true,
    'chat.manage_channels': true,
    'chat.view_internal_channels': true,
    'resources.delete': true,
    'logs.view_sensitive': true,
  });

  return p;
}

export const ROLE_DEFAULTS: Record<ProjectRole, ProjectPermissions> = {
  viewer: buildRoleDefault('viewer'),
  commenter: buildRoleDefault('commenter'),
  editor: buildRoleDefault('editor'),
  admin: buildRoleDefault('admin'),
  owner: buildRoleDefault('owner'),
};

// ─── Origin deltas ─────────────────────────────────────────────────────────

export const ORIGIN_DELTAS: Record<
  ProjectShareOrigin,
  Partial<Record<PermissionPath, boolean>>
> = {
  // Clients can see their financial picture but cannot DM the freelance
  // pool directly — the consultant mediates (per soft-isolation design).
  client: {
    'chat.message_freelancers': false,
  },
  // Consultants get the operator toolkit additively, regardless of role.
  consultant: {
    'chat.message_freelancers': true,
    'members.manage': true,
  },
  // Pure invite — no extra capabilities beyond the role baseline.
  invited: {},
  // Personal workspace owner is a superset.
  personal_workspace: PERMISSION_PATHS.reduce(
    (acc, p) => {
      acc[p] = true;
      return acc;
    },
    {} as Partial<Record<PermissionPath, boolean>>,
  ),
};

// ─── Dependencies ──────────────────────────────────────────────────────────

export const PERMISSION_DEPENDENCIES: Partial<
  Record<PermissionPath, PermissionPath[]>
> = {
  'roadmap.edit': ['roadmap.view', 'access.roadmap'],
  'roadmap.promote': ['roadmap.edit'],
  'roadmap.assign': ['roadmap.edit'],
  'roadmap.create_tasks': ['roadmap.edit'],
  'roadmap.edit_tasks': ['roadmap.edit'],
  'roadmap.view_internal': ['roadmap.view'],
  'roadmap.share': ['roadmap.edit'],
  'roadmap.export': ['roadmap.view'],
  'roadmap.dev_mode': ['roadmap.edit'],
  'roadmap.comment': ['roadmap.view'],
  'roadmap.edit_metadata': ['roadmap.edit'],

  'members.manage': ['members.view'],
  'members.edit_permissions': ['members.manage'],
  'members.edit_position': ['members.view'],

  'chat.send_messages': ['chat.view_channels'],
  'chat.create_channels': ['chat.view_channels'],
  'chat.manage_channels': ['chat.create_channels'],
  'chat.view_internal_channels': ['chat.view_channels'],
  'chat.mention_members': ['chat.view_channels'],
  'chat.share_files': ['chat.send_messages'],
  'chat.send_dm': ['chat.start_dm'],

  'resources.upload': ['resources.view'],
  'resources.delete': ['resources.upload'],

  'project.edit_content': ['access.project_settings'],
  'project.view_internal_content': ['access.project_settings'],
  'project.settings': ['access.project_settings'],

  'logs.view_sensitive': ['logs.view'],
};

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Compute the resolved fine-grained permissions for a project_shares row.
 *
 * Layers, in order: role baseline → origin delta → capabilities overrides.
 * `capabilities` is a flat `{ 'section.field': boolean }` map.
 */
export function resolvePermissions(
  role: ProjectRole,
  origin: ProjectShareOrigin | null,
  capabilities: Record<string, unknown> | null | undefined,
): ProjectPermissions {
  // Deep clone the role baseline so we don't mutate the constant.
  const base: ProjectPermissions = JSON.parse(
    JSON.stringify(ROLE_DEFAULTS[role]),
  );

  if (origin && ORIGIN_DELTAS[origin]) {
    applyPaths(base, ORIGIN_DELTAS[origin]);
  }

  if (capabilities && typeof capabilities === 'object') {
    const flat: Partial<Record<PermissionPath, boolean>> = {};
    for (const [path, value] of Object.entries(capabilities)) {
      if (typeof value === 'boolean') {
        flat[path as PermissionPath] = value;
      }
    }
    applyPaths(base, flat);
  }

  return base;
}

export type DependencyViolation = {
  path: PermissionPath;
  requires: PermissionPath[];
};

/**
 * Verify every granted (true) permission has its prerequisites also granted.
 * Returns either ok or the list of violations.
 */
export function validateDependencies(
  perms: ProjectPermissions,
):
  | { ok: true }
  | { ok: false; missing: DependencyViolation[] } {
  const missing: DependencyViolation[] = [];
  for (const [path, requires] of Object.entries(PERMISSION_DEPENDENCIES)) {
    if (!requires) continue;
    const granted = getPermission(perms, path as PermissionPath);
    if (!granted) continue;
    const unmet = requires.filter(
      (req) => !getPermission(perms, req),
    );
    if (unmet.length > 0) {
      missing.push({ path: path as PermissionPath, requires: unmet });
    }
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

/**
 * Compute the capabilities delta — the minimal set of path→boolean entries
 * that, layered on top of the (role, origin) baseline, reproduces the
 * desired full ProjectPermissions. Stored on the share row as JSONB.
 */
export function diffCapabilities(
  role: ProjectRole,
  origin: ProjectShareOrigin | null,
  desired: ProjectPermissions,
): Record<string, boolean> {
  const baseline = resolvePermissions(role, origin, null);
  const delta: Record<string, boolean> = {};
  for (const path of PERMISSION_PATHS) {
    const want = getPermission(desired, path);
    const have = getPermission(baseline, path);
    if (want !== have) {
      delta[path] = want;
    }
  }
  return delta;
}
